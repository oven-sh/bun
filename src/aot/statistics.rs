#[cfg(test)]
mod limit_values;

use core::time::Duration;
use std::time::Instant;

#[cfg(not(test))]
use bun_aot_interface::statistics::limit_values;
use bun_core::current_work::{self, set_step_of_build};
use bun_threading::Guarded;

pub use self::limit_values::{HOST_ARCHITECTURE, LimitValues, limit_of_queries};
pub use crate::ir::generated::{Architecture, LimitId, Stage, StatisticId};

#[derive(Clone, Debug)]
pub struct Statistics {
    values: Box<[u64]>,
}

impl Default for Statistics {
    fn default() -> Statistics {
        Statistics {
            values: vec![0; StatisticId::COUNT].into_boxed_slice(),
        }
    }
}

impl Statistics {
    pub fn get(&self, id: StatisticId) -> u64 {
        self.values[id as usize]
    }

    pub fn count(&mut self, id: StatisticId, amount: u64) {
        if id != StatisticId::None {
            let total = &mut self.values[id as usize];
            *total = total.saturating_add(amount);
        }
    }

    pub fn add_time(&mut self, stage: Stage, time: Duration) {
        let nanoseconds = u64::try_from(time.as_nanos()).unwrap_or(u64::MAX);
        self.count(stage.time(), nanoseconds);
    }

    pub fn add_values(&mut self, values: &[u64]) {
        debug_assert_eq!(values.len(), self.values.len());
        for (total, &amount) in self.values.iter_mut().zip(values) {
            *total = total.saturating_add(amount);
        }
    }
}

pub struct StageClock {
    times: [Duration; Stage::COUNT],
    running: Option<(Stage, Instant)>,
    cpu_at_start: Duration,
    kernel_time_at_start: Duration,
    instructions_at_start: Option<u64>,
}

#[derive(Default)]
struct ProcessInfo {
    cpu: Duration,
    in_kernel: Duration,
    resident: usize,
    peak: usize,
}

fn process_info() -> ProcessInfo {
    let (mut user, mut system, mut resident, mut peak) = (0, 0, 0, 0);
    if !bun_alloc::USE_MIMALLOC {
        return ProcessInfo::default();
    }
    bun_alloc::mimalloc::mi_process_info(
        None,
        Some(&mut user),
        Some(&mut system),
        Some(&mut resident),
        Some(&mut peak),
        None,
        None,
        None,
    );
    ProcessInfo {
        cpu: Duration::from_millis((user + system) as u64),
        in_kernel: Duration::from_millis(system as u64),
        resident,
        peak: own_peak().unwrap_or(peak),
    }
}

fn own_peak() -> Option<usize> {
    #[cfg(target_os = "linux")]
    if let Ok(status) = bun_sys::File::read_from(bun_sys::Fd::cwd(), b"/proc/self/status") {
        let mut lines = bun_core::strings::split(&status, b"\n");
        let line = lines.find(|line| line.starts_with(b"VmHWM:"))?;
        let digits: Vec<u8> = (line.iter().copied()).filter(u8::is_ascii_digit).collect();
        let kilobytes = bun_core::fmt::parse_int::<usize>(&digits, 10).ok()?;
        return Some(kilobytes * 1024);
    }
    None
}

pub fn logs_stages() -> bool {
    bun_core::env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true)
}

pub fn instructions_of_all_threads() -> Option<u64> {
    instructions::of_all_threads()
}

#[cfg(target_os = "linux")]
mod instructions {
    use core::ffi::{c_int, c_long, c_void};
    use std::sync::OnceLock;

    use bun_sys::Fd;

    unsafe extern "C" {
        fn syscall(number: c_long, ...) -> c_long;
        fn read(file: c_int, buffer: *mut c_void, count: usize) -> isize;
    }

    #[cfg(target_arch = "x86_64")]
    const PERF_EVENT_OPEN: c_long = 298;
    #[cfg(target_arch = "aarch64")]
    const PERF_EVENT_OPEN: c_long = 241;
    const CLOSE_ON_EXEC: c_long = 8;

