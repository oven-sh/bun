use bun_io_types::reader::BufferedReaderHandle;
use bun_spawn_types::process_exit::{
    ProcessExitContext, ProcessExitReadiness, ProcessExitReadinessAction, ProcessHandle,
    ProcessIdentity,
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
    pub process_handle: Option<ProcessHandle>,
    pub stdout_reader: Option<BufferedReaderHandle>,
    pub stderr_reader: Option<BufferedReaderHandle>,
    pub exit_state: Option<ProcessExitReadiness>,
    pub err_msg: Option<Vec<u8>>,
}

impl ProcessState {
    #[inline]
    pub const fn new() -> Self {
        Self {
            pending_output_fds: 0,
            process_handle: None,
            stdout_reader: None,
            stderr_reader: None,
            exit_state: None,
            err_msg: None,
        }
    }

    #[inline]
    pub fn reset_for_spawn(&mut self) {
        self.exit_state = None;
        self.pending_output_fds = 0;
        self.process_handle = None;
        self.stdout_reader = None;
        self.stderr_reader = None;
    }

    #[inline]
    pub fn initialize_exit_state(&mut self, process: ProcessIdentity) {
        self.exit_state = Some(ProcessExitReadiness::new(
            process,
            self.pending_output_fds,
        ));
    }

    #[inline]
    pub fn initialize_exit_state_from_handle(&mut self, process: ProcessHandle) {
        self.process_handle = Some(process);
        self.initialize_exit_state(process.identity());
    }

    #[inline]
    pub fn matches_process_handle(&self, process: ProcessHandle) -> bool {
        self.process_handle == Some(process)
    }

    #[inline]
    pub fn record_stdout_reader(&mut self, reader: BufferedReaderHandle) {
        self.stdout_reader = Some(reader);
    }

    #[inline]
    pub fn record_stderr_reader(&mut self, reader: BufferedReaderHandle) {
        self.stderr_reader = Some(reader);
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
        let process_handle = ProcessHandle::from_usize(process.get()).unwrap();
        let rusage = rusage_zeroed();
        let mut state = ProcessState::new();

        state.pending_output_fds = 1;
        state.initialize_exit_state_from_handle(process_handle);
        assert!(state.matches_process_handle(process_handle));
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

    #[test]
    fn process_state_records_lower_handles_and_resets_them() {
        let mut process = 0u8;
        let mut stdout = 0u8;
        let mut stderr = 0u8;

        let process = ProcessHandle::from_ptr(core::ptr::from_mut(&mut process)).unwrap();
        let stdout = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut stdout)).unwrap();
        let stderr = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut stderr)).unwrap();

        let mut state = ProcessState::new();
        state.initialize_exit_state_from_handle(process);
        state.record_stdout_reader(stdout);
        state.record_stderr_reader(stderr);

        assert_eq!(state.process_handle, Some(process));
        assert_eq!(state.stdout_reader, Some(stdout));
        assert_eq!(state.stderr_reader, Some(stderr));
        assert!(state.matches_process_handle(process));

        state.reset_for_spawn();

        assert_eq!(state.process_handle, None);
        assert_eq!(state.stdout_reader, None);
        assert_eq!(state.stderr_reader, None);
    }
}
