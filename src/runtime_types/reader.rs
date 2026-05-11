use crate::cron::{CronRegisterJobStateHandle, CronRemoveJobStateHandle};
use crate::subprocess::SubprocessExitStateHandle;
use bun_io_types::reader::BufferedReaderHandle;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimePipeKind {
    Stdout,
    Stderr,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeBufferedReaderTarget {
    FilterRunHandle { index: usize },
    MultiRunPipeReader {
        index: usize,
        pipe: RuntimePipeKind,
    },
    TestParallelWorkerPipe {
        index: usize,
        pipe: RuntimePipeKind,
    },
    CronRegisterOutput {
        state: CronRegisterJobStateHandle,
    },
    CronRemoveOutput {
        state: CronRemoveJobStateHandle,
    },
    SubprocessPipeReader {
        state: SubprocessExitStateHandle,
        pipe: RuntimePipeKind,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RuntimeReaderError {
    pub errno: u16,
    pub name: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeBufferedReaderDelivery<'a> {
    FilterRunHandleChunk {
        index: usize,
        chunk: &'a [u8],
    },
    MultiRunPipeReaderChunk {
        index: usize,
        pipe: RuntimePipeKind,
        chunk: &'a [u8],
    },
    TestParallelWorkerPipeChunk {
        index: usize,
        pipe: RuntimePipeKind,
        chunk: &'a [u8],
    },
    TestParallelWorkerPipeDone {
        index: usize,
        pipe: RuntimePipeKind,
    },
    CronRegisterOutputDone {
        state: CronRegisterJobStateHandle,
    },
    CronRegisterOutputError {
        state: CronRegisterJobStateHandle,
        name: &'static str,
    },
    CronRemoveOutputDone {
        state: CronRemoveJobStateHandle,
    },
    CronRemoveOutputError {
        state: CronRemoveJobStateHandle,
        name: &'static str,
    },
    SubprocessPipeReaderDone {
        state: SubprocessExitStateHandle,
        pipe: RuntimePipeKind,
        reader: BufferedReaderHandle,
    },
    SubprocessPipeReaderError {
        state: SubprocessExitStateHandle,
        pipe: RuntimePipeKind,
        reader: BufferedReaderHandle,
        error: RuntimeReaderError,
    },
    SubprocessPipeReaderMaxBuffer {
        state: SubprocessExitStateHandle,
        pipe: RuntimePipeKind,
    },
}

impl RuntimeBufferedReaderTarget {
    #[inline]
    pub const fn has_on_read_chunk(self) -> bool {
        match self {
            Self::FilterRunHandle { .. }
            | Self::MultiRunPipeReader { .. }
            | Self::TestParallelWorkerPipe { .. } => true,
            Self::CronRegisterOutput { .. }
            | Self::CronRemoveOutput { .. }
            | Self::SubprocessPipeReader { .. } => false,
        }
    }

    #[inline]
    pub fn on_read_chunk<'a>(self, chunk: &'a [u8]) -> RuntimeBufferedReaderDelivery<'a> {
        match self {
            Self::FilterRunHandle { index } => RuntimeBufferedReaderDelivery::FilterRunHandleChunk {
                index,
                chunk,
            },
            Self::MultiRunPipeReader { index, pipe } => {
                RuntimeBufferedReaderDelivery::MultiRunPipeReaderChunk {
                    index,
                    pipe,
                    chunk,
                }
            }
            Self::TestParallelWorkerPipe { index, pipe } => {
                RuntimeBufferedReaderDelivery::TestParallelWorkerPipeChunk {
                    index,
                    pipe,
                    chunk,
                }
            }
            Self::CronRegisterOutput { .. }
            | Self::CronRemoveOutput { .. }
            | Self::SubprocessPipeReader { .. } => {
                unreachable!("cron output readers do not consume chunks")
            }
        }
    }

    #[inline]
    pub const fn on_reader_done(
        self,
        reader: BufferedReaderHandle,
    ) -> Option<RuntimeBufferedReaderDelivery<'static>> {
        match self {
            Self::TestParallelWorkerPipe { index, pipe } => {
                Some(RuntimeBufferedReaderDelivery::TestParallelWorkerPipeDone {
                    index,
                    pipe,
                })
            }
            Self::CronRegisterOutput { state } => {
                Some(RuntimeBufferedReaderDelivery::CronRegisterOutputDone { state })
            }
            Self::CronRemoveOutput { state } => {
                Some(RuntimeBufferedReaderDelivery::CronRemoveOutputDone { state })
            }
            Self::SubprocessPipeReader { state, pipe } => {
                Some(RuntimeBufferedReaderDelivery::SubprocessPipeReaderDone {
                    state,
                    pipe,
                    reader,
                })
            }
            Self::FilterRunHandle { .. } | Self::MultiRunPipeReader { .. } => None,
        }
    }

    #[inline]
    pub const fn on_reader_error(
        self,
        error: RuntimeReaderError,
        reader: BufferedReaderHandle,
    ) -> Option<RuntimeBufferedReaderDelivery<'static>> {
        match self {
            Self::CronRegisterOutput { state } => {
                Some(RuntimeBufferedReaderDelivery::CronRegisterOutputError {
                    state,
                    name: error.name,
                })
            }
            Self::CronRemoveOutput { state } => {
                Some(RuntimeBufferedReaderDelivery::CronRemoveOutputError {
                    state,
                    name: error.name,
                })
            }
            Self::SubprocessPipeReader { state, pipe } => {
                Some(RuntimeBufferedReaderDelivery::SubprocessPipeReaderError {
                    state,
                    pipe,
                    reader,
                    error,
                })
            }
            _ => self.on_reader_done(reader),
        }
    }

    #[inline]
    pub const fn on_max_buffer_overflow(
        self,
    ) -> Option<RuntimeBufferedReaderDelivery<'static>> {
        match self {
            Self::SubprocessPipeReader { state, pipe } => {
                Some(RuntimeBufferedReaderDelivery::SubprocessPipeReaderMaxBuffer { state, pipe })
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_run_reader_target_preserves_index_and_chunk() {
        let chunk = b"hello";
        let target = RuntimeBufferedReaderTarget::FilterRunHandle { index: 7 };

        assert!(target.has_on_read_chunk());
        match target.on_read_chunk(chunk) {
            RuntimeBufferedReaderDelivery::FilterRunHandleChunk { index, chunk: actual } => {
                assert_eq!(index, 7);
                assert_eq!(actual, chunk);
            }
            _ => panic!("wrong delivery"),
        }
    }

    #[test]
    fn runtime_pipe_reader_targets_preserve_slot_pipe_and_completion() {
        let chunk = b"line\n";
        let target = RuntimeBufferedReaderTarget::MultiRunPipeReader {
            index: 2,
            pipe: RuntimePipeKind::Stderr,
        };

        match target.on_read_chunk(chunk) {
            RuntimeBufferedReaderDelivery::MultiRunPipeReaderChunk { index, pipe, chunk: actual } => {
                assert_eq!(index, 2);
                assert_eq!(pipe, RuntimePipeKind::Stderr);
                assert_eq!(actual, chunk);
            }
            _ => panic!("wrong delivery"),
        }
        let mut reader = 0u8;
        let reader = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut reader)).unwrap();

        assert_eq!(target.on_reader_done(reader), None);

        let target = RuntimeBufferedReaderTarget::TestParallelWorkerPipe {
            index: 4,
            pipe: RuntimePipeKind::Stdout,
        };
        match target.on_reader_done(reader) {
            Some(RuntimeBufferedReaderDelivery::TestParallelWorkerPipeDone { index, pipe }) => {
                assert_eq!(index, 4);
                assert_eq!(pipe, RuntimePipeKind::Stdout);
            }
            _ => panic!("wrong delivery"),
        }
    }

    #[test]
    fn subprocess_pipe_reader_target_preserves_state_pipe_and_reader() {
        let mut state = crate::subprocess::SubprocessExitState::new();
        // SAFETY: the state lives for the whole test.
        let state = unsafe {
            crate::subprocess::SubprocessExitStateHandle::from_live_state(&mut state)
        };
        let mut reader = 0u8;
        let reader = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut reader)).unwrap();
        let target = RuntimeBufferedReaderTarget::SubprocessPipeReader {
            state,
            pipe: RuntimePipeKind::Stdout,
        };

        assert!(!target.has_on_read_chunk());
        match target.on_reader_done(reader) {
            Some(RuntimeBufferedReaderDelivery::SubprocessPipeReaderDone {
                state: actual_state,
                pipe,
                reader: actual_reader,
            }) => {
                assert_eq!(actual_state, state);
                assert_eq!(pipe, RuntimePipeKind::Stdout);
                assert_eq!(actual_reader, reader);
            }
            _ => panic!("wrong delivery"),
        }

        match target.on_max_buffer_overflow() {
            Some(RuntimeBufferedReaderDelivery::SubprocessPipeReaderMaxBuffer {
                state: actual_state,
                pipe,
            }) => {
                assert_eq!(actual_state, state);
                assert_eq!(pipe, RuntimePipeKind::Stdout);
            }
            _ => panic!("wrong delivery"),
        }
    }
}