    fn open_counter(thread: c_int) -> Option<c_int> {
        const HARDWARE: u64 = 0;
        const SIZE: u64 = 64;
        const INSTRUCTIONS: u64 = 1;
        const INHERIT: u64 = 1 << 1;
        const EXCLUDE_KERNEL: u64 = 1 << 5;
        const EXCLUDE_HYPERVISOR: u64 = 1 << 6;
        let flags = INHERIT | EXCLUDE_KERNEL | EXCLUDE_HYPERVISOR;
        let attributes: [u64; 8] = [HARDWARE | SIZE << 32, INSTRUCTIONS, 0, 0, 0, flags, 0, 0];
        // SAFETY: the kernel reads the 64 bytes that the size names and keeps no pointer.
        let file = unsafe {
            syscall(
                PERF_EVENT_OPEN,
                attributes.as_ptr(),
                thread as c_long,
                -1 as c_long,
                -1 as c_long,
                CLOSE_ON_EXEC,
            )
        };
        (file >= 0).then_some(file as c_int)
    }

    fn open_counters() -> Vec<c_int> {
        let flags = bun_sys::O::RDONLY | bun_sys::O::DIRECTORY;
        let name = bun_core::ZBox::from_bytes(b"/proc/self/task");
        let Ok(folder) = bun_sys::openat(Fd::cwd(), &name, flags, 0) else {
            return Vec::new();
        };
        let _close = bun_sys::CloseOnDrop::new(folder);
        let mut entries = bun_sys::dir_iterator::iterate(folder);
        let mut counters = Vec::new();
        while let Ok(Some(entry)) = entries.next() {
            let thread = bun_core::fmt::parse_int::<c_int>(entry.name.slice_u8(), 10).ok();
            match thread.map(open_counter) {
                Some(Some(counter)) => counters.push(counter),
                Some(None) if counters.is_empty() => return Vec::new(),
                _ => {}
            }
        }
        counters
    }

    pub(super) fn of_all_threads() -> Option<u64> {
        static COUNTERS: OnceLock<Vec<c_int>> = OnceLock::new();
        let counters = COUNTERS.get_or_init(open_counters);
        if counters.is_empty() {
            return None;
        }
        let mut sum = 0u64;
        for &counter in counters {
            let mut count = 0u64;
            // SAFETY: it writes at most the eight bytes of `count`.
            let size = unsafe { read(counter, (&raw mut count).cast(), size_of::<u64>()) };
            if size == size_of::<u64>() as isize {
                sum += count;
            }
        }
        Some(sum)
    }
}

#[cfg(not(target_os = "linux"))]
mod instructions {
    pub(super) fn of_all_threads() -> Option<u64> {
        None
    }
}

struct InstructionsSince(Option<u64>, Option<u64>);

impl core::fmt::Display for InstructionsSince {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match (self.0, self.1) {
            (Some(start), Some(end)) => write!(
                f,
                " | instructions {:.6} M",
                end.saturating_sub(start) as f64 / 1e6
            ),
            _ => Ok(()),
        }
    }
}

impl StageClock {
    pub fn new() -> StageClock {
        StageClock {
            times: [Duration::ZERO; Stage::COUNT],
            running: None,
            cpu_at_start: Duration::ZERO,
            kernel_time_at_start: Duration::ZERO,
            instructions_at_start: None,
        }
    }

    pub fn start(&mut self, stage: Stage) {
        if self.running.is_some() {
            self.stop();
        } else if logs_stages() {
            log_time_outside_stages(&format!("in front of {}", stage.name()));
        }
        self.running = Some((stage, Instant::now()));
        if logs_stages() {
            let info = process_info();
            self.cpu_at_start = info.cpu;
            self.kernel_time_at_start = info.in_kernel;
            self.instructions_at_start = instructions::of_all_threads();
        }
        set_step_of_build(match stage {
            Stage::Load => Some(current_work::Step::Load),
            Stage::BindModules => Some(current_work::Step::BindModules),
            Stage::Check => Some(current_work::Step::Check),
            Stage::Lower => Some(current_work::Step::Lower),
            Stage::LinkAndEmit => Some(current_work::Step::LinkAndEmit),
            _ => None,
        });
    }

