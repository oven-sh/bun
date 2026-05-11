use bun_spawn_types::{ProcessExitContext, ProcessIdentity, Status};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LifecycleScriptExitAction {
    WrongProcess,
    Pending,
    MaybeFinished,
}

#[derive(Debug)]
pub struct LifecycleScriptExit {
    pub process: ProcessIdentity,
    pub has_called_process_exit: bool,
    pub exit_status: Option<Status>,
    pub remaining_fds: i8,
}

impl LifecycleScriptExit {
    #[inline]
    pub const fn new(process: ProcessIdentity, remaining_fds: i8) -> Self {
        Self {
            process,
            has_called_process_exit: false,
            exit_status: None,
            remaining_fds,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> LifecycleScriptExitAction {
        if ctx.process_identity() != self.process {
            return LifecycleScriptExitAction::WrongProcess;
        }

        self.has_called_process_exit = true;
        self.exit_status = Some(ctx.status.clone());
        self.maybe_finished()
    }

    #[inline]
    pub fn record_reader_done(&mut self) -> LifecycleScriptExitAction {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds = self.remaining_fds.saturating_sub(1);
        self.maybe_finished()
    }

    #[inline]
    pub fn maybe_finished(&self) -> LifecycleScriptExitAction {
        if self.has_called_process_exit && self.remaining_fds == 0 {
            LifecycleScriptExitAction::MaybeFinished
        } else {
            LifecycleScriptExitAction::Pending
        }
    }

    #[inline]
    pub const fn output_drained(&self) -> bool {
        self.remaining_fds == 0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SecurityScanExitAction {
    WrongProcess,
    Pending { close_ipc_reader: bool },
    Ready { close_ipc_reader: bool },
}

#[derive(Debug)]
pub struct SecurityScanExit {
    pub process: ProcessIdentity,
    pub has_process_exited: bool,
    pub has_received_ipc: bool,
    pub remaining_fds: i8,
    pub exit_status: Option<Status>,
}

impl SecurityScanExit {
    #[inline]
    pub const fn new(process: ProcessIdentity, remaining_fds: i8) -> Self {
        Self {
            process,
            has_process_exited: false,
            has_received_ipc: false,
            remaining_fds,
            exit_status: None,
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> SecurityScanExitAction {
        if ctx.process_identity() != self.process {
            return SecurityScanExitAction::WrongProcess;
        }

        self.has_process_exited = true;
        self.exit_status = Some(ctx.status.clone());

        let close_ipc_reader = if self.has_received_ipc {
            false
        } else {
            self.has_received_ipc = true;
            self.decrement_fd();
            true
        };

        self.done_action(close_ipc_reader)
    }

    #[inline]
    pub fn record_ipc_done(&mut self) -> SecurityScanExitAction {
        if !self.has_received_ipc {
            self.has_received_ipc = true;
            self.decrement_fd();
        }
        self.done_action(false)
    }

    #[inline]
    pub fn record_json_writer_closed(&mut self) -> SecurityScanExitAction {
        self.decrement_fd();
        self.done_action(false)
    }

    #[inline]
    pub const fn is_done(&self) -> bool {
        self.has_process_exited && self.remaining_fds == 0
    }

    #[inline]
    fn done_action(&self, close_ipc_reader: bool) -> SecurityScanExitAction {
        if self.is_done() {
            SecurityScanExitAction::Ready { close_ipc_reader }
        } else {
            SecurityScanExitAction::Pending { close_ipc_reader }
        }
    }

    #[inline]
    fn decrement_fd(&mut self) {
        debug_assert!(self.remaining_fds > 0);
        self.remaining_fds = self.remaining_fds.saturating_sub(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_spawn_types::{Exited, rusage_zeroed};

    fn process_identity(id: usize) -> ProcessIdentity {
        ProcessIdentity::from_usize(id).unwrap()
    }

    #[test]
    fn lifecycle_exit_waits_for_fds_before_maybe_finished() {
        // Lifecycle scripts are an install-domain readiness gate: the process
        // can exit before stdout/stderr readers finish. The type crate stores
        // only the ordering state and returns MaybeFinished after both sides
        // have arrived; it does not reach into the package manager.
        let process = process_identity(1);
        let rusage = rusage_zeroed();
        let mut exit = LifecycleScriptExit::new(process, 1);

        let action = exit.on_process_exit(&ProcessExitContext::new(
            process,
            Status::Exited(Exited { code: 0, signal: 0 }),
            &rusage,
        ));

        assert_eq!(action, LifecycleScriptExitAction::Pending);
        assert!(exit.has_called_process_exit);
        assert_eq!(exit.remaining_fds, 1);
        assert_eq!(
            exit.record_reader_done(),
            LifecycleScriptExitAction::MaybeFinished
        );
    }

    #[test]
    fn security_scan_exit_closes_ipc_without_double_counting() {
        // Security scan has a distinct IPC wrinkle: process exit may imply the
        // IPC reader should be closed, but the IPC side must not be counted
        // twice if it is later reported done. This pins that reducer behavior
        // while keeping the actual reader close as a returned action.
        let process = process_identity(2);
        let rusage = rusage_zeroed();
        let mut exit = SecurityScanExit::new(process, 2);

        let action = exit.on_process_exit(&ProcessExitContext::new(
            process,
            Status::Exited(Exited { code: 1, signal: 0 }),
            &rusage,
        ));

        assert_eq!(
            action,
            SecurityScanExitAction::Pending {
                close_ipc_reader: true
            }
        );
        assert_eq!(exit.remaining_fds, 1);
        assert!(exit.has_received_ipc);
        assert_eq!(
            exit.record_json_writer_closed(),
            SecurityScanExitAction::Ready {
                close_ipc_reader: false
            }
        );
    }
}
