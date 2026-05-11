use crate::{Rusage, Status};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ProcessIdentity(usize);

impl ProcessIdentity {
    #[inline]
    pub const fn from_usize(identity: usize) -> Option<Self> {
        if identity == 0 {
            None
        } else {
            Some(Self(identity))
        }
    }

    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        Self::from_usize(ptr.cast::<()>() as usize)
    }

    #[inline]
    pub fn from_ref<T>(value: &T) -> Self {
        Self(core::ptr::from_ref(value).cast::<()>() as usize)
    }

    #[inline]
    pub const fn get(self) -> usize {
        self.0
    }
}

#[derive(Clone, Debug)]
pub struct ProcessExitContext<'a> {
    pub process: ProcessIdentity,
    pub status: Status,
    pub rusage: &'a Rusage,
}

impl<'a> ProcessExitContext<'a> {
    #[inline]
    pub const fn new(process: ProcessIdentity, status: Status, rusage: &'a Rusage) -> Self {
        Self {
            process,
            status,
            rusage,
        }
    }

    #[inline]
    pub fn process_identity(&self) -> ProcessIdentity {
        self.process
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProcessExitReadinessAction {
    WrongProcess,
    Pending,
    Ready,
}

#[derive(Debug)]
pub struct ProcessExitReadiness {
    pub process: ProcessIdentity,
    pub has_process_exited: bool,
    pub exit_status: Option<Status>,
    pub remaining_fds: i8,
}

impl ProcessExitReadiness {
    #[inline]
    pub const fn new(process: ProcessIdentity, remaining_fds: i8) -> Self {
        Self {
            process,
            has_process_exited: false,
            exit_status: None,
            remaining_fds,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitReadinessAction {
        if ctx.process_identity() != self.process {
            return ProcessExitReadinessAction::WrongProcess;
        }

        self.has_process_exited = true;
        self.exit_status = Some(ctx.status.clone());
        self.readiness()
    }

    #[inline]
    pub fn record_reader_done(&mut self) -> ProcessExitReadinessAction {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds = self.remaining_fds.saturating_sub(1);
        self.readiness()
    }

    #[inline]
    pub const fn is_ready(&self) -> bool {
        self.has_process_exited && self.remaining_fds == 0
    }

    #[inline]
    pub const fn readiness(&self) -> ProcessExitReadinessAction {
        if self.is_ready() {
            ProcessExitReadinessAction::Ready
        } else {
            ProcessExitReadinessAction::Pending
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Exited, rusage_zeroed};

    fn process_identity(id: usize) -> ProcessIdentity {
        ProcessIdentity::from_usize(id).unwrap()
    }

    #[test]
    fn readiness_waits_for_process_and_readers() {
        // Cron register/remove use this as spawn-domain readiness state: the
        // process exit and pipe readers can arrive in either order, while the
        // runtime-owned effect stays outside this reducer.
        let process = process_identity(1);
        let rusage = rusage_zeroed();
        let mut readiness = ProcessExitReadiness::new(process, 1);

        assert_eq!(
            readiness.on_process_exit(&ProcessExitContext::new(
                process,
                Status::Exited(Exited { code: 0, signal: 0 }),
                &rusage,
            )),
            ProcessExitReadinessAction::Pending
        );
        assert!(readiness.has_process_exited);
        assert_eq!(
            readiness.exit_status.as_ref().and_then(Status::exit_code),
            Some(0)
        );

        assert_eq!(
            readiness.record_reader_done(),
            ProcessExitReadinessAction::Ready
        );
        assert!(readiness.is_ready());
    }

    #[test]
    fn readiness_ignores_wrong_process() {
        // The process pointer remains an identity token, not authority to touch
        // the owning Process. A mismatched callback must not mutate the reducer.
        let process = process_identity(1);
        let other_process = process_identity(2);
        let rusage = rusage_zeroed();
        let mut readiness = ProcessExitReadiness::new(process, 0);

        assert_eq!(
            readiness.on_process_exit(&ProcessExitContext::new(
                other_process,
                Status::Exited(Exited { code: 1, signal: 0 }),
                &rusage,
            )),
            ProcessExitReadinessAction::WrongProcess
        );
        assert!(!readiness.has_process_exited);
        assert!(readiness.exit_status.is_none());
        assert_eq!(readiness.remaining_fds, 0);
    }
}
