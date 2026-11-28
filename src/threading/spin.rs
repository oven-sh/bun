//! Adaptive spinning: many waits are shorter than the time it takes to put a thread to sleep and wake it.

use std::sync::LazyLock;

/// Long enough for two other threads to wake up one after the other and reply.
const MAX_SPIN_NS: u64 = 75_000;
const LONG_WAIT_THRESHOLD_NS: u64 = 150_000;
/// The workload may have changed after a wait this long.
const IDLE_THRESHOLD_NS: u64 = 1_000_000;

/// Phase lengths are counted in waits.
const MIN_PHASE_LEN: u16 = 8;
const MAX_SPIN_PHASE_LEN: u16 = 512;
const MAX_SLEEP_PHASE_LEN: u16 = 256;
/// This many consecutive waits that outlast the spin limit end a spin phase.
const MAX_MISSES: u8 = 2;

/// `available_parallelism` ignores the affinity mask.
#[cfg(windows)]
fn is_single_cpu() -> bool {
    use bun_sys::windows::{BOOL, GetCurrentProcess, HANDLE};
    unsafe extern "system" {
        safe fn GetProcessAffinityMask(
            hProcess: HANDLE,
            lpProcessAffinityMask: &mut usize,
            lpSystemAffinityMask: &mut usize,
        ) -> BOOL;
    }
    let mut process_mask = 0;
    let mut system_mask = 0;
    GetProcessAffinityMask(GetCurrentProcess(), &mut process_mask, &mut system_mask);
    process_mask.is_power_of_two()
}

#[cfg(not(windows))]
fn is_single_cpu() -> bool {
    !std::thread::available_parallelism().is_ok_and(|count| count.get() > 1)
}