    pub fn stop(&mut self) {
        if let Some((stage, started)) = self.running.take() {
            let wall = started.elapsed();
            self.times[stage as usize] += wall;
            set_step_of_build(None);
            if logs_stages() {
                let info = process_info();
                let cpu = info.cpu.saturating_sub(self.cpu_at_start);
                let in_kernel = info.in_kernel.saturating_sub(self.kernel_time_at_start);
                bun_core::print_errorln!(
                    "AOT phase times: front end | {} | wall {:.6} ms | cpu {:.6} ms | in the kernel {:.6} ms | resident {} MB | peak {} MB{}",
                    stage.name(),
                    wall.as_secs_f64() * 1000.0,
                    cpu.as_secs_f64() * 1000.0,
                    in_kernel.as_secs_f64() * 1000.0,
                    info.resident >> 20,
                    info.peak >> 20,
                    InstructionsSince(self.instructions_at_start, instructions::of_all_threads()),
                );
                bun_core::Output::flush();
                *END_OF_LAST_LINE.lock() = Some(begin_step());
            }
        }
    }

    pub fn time_of(&self, stage: Stage) -> Duration {
        self.times[stage as usize]
    }

    pub fn add_to(mut self, statistics: &mut Statistics) {
        self.stop();
        for stage in Stage::ALL {
            statistics.add_time(stage, self.time_of(stage));
        }
    }
}

pub struct StepClock {
    stage: Stage,
    began: Option<(Instant, Duration, Option<u64>)>,
}

fn begin_step() -> (Instant, Duration, Option<u64>) {
    let (cpu, instructions) = (process_info().cpu, instructions::of_all_threads());
    (Instant::now(), cpu, instructions)
}

impl StepClock {
    pub fn new(stage: Stage) -> StepClock {
        StepClock {
            stage,
            began: logs_stages().then(begin_step),
        }
    }

    pub fn logs(&self) -> bool {
        self.began.is_some()
    }

    pub fn end(&mut self, step: &str) {
        let Some((began, cpu_at_start, instructions_at_start)) = self.began else {
            return;
        };
        let wall = began.elapsed();
        let info = process_info();
        bun_core::print_errorln!(
            "AOT phase times: front end | {}: {} | wall {:.6} ms | cpu {:.6} ms | resident {} MB | peak {} MB{}",
            self.stage.name(),
            step,
            wall.as_secs_f64() * 1000.0,
            info.cpu.saturating_sub(cpu_at_start).as_secs_f64() * 1000.0,
            info.resident >> 20,
            info.peak >> 20,
            InstructionsSince(instructions_at_start, instructions::of_all_threads()),
        );
        bun_core::Output::flush();
        self.began = Some(begin_step());
    }

    pub fn end_with(&mut self, name_step: impl FnOnce() -> String) {
        if self.logs() {
            self.end(&name_step());
        }
    }
}

static END_OF_LAST_LINE: Guarded<Option<(Instant, Duration, Option<u64>)>> = Guarded::new(None);

fn time_since_process_began() -> Duration {
    match bun_core::start_time() {
        0 => Duration::ZERO,
        began => {
            let nanoseconds = bun_core::time::nano_timestamp().saturating_sub(began);
            Duration::from_nanos(u64::try_from(nanoseconds).unwrap_or(0))
        }
    }
}

pub fn log_time_outside_stages(name: &str) {
    if !logs_stages() {
        return;
    }
    let info = process_info();
    let instructions = instructions::of_all_threads();
    let (now, since_process_began) = (Instant::now(), time_since_process_began());
    let (wall, cpu_at_start, instructions_at_start) = match *END_OF_LAST_LINE.lock() {
        Some((ended, cpu_by_then, instructions_by_then)) => {
            (now.duration_since(ended), cpu_by_then, instructions_by_then)
        }
        None => (since_process_began, Duration::ZERO, None),
    };
    bun_core::print_errorln!(
        "AOT phase times: front end | {} | wall {:.6} ms | cpu {:.6} ms | resident {} MB | peak {} MB{} | since the process began {:.6} ms",
        name,
        wall.as_secs_f64() * 1000.0,
        info.cpu.saturating_sub(cpu_at_start).as_secs_f64() * 1000.0,
        info.resident >> 20,
        info.peak >> 20,
        InstructionsSince(instructions_at_start, instructions),
        since_process_began.as_secs_f64() * 1000.0,
    );
    bun_core::Output::flush();
    *END_OF_LAST_LINE.lock() = Some((now, info.cpu, instructions));
}

