use crate::process_exit::{SecurityScanExitAction, SecurityScanExitHandle};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallBufferedReaderTarget {
    SecurityScanIpc { state: SecurityScanExitHandle },
}

impl InstallBufferedReaderTarget {
    #[inline]
    pub const fn has_on_read_chunk(self) -> bool {
        match self {
            Self::SecurityScanIpc { .. } => true,
        }
    }

    #[inline]
    pub fn on_read_chunk(self, chunk: &[u8]) {
        match self {
            Self::SecurityScanIpc { state } => state.record_ipc_chunk(chunk),
        }
    }

    #[inline]
    pub fn on_reader_done(self) -> SecurityScanExitAction {
        match self {
            Self::SecurityScanIpc { state } => state.record_ipc_done(),
        }
    }

    #[inline]
    pub fn on_reader_error(self) -> SecurityScanExitAction {
        self.on_reader_done()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process_exit::SecurityScanExit;
    use bun_spawn_types::ProcessIdentity;

    fn process_identity(id: usize) -> ProcessIdentity {
        ProcessIdentity::from_usize(id).unwrap()
    }

    #[test]
    fn security_scan_reader_target_records_chunks_and_completion() {
        let mut state = SecurityScanExit::new(process_identity(1), 2);
        // SAFETY: the state lives for the whole test and no other handle mutates it.
        let handle = unsafe { SecurityScanExitHandle::from_live_state(&mut state) };
        let target = InstallBufferedReaderTarget::SecurityScanIpc { state: handle };

        assert!(target.has_on_read_chunk());
        target.on_read_chunk(b"{}");
        let _ = target.on_reader_done();

        assert_eq!(state.ipc_data(), b"{}");
        assert!(state.has_received_ipc);
        assert_eq!(state.remaining_fds, 1);
    }
}
