use crate::api::bun::Rusage;
use crate::generated_bindgen::resource_usage::{
    ContextSwitches, CpuTime, Messages, Ops, ResourceUsageClass,
};
use bun_spawn::RusageFields as _; // trait + impls now live in bun_spawn_sys::spawn_process

pub(crate) struct ResourceUsage {
    pub(crate) rusage: Rusage,
}

impl ResourceUsageClass for ResourceUsage {
    fn context_switches(&self) -> ContextSwitches {
        ContextSwitches {
            voluntary: self.rusage.nvcsw(),
            involuntary: self.rusage.nivcsw(),
        }
    }

    fn cpu_time(&self) -> CpuTime {
        let microseconds = |sec: i64, usec: i64| (sec * 1_000_000 + usec) as u64;
        let user = microseconds(self.rusage.utime_sec(), self.rusage.utime_usec());
        let system = microseconds(self.rusage.stime_sec(), self.rusage.stime_usec());
        CpuTime {
            user,
            system,
            total: user + system,
        }
    }

    fn max_rss(&self) -> f64 {
        self.rusage.maxrss()
    }

    fn messages(&self) -> Messages {
        Messages {
            sent: self.rusage.msgsnd(),
            received: self.rusage.msgrcv(),
        }
    }

    fn ops(&self) -> Ops {
        Ops {
            r#in: self.rusage.inblock(),
            out: self.rusage.oublock(),
        }
    }

    fn shm_size(&self) -> f64 {
        self.rusage.ixrss()
    }

    fn signal_count(&self) -> f64 {
        self.rusage.nsignals()
    }

    fn swap_count(&self) -> f64 {
        self.rusage.nswap()
    }
}