static END_OF_LAST_PART: Guarded<Option<(Instant, Duration, Option<u64>)>> = Guarded::new(None);

pub fn log_part_outside_stages(name: &str) {
    if !logs_stages() {
        return;
    }
    let info = process_info();
    let instructions = instructions::of_all_threads();
    let now = Instant::now();
    let ends = [*END_OF_LAST_LINE.lock(), *END_OF_LAST_PART.lock()];
    let last_end = ends.into_iter().flatten().max_by_key(|(ended, ..)| *ended);
    let Some((ended, cpu_by_then, instructions_by_then)) = last_end else {
        return;
    };
    bun_core::print_errorln!(
        "AOT phase times: front end | {} | wall {:.6} ms | cpu {:.6} ms | resident {} MB | peak {} MB{}",
        name,
        now.duration_since(ended).as_secs_f64() * 1000.0,
        info.cpu.saturating_sub(cpu_by_then).as_secs_f64() * 1000.0,
        info.resident >> 20,
        info.peak >> 20,
        InstructionsSince(instructions_by_then, instructions),
    );
    bun_core::Output::flush();
    *END_OF_LAST_PART.lock() = Some((now, info.cpu, instructions));
}

pub fn log_part_of_time_outside_stages(name: &str, wall: Duration) {
    if logs_stages() {
        bun_core::print_errorln!(
            "AOT phase times: front end | {} | wall {:.6} ms",
            name,
            wall.as_secs_f64() * 1000.0,
        );
        bun_core::Output::flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wait_for_clock_tick() {
        let started = Instant::now();
        while started.elapsed().is_zero() {
            core::hint::spin_loop();
        }
    }

    #[test]
    fn limit_values_start_from_registry() {
        for architecture in [Architecture::ARM64, Architecture::X86_64] {
            let limits = LimitValues::for_target(architecture);
            for limit in LimitId::ALL {
                assert_eq!(limits.get(limit), limit.value(architecture), "{limit:?}");
            }
        }
        assert_eq!(
            LimitValues::for_host(),
            LimitValues::for_target(HOST_ARCHITECTURE)
        );
    }

    #[test]
    fn counts_saturate() {
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::SourceBytes, u64::MAX);
        statistics.count(StatisticId::SourceBytes, 1);
        assert_eq!(statistics.get(StatisticId::SourceBytes), u64::MAX);
    }

    #[test]
    fn engine_values_are_added() {
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::TypesInterned, 2);
        let mut values = vec![0; StatisticId::COUNT];
        values[StatisticId::TypesInterned as usize] = 40;
        statistics.add_values(&values);
        assert_eq!(statistics.get(StatisticId::TypesInterned), 42);
    }

    #[test]
    fn clock_times_each_started_stage() {
        let mut clock = StageClock::new();
        clock.start(Stage::Load);
        wait_for_clock_tick();
        clock.start(Stage::LinkAndEmit);
        wait_for_clock_tick();
        clock.stop();
        for stage in Stage::ALL {
            let has_run = matches!(stage, Stage::Load | Stage::LinkAndEmit);
            assert_eq!(!clock.time_of(stage).is_zero(), has_run, "{stage:?}");
        }
    }

    #[test]
    fn clock_accumulates_reentered_stage() {
        let mut clock = StageClock::new();
        clock.start(Stage::Load);
        wait_for_clock_tick();
        clock.stop();
        let first = clock.time_of(Stage::Load);
        clock.stop();
        assert_eq!(clock.time_of(Stage::Load), first);
        clock.start(Stage::Load);
        wait_for_clock_tick();
        clock.stop();
        assert!(clock.time_of(Stage::Load) > first);
    }

    #[test]
    fn clock_adds_running_stage_to_statistics() {
        let mut clock = StageClock::new();
        clock.start(Stage::Lower);
        wait_for_clock_tick();
        let mut statistics = Statistics::default();
        clock.add_to(&mut statistics);
        assert!(statistics.get(Stage::Lower.time()) > 0);
        assert_eq!(statistics.get(Stage::Load.time()), 0);
    }
}
