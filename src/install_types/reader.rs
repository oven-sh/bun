use crate::process_exit::{
    LifecycleScriptExitAction, LifecycleScriptStateHandle, SecurityScanExitAction,
    SecurityScanExitHandle,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InstallReaderError {
    pub errno: u16,
    pub name: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallBufferedReaderDelivery {
    LifecycleScriptOutput {
        state: LifecycleScriptStateHandle,
        action: LifecycleScriptExitAction,
        error: Option<InstallReaderError>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InstallBufferedReaderTarget {
    SecurityScanIpc { state: SecurityScanExitHandle },
    LifecycleScriptOutput { state: LifecycleScriptStateHandle },
}

impl InstallBufferedReaderTarget {
    #[inline]
    pub const fn has_on_read_chunk(self) -> bool {
        match self {
            Self::SecurityScanIpc { .. } => true,
            Self::LifecycleScriptOutput { .. } => false,
        }
    }

    #[inline]
    pub fn on_read_chunk(self, chunk: &[u8]) {
        match self {
            Self::SecurityScanIpc { state } => state.record_ipc_chunk(chunk),
            Self::LifecycleScriptOutput { .. } => {}
        }
    }

    #[inline]
    pub fn on_reader_done(self) -> Option<InstallBufferedReaderDelivery> {
        match self {
            Self::SecurityScanIpc { state } => {
                let _ = state.record_ipc_done();
                None
            }
            Self::LifecycleScriptOutput { state } => Some(
                InstallBufferedReaderDelivery::LifecycleScriptOutput {
                    state,
                    action: state.record_reader_done(),
                    error: None,
                },
            ),
        }
    }

    #[inline]
    pub fn on_reader_error(self, error: InstallReaderError) -> Option<InstallBufferedReaderDelivery> {
        match self {
            Self::SecurityScanIpc { state } => {
                let _ = state.record_ipc_done();
                None
            }
            Self::LifecycleScriptOutput { state } => Some(
                InstallBufferedReaderDelivery::LifecycleScriptOutput {
                    state,
                    action: state.record_reader_done(),
                    error: Some(error),
                },
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lifecycle::{LifecycleScriptState, ScriptsList};
    use crate::process_exit::{
        LifecycleScriptExitAction, LifecycleScriptStateHandle, SecurityScanExit,
    };
    use bun_core::ZBox;
    use bun_spawn_types::{Exited, ProcessExitContext, ProcessIdentity, Status, rusage_zeroed};

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
    fn lifecycle_reader_target_records_output_completion() {
        let mut state = lifecycle_state();
        let process = process_identity(2);
        let rusage = rusage_zeroed();
        state.record_output_fd();
        state.initialize_exit_state(process);
        assert_eq!(
            state.on_process_exit(&ProcessExitContext::new(
                process,
                Status::Exited(Exited { code: 0, signal: 0 }),
                &rusage,
            )),
            LifecycleScriptExitAction::Pending
        );
        // SAFETY: the state lives for the whole test and no other handle mutates it.
        let handle = unsafe { LifecycleScriptStateHandle::from_live_state(&mut state) };
        let target = InstallBufferedReaderTarget::LifecycleScriptOutput { state: handle };

        assert!(!target.has_on_read_chunk());
        let delivery = target
            .on_reader_done()
            .expect("lifecycle reader completion produces a delivery");

        match delivery {
            InstallBufferedReaderDelivery::LifecycleScriptOutput { action, error, .. } => {
                assert_eq!(action, LifecycleScriptExitAction::MaybeFinished);
                assert_eq!(error, None);
            }
        }
    }
}
