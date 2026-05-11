use bun_io_types::reader::BufferedReaderHandle;
use bun_spawn_types::ProcessHandle;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SubprocessExitState {
    pub process_handle: Option<ProcessHandle>,
    pub stdout_reader: Option<BufferedReaderHandle>,
    pub stderr_reader: Option<BufferedReaderHandle>,
}

impl SubprocessExitState {
    #[inline]
    pub const fn new() -> Self {
        Self {
            process_handle: None,
            stdout_reader: None,
            stderr_reader: None,
        }
    }

    #[inline]
    pub fn record_process_handle(&mut self, process: ProcessHandle) {
        self.process_handle = Some(process);
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subprocess_exit_state_records_lower_handles() {
        let mut process = 0u8;
        let mut stdout = 0u8;
        let mut stderr = 0u8;

        let process = ProcessHandle::from_ptr(core::ptr::from_mut(&mut process)).unwrap();
        let stdout = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut stdout)).unwrap();
        let stderr = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut stderr)).unwrap();

        let mut state = SubprocessExitState::new();
        state.record_process_handle(process);
        state.record_stdout_reader(stdout);
        state.record_stderr_reader(stderr);

        assert_eq!(state.process_handle, Some(process));
        assert_eq!(state.stdout_reader, Some(stdout));
        assert_eq!(state.stderr_reader, Some(stderr));
        assert!(state.matches_process_handle(process));
    }
}
