#[cfg(test)]
mod limit_values;

use core::time::Duration;
use std::time::Instant;

#[cfg(not(test))]
use bun_aot_interface::statistics::limit_values;
use bun_core::current_work::{self, set_step_of_build};
use bun_sema::check::aot::QueryStatistics;

pub use self::limit_values::{
    HOST_ARCHITECTURE, LimitValues, can_be_lowered, fails_build, is_lowered_by_all,
    limit_of_queries,
};
use crate::diagnostics::{ProgramView, SourcePosition, Span, SpanLocator};
pub use crate::ir::generated::{Architecture, DegradesTo, LimitId, Stage, StatisticId};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Loss {
    pub limit: LimitId,
    pub subject: Option<Span>,
    pub count: u32,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LocatedLoss {
    pub limit: LimitId,
    pub subject: Option<SourcePosition>,
    pub count: u32,
}

/// `import(`./pages/${name}.js`)`: the files that are compiled because the import may mean them, and the bytes of their text.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ComputedImport<Place> {
    pub site: Place,
    pub files: u32,
    pub bytes: u64,
}

fn is_lower_subject<T: Ord>(candidate: &Option<T>, current: &Option<T>) -> bool {
    match (candidate, current) {
        (Some(candidate), Some(current)) => candidate < current,
        (Some(_), None) => true,
        (None, Some(_) | None) => false,
    }
}

#[derive(Default, Clone, Debug)]
pub struct Counters {
    counts: Vec<(StatisticId, u64)>,
    losses: Vec<Loss>,
    computed_imports: Vec<ComputedImport<Span>>,
}

impl Counters {
    pub fn count(&mut self, id: StatisticId, amount: u64) {
        if id == StatisticId::None || amount == 0 {
            return;
        }
        match self.counts.iter_mut().find(|(counted, _)| *counted == id) {
            Some((_, total)) => *total = total.saturating_add(amount),
            None => self.counts.push((id, amount)),
        }
    }

    pub fn gave_up(&mut self, limit: LimitId, subject: Option<Span>) {
        self.add_loss(Loss {
            limit,
            subject,
            count: 1,
        });
    }

    pub fn gave_up_times(&mut self, limit: LimitId, count: u32) {
        if count > 0 {
            self.add_loss(Loss {
                limit,
                subject: None,
                count,
            });
        }
    }

    pub fn add_computed_import(&mut self, import: ComputedImport<Span>) {
        self.computed_imports.push(import);
    }

    #[cfg(test)]
    pub fn exceeds(
        &mut self,
        limits: &LimitValues,
        limit: LimitId,
        amount: u64,
        subject: Option<Span>,
    ) -> bool {
        let is_exceeded = amount > limits.get(limit);
        if is_exceeded {
            self.gave_up(limit, subject);
        }
        is_exceeded
    }

    pub fn merge(&mut self, other: Counters) {
        for (id, amount) in other.counts {
            self.count(id, amount);
        }
        for loss in other.losses {
            self.add_loss(loss);
        }
        self.computed_imports.extend(other.computed_imports);
    }

    #[cfg(test)]
    pub fn computed_imports(&self) -> &[ComputedImport<Span>] {
        &self.computed_imports
    }

    #[cfg(test)]
    pub fn counts(&self) -> &[(StatisticId, u64)] {
        &self.counts
    }

    #[cfg(test)]
    pub fn losses(&self) -> &[Loss] {
        &self.losses
    }

