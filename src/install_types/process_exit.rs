use core::ptr::NonNull;

use crate::lifecycle::LifecycleScriptState;
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
pub struct LifecycleScriptStateHandle(NonNull<LifecycleScriptState>);

impl LifecycleScriptStateHandle {
    /// # Safety
    /// `state` must remain live and uniquely owned by the lifecycle subprocess
    /// until the process target using this handle has stopped firing.
    #[inline]
    pub unsafe fn from_live_state(state: &mut LifecycleScriptState) -> Self {
        Self(NonNull::from(state))
    }

    #[inline]
    fn with_state<R>(self, f: impl FnOnce(&mut LifecycleScriptState) -> R) -> R {
        let mut state = self.0;
        // SAFETY: upheld by `from_live_state`'s construction contract.
        f(unsafe { state.as_mut() })
    }

    #[inline]
    pub fn on_process_exit(self, ctx: &ProcessExitContext<'_>) -> LifecycleScriptExitAction {
        self.with_state(|state| state.on_process_exit(ctx))
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
    pub pending_ipc_reader_close: bool,
    pub remaining_fds: i8,
    pub exit_status: Option<Status>,
    pub ipc_data: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SecurityScanExitHandle(NonNull<SecurityScanExit>);

impl SecurityScanExitHandle {
    /// # Safety
    /// `state` must remain live and uniquely owned by the security scanner
    /// subprocess until the process and IPC reader targets using this handle
    /// have stopped firing.
    #[inline]
    pub unsafe fn from_live_state(state: &mut SecurityScanExit) -> Self {
        Self(NonNull::from(state))
    }

    #[inline]
    fn with_state<R>(self, f: impl FnOnce(&mut SecurityScanExit) -> R) -> R {
        let mut state = self.0;
        // SAFETY: upheld by `from_live_state`'s construction contract.
        f(unsafe { state.as_mut() })
    }

    #[inline]
    pub fn on_process_exit(self, ctx: &ProcessExitContext<'_>) -> SecurityScanExitAction {
        self.with_state(|state| state.on_process_exit(ctx))
    }

    #[inline]
    pub fn record_ipc_done(self) -> SecurityScanExitAction {
        self.with_state(SecurityScanExit::record_ipc_done)
    }

    #[inline]
    pub fn record_ipc_reader_closed(self) -> SecurityScanExitAction {
        self.with_state(SecurityScanExit::record_ipc_reader_closed)
    }

    #[inline]
    pub fn record_ipc_chunk(self, chunk: &[u8]) {
        self.with_state(|state| state.record_ipc_chunk(chunk));
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallProcessExitTarget {
    LifecycleScript(LifecycleScriptStateHandle),
    SecurityScan(SecurityScanExitHandle),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallProcessExitAction {
    LifecycleScript(LifecycleScriptExitAction),
    SecurityScan(SecurityScanExitAction),
}

impl InstallProcessExitTarget {
    #[inline]
    pub fn on_process_exit(self, ctx: &ProcessExitContext<'_>) -> InstallProcessExitAction {
        match self {
            Self::LifecycleScript(state) => {
                InstallProcessExitAction::LifecycleScript(state.on_process_exit(ctx))
            }
            Self::SecurityScan(state) => {
                InstallProcessExitAction::SecurityScan(state.on_process_exit(ctx))
            }
        }
    }
}

impl SecurityScanExit {
    #[inline]
    pub fn new(process: ProcessIdentity, remaining_fds: i8) -> Self {
        Self {
            process,
            has_process_exited: false,
            has_received_ipc: false,
            pending_ipc_reader_close: false,
            remaining_fds,
            exit_status: None,
            ipc_data: Vec::new(),
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
            self.pending_ipc_reader_close = true;
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
        self.pending_ipc_reader_close = false;
        self.done_action(false)
    }

    #[inline]
    pub fn record_ipc_reader_closed(&mut self) -> SecurityScanExitAction {
        self.pending_ipc_reader_close = false;
        self.done_action(false)
    }

    #[inline]
    pub fn record_ipc_chunk(&mut self, chunk: &[u8]) {
        self.ipc_data.extend_from_slice(chunk);
    }

    #[inline]
    pub fn reserve_ipc_capacity(&mut self, additional: usize) {
        self.ipc_data.reserve(additional);
    }

    #[inline]
    pub fn ipc_data(&self) -> &[u8] {
        self.ipc_data.as_slice()
    }

    #[inline]
    pub fn record_json_writer_closed(&mut self) -> SecurityScanExitAction {
        self.decrement_fd();
        self.done_action(false)
    }

    #[inline]
    pub const fn is_done(&self) -> bool {
        self.has_process_exited && self.remaining_fds == 0 && !self.pending_ipc_reader_close
    }

    #[inline]
    fn done_action(&self, close_ipc_reader: bool) -> SecurityScanExitAction {
        if self.has_process_exited && self.remaining_fds == 0 {
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
    use crate::lifecycle::{LifecycleScriptState, ScriptsList};
    use bun_core::ZBox;
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

    fn lifecycle_state() -> LifecycleScriptState {
        LifecycleScriptState::new(
            ScriptsList {
                items: [
                    Some(Box::<[u8]>::from(b"preinstall".as_slice())),
                    None,
                    None,
                    None,
                    None,
                    None,
                ],
                first_index: 0,
                total: 1,
                cwd: ZBox::from_bytes(b"/tmp/pkg"),
                package_name: Box::<[u8]>::from(b"pkg".as_slice()),
            },
            false,
            false,
            None,
        )
    }

    #[test]
    fn lifecycle_state_handle_records_process_exit_without_owner() {
        // ProcessExit stores a handle to lifecycle-domain state, not a
        // LifecycleScriptSubprocess owner pointer. Effects remain with the
        // install owner that drains ready active scripts.
        let process = process_identity(3);
        let rusage = rusage_zeroed();
        let mut state = lifecycle_state();
        state.record_output_fd();
        state.initialize_exit_state(process);
        let handle = unsafe { LifecycleScriptStateHandle::from_live_state(&mut state) };

        assert_eq!(
            handle.on_process_exit(&ProcessExitContext::new(
                process,
                Status::Exited(Exited { code: 0, signal: 0 }),
                &rusage,
            )),
            LifecycleScriptExitAction::Pending
        );
        assert!(!state.ready_to_handle_exit());
        assert_eq!(
            state.record_reader_done(),
            LifecycleScriptExitAction::MaybeFinished
        );
        assert!(state.ready_to_handle_exit());
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
        assert!(exit.pending_ipc_reader_close);
        assert!(!exit.is_done());
        assert_eq!(
            exit.record_json_writer_closed(),
            SecurityScanExitAction::Ready {
                close_ipc_reader: false
            }
        );
        assert!(!exit.is_done());
        assert_eq!(
            exit.record_ipc_reader_closed(),
            SecurityScanExitAction::Ready {
                close_ipc_reader: false
            }
        );
        assert!(exit.is_done());
    }
}
