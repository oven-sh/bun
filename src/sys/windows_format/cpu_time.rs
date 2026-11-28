//! CPU times, which Windows reports in 100 ns ticks.

const TICKS_PER_US: u64 = 10;
const TICKS_PER_MS: u64 = 10_000;

/// `SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION`.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub(crate) struct ProcessorTicks {
    idle: u64,
    /// Includes `idle`.
    kernel: u64,
    user: u64,
    dpc: u64,
    interrupt: u64,
    interrupt_count: u32,
}

const _: () = assert!(size_of::<ProcessorTicks>() == 48);

/// In milliseconds.
#[derive(Debug, PartialEq, Eq)]
pub struct ProcessorTimes {
    pub user: u64,
    pub sys: u64,
    pub idle: u64,
    pub irq: u64,
}

impl From<ProcessorTicks> for ProcessorTimes {
    fn from(ticks: ProcessorTicks) -> Self {
        Self {
            user: ticks.user / TICKS_PER_MS,
            sys: ticks.kernel.saturating_sub(ticks.idle) / TICKS_PER_MS,
            idle: ticks.idle / TICKS_PER_MS,
            irq: ticks.interrupt / TICKS_PER_MS,
        }
    }
}

/// In microseconds.
#[repr(C)]
#[derive(Debug, PartialEq, Eq)]
pub struct CpuUsage {
    pub user: u64,
    pub system: u64,
}

const _: () = assert!(size_of::<CpuUsage>() == 16);

impl CpuUsage {
    pub(crate) fn from_ticks(user: u64, kernel: u64) -> Self {
        Self {
            user: user / TICKS_PER_US,
            system: kernel / TICKS_PER_US,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sys_time_excludes_idle_time() {
        let to_times = |idle, kernel| {
            ProcessorTimes::from(ProcessorTicks {
                idle,
                kernel,
                user: 136_278_750_000,
                dpc: 1_288_125_000,
                interrupt: 3_255_468_750,
                interrupt_count: 7,
            })
        };
        let expected = ProcessorTimes {
            user: 13_627_875,
            sys: 12_296_515,
            idle: 2_739_259_687,
            irq: 325_546,
        };
        assert_eq!(to_times(27_392_596_875_000, 27_515_562_031_250), expected);
    }

    #[test]
    fn cpu_usage_converts_ticks_to_microseconds() {
        const TICKS_PER_SECOND: u64 = 10_000_000;
        for (ticks, microseconds) in [
            (0, 0),
            (9, 0),
            (1_234_567, 123_456),
            (86_399 * TICKS_PER_SECOND, 86_399_000_000),
            (86_400 * TICKS_PER_SECOND, 86_400_000_000),
            (90_061 * TICKS_PER_SECOND + 5, 90_061_000_000),
            (31 * 86_400 * TICKS_PER_SECOND + 10, 2_678_400_000_001),
        ] {
            let CpuUsage { user, system } = CpuUsage::from_ticks(ticks, ticks + 10);
            assert_eq!((user, system), (microseconds, microseconds + 1));
        }
    }
}