    fn add_loss(&mut self, loss: Loss) {
        debug_assert!(loss.limit != LimitId::None);
        match self
            .losses
            .iter_mut()
            .find(|known| known.limit == loss.limit)
        {
            Some(known) => {
                known.count = known.count.saturating_add(loss.count);
                if is_lower_subject(&loss.subject, &known.subject) {
                    known.subject = loss.subject;
                }
            }
            None => self.losses.push(loss),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Statistics {
    values: Box<[u64]>,
    losses: Vec<LocatedLoss>,
    /// The largest first.
    computed_imports: Vec<ComputedImport<SourcePosition>>,
}

impl Default for Statistics {
    fn default() -> Statistics {
        Statistics {
            values: vec![0; StatisticId::COUNT].into_boxed_slice(),
            losses: Vec::new(),
            computed_imports: Vec::new(),
        }
    }
}

impl Statistics {
    pub fn get(&self, id: StatisticId) -> u64 {
        self.values[id as usize]
    }

    pub fn values(&self) -> &[u64] {
        &self.values
    }

    #[cfg(test)]
    pub fn losses(&self) -> &[LocatedLoss] {
        &self.losses
    }

    pub fn computed_imports(&self) -> &[ComputedImport<SourcePosition>] {
        &self.computed_imports
    }

    fn add_computed_imports(&mut self, imports: Vec<ComputedImport<SourcePosition>>) {
        self.computed_imports.extend(imports);
        (self.computed_imports)
            .sort_by(|a, b| (b.bytes, b.files, &a.site).cmp(&(a.bytes, a.files, &b.site)));
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

    pub fn add_queries(&mut self, queries: &QueryStatistics) {
        let sum = |counts: &[u32]| counts.iter().map(|&count| u64::from(count)).sum::<u64>();
        self.count(StatisticId::CheckerQueries, queries.asked);
        self.count(StatisticId::CheckerQueriesGivenUp, sum(&queries.gave_up));
        self.count(
            StatisticId::CheckerMembersGivenUp,
            sum(&queries.members_gave_up),
        );
        self.count(
            StatisticId::UnionMembersCompared,
            queries.union_members_compared,
        );
    }

    pub(crate) fn add_counters(&mut self, view: ProgramView<'_, '_>, counters: Counters) {
        let mut locator = SpanLocator::new(view);
        for (id, amount) in counters.counts {
            self.count(id, amount);
        }
        for loss in counters.losses {
            self.add_loss(LocatedLoss {
                limit: loss.limit,
                subject: loss.subject.map(|span| locator.position_of(span)),
                count: loss.count,
            });
        }
        let located = counters.computed_imports.into_iter();
        let located = located.map(|import| ComputedImport {
            site: locator.position_of(import.site),
            files: import.files,
            bytes: import.bytes,
        });
        self.add_computed_imports(located.collect());
    }

    /// With the stages: what each computed import brings into the build.
    pub fn log_computed_imports(&self) {
        if !logs_stages() {
            return;
        }
        for import in &self.computed_imports {
            bun_core::print_errorln!(
                "AOT computed import | {}:{}:{} | {} files | {} bytes",
                bstr::BStr::new(&import.site.path),
                import.site.line,
                import.site.column,
                import.files,
                import.bytes,
            );
        }
    }

    pub fn gave_up(&mut self, limit: LimitId, subject: Option<SourcePosition>) {
        self.add_loss(LocatedLoss {
            limit,
            subject,
            count: 1,
        });
    }

    pub fn merge(&mut self, other: Statistics) {
        self.add_values(&other.values);
        for loss in other.losses {
            self.merge_loss(loss);
        }
        self.add_computed_imports(other.computed_imports);
    }

    fn add_loss(&mut self, loss: LocatedLoss) {
        debug_assert!(loss.limit != LimitId::None);
        self.count(loss.limit.hits(), u64::from(loss.count));
        self.merge_loss(loss);
    }

    fn merge_loss(&mut self, loss: LocatedLoss) {
        let position = self
            .losses
            .binary_search_by_key(&loss.limit, |known| known.limit);
        match position {
            Ok(index) => {
                let known = &mut self.losses[index];
                known.count = known.count.saturating_add(loss.count);
                if is_lower_subject(&loss.subject, &known.subject) {
                    known.subject = loss.subject;
                }
            }
            Err(index) => self.losses.insert(index, loss),
        }
    }
}

pub struct StageClock {
    times: [Duration; Stage::COUNT],
    running: Option<(Stage, Instant)>,
    /// Processor time of the process when the running stage began, if stages are logged.
    cpu_at_start: Duration,
    instructions_at_start: Option<u64>,
}

/// Processor time of the process so far, and the memory it has resident now and had at the most, in bytes.
fn process_info() -> (Duration, usize, usize) {
    let (mut user, mut system, mut resident, mut peak) = (0, 0, 0, 0);
    // A build with the address sanitizer has no mimalloc: its lines say zero.
    if !bun_alloc::USE_MIMALLOC {
        return (Duration::ZERO, 0, 0);
    }
    let unused = core::ptr::null_mut();
    // SAFETY: it writes a number through each pointer that is not null.
    unsafe {
        bun_alloc::mimalloc::mi_process_info(
            unused,
            &raw mut user,
            &raw mut system,
            &raw mut resident,
            &raw mut peak,
            unused,
            unused,
            unused,
        );
    }
    (
        Duration::from_millis((user + system) as u64),
        resident,
        own_peak().unwrap_or(peak),
    )
}

/// mimalloc asks getrusage(), where on Linux a spawned process starts from the peak of its parent.
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

/// The instructions that the threads of the process have retired in user mode since the first question. The engine counts on the threads that it starts.
/// The front end works on threads of Bun's, some older than the build: each thread that there is at the first question gets a counter that its children inherit.
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

    /// `perf_event_attr` in its first version: type and size, config, period, sample type, read format, flags, two words more.
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
                // A thread that has ended since it was listed is no refusal, and the first thread never ends.
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

/// ` | instructions 12.345678 M`, as the engine's lines say it, or nothing where there is no counter.
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

/// With the stages: why what was loaded is thrown away and the files are loaded again.
pub fn log_why_files_are_loaded_again(why: core::fmt::Arguments<'_>) {
    if logs_stages() {
        bun_core::print_errorln!("AOT files are loaded again | {}", why);
    }
}

/// With the stages: what each step of a stage took, on the clock and of the processors, all threads together.
pub struct StepClock {
    stage: Stage,
    of: &'static str,
    started: Instant,
    cpu_at_start: Duration,
    instructions_at_start: Option<u64>,
}

impl StepClock {
    /// `of`: what the stage works on, where it goes through its steps more than once.
    pub fn new(stage: Stage, of: &'static str) -> StepClock {
        StepClock {
            stage,
            of,
            started: Instant::now(),
            cpu_at_start: match logs_stages() {
                true => process_info().0,
                false => Duration::ZERO,
            },
            instructions_at_start: match logs_stages() {
                true => instructions::of_all_threads(),
                false => None,
            },
        }
    }

    /// `step` has ended and the next one begins.
    pub fn end(&mut self, step: &str) {
        if !logs_stages() {
            return;
        }
        let cpu = process_info().0;
        let instructions = instructions::of_all_threads();
        bun_core::print_errorln!(
            "AOT stage step | {} | {} | {} | wall {:.3} ms | cpu {} ms{}",
            self.stage.name(),
            self.of,
            step,
            self.started.elapsed().as_secs_f64() * 1000.0,
            cpu.saturating_sub(self.cpu_at_start).as_millis(),
            InstructionsSince(self.instructions_at_start, instructions),
        );
        // What a thread prints is written when its buffer is full, in the middle of a line, and other threads write in between.
        bun_core::Output::flush();
        self.started = Instant::now();
        self.cpu_at_start = cpu;
        self.instructions_at_start = instructions::of_all_threads();
    }
}

impl StageClock {
    pub fn new() -> StageClock {
        StageClock {
            times: [Duration::ZERO; Stage::COUNT],
            running: None,
            cpu_at_start: Duration::ZERO,
            instructions_at_start: None,
        }
    }

    pub fn start(&mut self, stage: Stage) {
        self.stop();
        self.running = Some((stage, Instant::now()));
        if logs_stages() {
            self.cpu_at_start = process_info().0;
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
                // In the form of the engine's lines.
                let (cpu, resident, peak) = process_info();
                bun_core::print_errorln!(
                    "AOT phase times: front end | {} | wall {:.6} ms | cpu {:.6} ms | resident {} MB | peak {} MB{}",
                    stage.name(),
                    wall.as_secs_f64() * 1000.0,
                    cpu.saturating_sub(self.cpu_at_start).as_secs_f64() * 1000.0,
                    resident >> 20,
                    peak >> 20,
                    InstructionsSince(self.instructions_at_start, instructions::of_all_threads()),
                );
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compile::testing::with_project_view;
    use bun_sema::program::FileId;

    fn span(file: u32, start: u32) -> Option<Span> {
        Some(Span {
            file: FileId(file),
            start,
            end: start + 1,
        })
    }

    fn position(path: &str, line: u32) -> Option<SourcePosition> {
        Some(SourcePosition {
            path: path.as_bytes().to_vec(),
            line,
            column: 1,
        })
    }

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
    fn lowering_changes_one_limit() {
        let mut limits = LimitValues::for_host();
        limits.lower(LimitId::MaxTypeNodes, 1);
        for limit in LimitId::ALL {
            let expected = if limit == LimitId::MaxTypeNodes {
                1
            } else {
                limit.value(HOST_ARCHITECTURE)
            };
            assert_eq!(limits.get(limit), expected, "{limit:?}");
        }
    }

    #[test]
    #[should_panic(expected = "MaxTypeNodes")]
    fn raising_limit_panics() {
        let mut limits = LimitValues::for_host();
        let value = limits.get(LimitId::MaxTypeNodes);
        limits.lower(LimitId::MaxTypeNodes, value + 1);
    }

    #[test]
    fn build_error_limit_is_lowered_by_its_name_alone() {
        assert!(fails_build(LimitId::MaxProgramIds));
        assert!(can_be_lowered(LimitId::MaxProgramIds));
        assert!(!is_lowered_by_all(LimitId::MaxProgramIds));
        assert!(!can_be_lowered(LimitId::None));
        assert!(is_lowered_by_all(LimitId::MaxTypeNodes));
    }

    #[test]
    fn exceeds_compares_and_gives_up() {
        let mut limits = LimitValues::for_host();
        limits.lower(LimitId::MaxTypeNodes, 2);
        let mut counters = Counters::default();
        assert!(!counters.exceeds(&limits, LimitId::MaxTypeNodes, 2, span(0, 1)));
        assert!(counters.losses().is_empty());
        assert!(counters.exceeds(&limits, LimitId::MaxTypeNodes, 3, span(0, 1)));
        assert_eq!(counters.losses().len(), 1);
    }

    #[test]
    fn counters_keep_lowest_subject_per_limit() {
        let mut counters = Counters::default();
        counters.gave_up(LimitId::MaxTypeNodes, None);
        counters.gave_up(LimitId::MaxTypeNodes, span(1, 9));
        counters.gave_up(LimitId::MaxTypeNodes, span(1, 4));
        counters.gave_up(LimitId::MaxTypeNodes, span(2, 0));
        counters.gave_up(LimitId::MaxDataNestingDepth, None);
        let expected = [
            Loss {
                limit: LimitId::MaxTypeNodes,
                subject: span(1, 4),
                count: 4,
            },
            Loss {
                limit: LimitId::MaxDataNestingDepth,
                subject: None,
                count: 1,
            },
        ];
        assert_eq!(counters.losses(), expected);
    }

    #[test]
    fn merged_counters_do_not_depend_on_order() {
        let mut first = Counters::default();
        first.gave_up(LimitId::MaxTypeNodes, span(3, 0));
        first.count(StatisticId::FunctionsLowered, 2);
        let mut second = Counters::default();
        second.gave_up(LimitId::MaxTypeNodes, span(1, 0));
        second.count(StatisticId::FunctionsLowered, 5);

        let mut forward = first.clone();
        forward.merge(second.clone());
        let mut backward = second;
        backward.merge(first);
        assert_eq!(forward.losses(), backward.losses());
        assert_eq!(forward.counts(), [(StatisticId::FunctionsLowered, 7)]);
        assert_eq!(backward.counts(), forward.counts());
    }

    #[test]
    fn zero_and_none_are_not_counted() {
        let mut counters = Counters::default();
        counters.count(StatisticId::None, 3);
        counters.count(StatisticId::FunctionsLowered, 0);
        assert!(counters.counts().is_empty());
        let mut statistics = Statistics::default();
        statistics.count(StatisticId::None, 3);
        assert!(statistics.values().iter().all(|&value| value == 0));
    }

    #[test]
    fn giving_up_counts_hit() {
        let mut statistics = Statistics::default();
        statistics.gave_up(LimitId::MaxDataNodes, position("b.json", 1));
        statistics.gave_up(LimitId::MaxDataNodes, position("a.json", 7));
        statistics.gave_up(LimitId::MaxDataNodes, None);
        assert_eq!(statistics.get(LimitId::MaxDataNodes.hits()), 3);
        let expected = [LocatedLoss {
            limit: LimitId::MaxDataNodes,
            subject: position("a.json", 7),
            count: 3,
        }];
        assert_eq!(statistics.losses(), expected);
    }

    #[test]
    fn added_counters_are_counted_and_located() {
        let statistics = with_project_view(&[("main.ts", "let a;\nlet b;\n")], |view| {
            let file = view.files().entry_points()[0];
            let mut counters = Counters::default();
            counters.count(StatisticId::FunctionsLowered, 2);
            counters.gave_up(LimitId::MaxTypeNodes, None);
            counters.gave_up(LimitId::MaxTypeNodes, span(file.0, 11));
            counters.gave_up(LimitId::MaxDataNestingDepth, None);
            let mut statistics = Statistics::default();
            statistics.add_counters(view, counters);
            statistics
        });
        assert_eq!(statistics.get(StatisticId::FunctionsLowered), 2);
        assert_eq!(statistics.get(LimitId::MaxTypeNodes.hits()), 2);
        assert_eq!(statistics.get(LimitId::MaxDataNestingDepth.hits()), 1);
        let [unlocated, located] = statistics.losses() else {
            panic!("{:?}", statistics.losses());
        };
        assert_eq!(unlocated.limit, LimitId::MaxDataNestingDepth);
        assert_eq!(unlocated.subject, None);
        assert_eq!((located.limit, located.count), (LimitId::MaxTypeNodes, 2));
        let subject = located.subject.as_ref().expect("a span has a position");
        assert!(subject.path.ends_with(b"main.ts"));
        assert_eq!((subject.line, subject.column), (2, 5));
    }

    #[test]
    fn losses_ascend_by_limit() {
        let mut statistics = Statistics::default();
        statistics.gave_up(LimitId::MaxTypeNodes, None);
        statistics.gave_up(LimitId::MaxFoldedStringBytes, None);
        statistics.gave_up(LimitId::MaxDataNestingDepth, None);
        let limits = statistics.losses().iter().map(|loss| loss.limit as u32);
        assert!(limits.is_sorted_by(|a, b| a < b));
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
    fn queries_are_summed_over_reasons() {
        let mut queries = QueryStatistics {
            asked: 5,
            ..Default::default()
        };
        queries.gave_up[0] = 2;
        queries.gave_up[3] = 1;
        queries.members_gave_up[1] = 4;
        let mut statistics = Statistics::default();
        statistics.add_queries(&queries);
        statistics.add_queries(&queries);
        assert_eq!(statistics.get(StatisticId::CheckerQueries), 10);
        assert_eq!(statistics.get(StatisticId::CheckerQueriesGivenUp), 6);
        assert_eq!(statistics.get(StatisticId::CheckerMembersGivenUp), 8);
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
