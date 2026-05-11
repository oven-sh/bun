use bun_spawn_types::process_exit::{
    ProcessExitContext, ProcessExitReadiness, ProcessExitReadinessAction, ProcessIdentity,
};
use bun_spawn_types::Status;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronRegisterState {
    ReadingCrontab,
    InstallingCrontab,
    WritingPlist,
    BootingOut,
    Bootstrapping,
    Done,
    Failed,
}

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CronRemoveState {
    ReadingCrontab,
    InstallingCrontab,
    BootingOut,
    Done,
    Failed,
}

#[derive(Debug)]
pub struct ProcessState {
    pub pending_output_fds: i8,
    pub exit_state: Option<ProcessExitReadiness>,
    pub err_msg: Option<Vec<u8>>,
}

impl ProcessState {
    #[inline]
    pub const fn new() -> Self {
        Self {
            pending_output_fds: 0,
            exit_state: None,
            err_msg: None,
        }
    }

    #[inline]
    pub fn reset_for_spawn(&mut self) {
        self.exit_state = None;
        self.pending_output_fds = 0;
    }

    #[inline]
    pub fn initialize_exit_state(&mut self, process: ProcessIdentity) {
        self.exit_state = Some(ProcessExitReadiness::new(
            process,
            self.pending_output_fds,
        ));
    }

    #[inline]
    pub fn record_reader_done(&mut self) -> ProcessExitReadinessAction {
        if let Some(exit_state) = self.exit_state.as_mut() {
            exit_state.record_reader_done()
        } else {
            debug_assert!(self.pending_output_fds > 0);
            self.pending_output_fds = self.pending_output_fds.saturating_sub(1);
            ProcessExitReadinessAction::Pending
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> ProcessExitReadinessAction {
        if self.exit_state.is_none() {
            self.initialize_exit_state(ctx.process_identity());
        }

        self.exit_state
            .as_mut()
            .expect("exit state initialized above")
            .on_process_exit(ctx)
    }

    #[inline]
    pub fn is_ready(&self) -> bool {
        self.exit_state
            .as_ref()
            .is_some_and(ProcessExitReadiness::is_ready)
    }

    #[inline]
    pub fn take_exit_status(&mut self) -> Option<Status> {
        self.exit_state
            .as_mut()
            .and_then(|exit_state| exit_state.exit_status.take())
    }
}

impl Default for ProcessState {
    #[inline]
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_spawn_types::{Exited, rusage_zeroed};

    #[test]
    fn cron_states_keep_zig_tag_shape() {
        assert_eq!(core::mem::size_of::<CronRegisterState>(), 1);
        assert_eq!(core::mem::size_of::<CronRemoveState>(), 1);
        assert_ne!(
            CronRegisterState::ReadingCrontab,
            CronRegisterState::InstallingCrontab
        );
        assert_ne!(
            CronRemoveState::ReadingCrontab,
            CronRemoveState::InstallingCrontab
        );
    }

    #[test]
    fn process_state_accepts_reader_before_process_exit() {
        let process = ProcessIdentity::from_usize(10).unwrap();
        let rusage = rusage_zeroed();
        let mut state = ProcessState::new();

        state.pending_output_fds = 1;
        assert_eq!(
            state.record_reader_done(),
            ProcessExitReadinessAction::Pending
        );
        assert_eq!(
            state.on_process_exit(&ProcessExitContext::new(
                process,
                Status::Exited(Exited { code: 0, signal: 0 }),
                &rusage,
            )),
            ProcessExitReadinessAction::Ready
        );
        assert!(state.is_ready());
        assert_eq!(
            state.take_exit_status().and_then(|status| status.exit_code()),
            Some(0)
        );
    }
}