pub fn has_multiple_cpus() -> bool {
    static HAS_MULTIPLE_CPUS: LazyLock<bool> = LazyLock::new(|| !is_single_cpu());
    *HAS_MULTIPLE_CPUS
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Phase {
    Sleep,
    Spin,
}

/// Lets a thread spin before it sleeps, for as long as that makes work arrive faster.
#[derive(Copy, Clone)]
pub struct AdaptiveSpin {
    phase: Phase,
    /// End of the first wait of the phase, which still follows the pace of the previous phase.
    phase_start_ns: u64,
    wait_count: u16,
    phase_len: u16,
    /// Separate from `wait_count` because more work piles up while a thread sleeps.
    work_count: u64,
    /// Mean time per wait in the last completed sleep phase.
    baseline_wait_interval_ns: u64,
    /// Mean time per work item in the same phase.
    baseline_work_interval_ns: u64,
    next_sleep_phase_len: u16,
    miss_count: u8,
}

impl AdaptiveSpin {
    pub const fn new() -> AdaptiveSpin {
        AdaptiveSpin {
            phase: Phase::Sleep,
            phase_start_ns: 0,
            wait_count: 0,
            phase_len: MIN_PHASE_LEN,
            work_count: 0,
            baseline_wait_interval_ns: 0,
            baseline_work_interval_ns: 0,
            next_sleep_phase_len: MIN_PHASE_LEN,
            miss_count: 0,
        }
    }

    pub fn limit_ns(&self) -> u64 {
        if self.phase == Phase::Spin && has_multiple_cpus() {
            // Work that takes more than twice the baseline to arrive may be waiting for this CPU.
            MAX_SPIN_NS.min(2 * self.baseline_wait_interval_ns)
        } else {
            0
        }
    }

    /// `start_ns..end_ns` includes any sleep after the spin. `work_count` is the work done since the last call.
    pub fn record_wait(&mut self, start_ns: u64, end_ns: u64, spin_limit_ns: u64, work_count: u64) {
        let wait_ns = end_ns.saturating_sub(start_ns);
        if self.phase == Phase::Spin && spin_limit_ns > 0 {
            self.miss_count = if wait_ns > spin_limit_ns {
                self.miss_count + 1
            } else {
                0
            };
        }
        let has_max_misses = self.miss_count == MAX_MISSES;
        if wait_ns > IDLE_THRESHOLD_NS {
            self.next_sleep_phase_len = (self.next_sleep_phase_len / 2).max(MIN_PHASE_LEN);
        }
        if wait_ns > LONG_WAIT_THRESHOLD_NS || (has_max_misses && self.phase_len > MIN_PHASE_LEN) {
            return self.begin_phase(Phase::Sleep, self.next_sleep_phase_len);
        }
        if self.wait_count == 0 {
            self.phase_start_ns = end_ns;
            self.work_count = 0;
        } else {
            self.work_count += work_count.max(1);
        }
        self.wait_count += 1;
        if self.wait_count <= self.phase_len && !has_max_misses {
            return;
        }
        let phase_ns = end_ns.saturating_sub(self.phase_start_ns);
        let work_interval_ns = phase_ns / self.work_count;
        if self.phase == Phase::Sleep {
            self.baseline_wait_interval_ns = phase_ns / u64::from(self.phase_len);
            self.baseline_work_interval_ns = work_interval_ns;
            self.begin_phase(Phase::Spin, MIN_PHASE_LEN);
        } else if has_max_misses || work_interval_ns * 8 > self.baseline_work_interval_ns * 7 {
            self.begin_phase(Phase::Sleep, self.next_sleep_phase_len);
            self.next_sleep_phase_len = (self.phase_len * 2).min(MAX_SLEEP_PHASE_LEN);
        } else if self.phase_len < MAX_SPIN_PHASE_LEN {
            if self.phase_len > MIN_PHASE_LEN {
                self.next_sleep_phase_len = MIN_PHASE_LEN;
            }
            self.begin_phase(Phase::Spin, self.phase_len * 4);
        } else {
            self.begin_phase(Phase::Sleep, MIN_PHASE_LEN);
        }
    }

    fn begin_phase(&mut self, phase: Phase, len: u16) {
        self.phase = phase;
        self.phase_len = len;
        self.wait_count = 0;
        self.miss_count = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WAKE_LATENCY_NS: u64 = 20_000;

    /// `next_arrival` maps the index and the start time of a wait to the time at which work arrives.
    fn spin_percent(spin: &mut AdaptiveSpin, next_arrival: impl Fn(u64, u64) -> u64) -> u64 {
        let mut now = 1;
        let mut spin_count = 0;
        for index in 0..10_000 {
            let start = now + 5_000;
            let arrival = next_arrival(index, start);
            let is_hit = arrival - start <= spin.limit_ns();
            spin_count += u64::from(spin.limit_ns() > 0);
            now = arrival + if is_hit { 0 } else { WAKE_LATENCY_NS };
            spin.record_wait(start, now, spin.limit_ns(), 1);
        }
        spin_count / 100
    }

    #[test]
    fn spins_only_when_work_arrives_faster() {
        if !has_multiple_cpus() {
            return;
        }
        let spin = &mut AdaptiveSpin::new();
        for reply_ns in [2_000, 20_000, 70_000] {
            assert!(spin_percent(spin, |_, now| now + reply_ns) > 90);
        }
        assert!(spin_percent(spin, |index, now| now + [9_000, 90_000][index as usize % 2]) > 90);
        for interval_ns in [30_000, 40_000, 80_000, 120_000] {
            assert!(spin_percent(spin, |_, now| now.next_multiple_of(interval_ns)) < 8);
        }
        assert!(spin_percent(spin, |_, now| now + 90_000) < 6);
        assert_eq!(spin_percent(spin, |_, now| now + 200_000), 0);
        let with_idle_gaps = |index| if index % 100 == 0 { 5_000_000 } else { 9_000 };
        assert!(spin_percent(spin, |index, now| now + with_idle_gaps(index)) > 80);
        let with_misses = |index| if index % 22 < 2 { 100_000 } else { 9_000 };
        assert!(spin_percent(spin, |index, now| now + with_misses(index)) > 40);
    }

    #[test]
    fn fixed_rate_work_rarely_spins() {
        for interval_ns in [7_000, 10_000, 15_000] {
            let mut spin = AdaptiveSpin::new();
            let mut now = 1_u64;
            let mut spin_count = 0;
            for _ in 0..10_000 {
                let last_end = now;
                let start = now + 1_000;
                spin_count += u64::from(spin.limit_ns() > 0);
                now = start.next_multiple_of(interval_ns)
                    + WAKE_LATENCY_NS * u64::from(spin.limit_ns() == 0);
                let work_count = now / interval_ns - last_end / interval_ns;
                spin.record_wait(start, now, spin.limit_ns(), work_count);
            }
            assert!(spin_count < 1_000, "{interval_ns} {spin_count}");
        }
    }

    #[test]
    fn spin_overhead_is_low_when_producer_needs_this_cpu() {
        for cycle_ns in [5_000, 20_000, 60_000] {
            let mut spin = AdaptiveSpin::new();
            let mut now = 1;
            let mut wasted_ns = 0;
            for _ in 0..10_000 {
                let start = now + cycle_ns / 2;
                wasted_ns += spin.limit_ns();
                now = start + spin.limit_ns() + cycle_ns / 2;
                spin.record_wait(start, now, spin.limit_ns(), 1);
            }
            assert!(wasted_ns * 40 < now, "{cycle_ns}");
        }
    }
}
