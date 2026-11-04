use crate::api::bun::Rusage;
use crate::generated_bindgen::resource_usage::{
    ResourceUsageContextSwitches, ResourceUsageCpuTime, ResourceUsageMessages, ResourceUsageOps,
};
use bun_spawn::RusageFields as _; // trait + impls now live in bun_spawn_sys::spawn_process

pub(crate) struct ResourceUsage {
    pub(crate) rusage: Rusage,
}

impl ResourceUsage {
    pub(crate) fn get_context_switches(&self) -> ResourceUsageContextSwitches {
        ResourceUsageContextSwitches {
            voluntary: self.rusage.nvcsw(),
            involuntary: self.rusage.nivcsw(),
        }
    }

    pub(crate) fn get_cpu_time(&self) -> ResourceUsageCpuTime {
        let microseconds = |sec: i64, usec: i64| (sec * 1_000_000 + usec) as u64;
        let user = microseconds(self.rusage.utime_sec(), self.rusage.utime_usec());
        let system = microseconds(self.rusage.stime_sec(), self.rusage.stime_usec());
        ResourceUsageCpuTime {
            user,
            system,
            total: user + system,
        }
    }

    pub(crate) fn get_max_rss(&self) -> f64 {
        self.rusage.maxrss()
    }

    pub(crate) fn get_messages(&self) -> ResourceUsageMessages {
        ResourceUsageMessages {
            sent: self.rusage.msgsnd(),
            received: self.rusage.msgrcv(),
        }
    }

    pub(crate) fn get_ops(&self) -> ResourceUsageOps {
        ResourceUsageOps {
            r#in: self.rusage.inblock(),
            out: self.rusage.oublock(),
        }
    }

    pub(crate) fn get_shm_size(&self) -> f64 {
        self.rusage.ixrss()
    }

    pub(crate) fn get_signal_count(&self) -> f64 {
        self.rusage.nsignals()
    }

    pub(crate) fn get_swap_count(&self) -> f64 {
        self.rusage.nswap()
    }
}
