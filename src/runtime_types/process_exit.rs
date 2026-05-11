use crate::shell::{InterpreterHandle, NodeId};
use bun_spawn_types::{ProcessExitContext, ProcessIdentity, Status};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeProcessExitTarget {
    ChromeProcess,
    HostProcess,
    FilterRunHandle {
        index: usize,
    },
    MultiRunHandle {
        index: usize,
    },
    TestParallelWorker {
        index: usize,
    },
    ShellCommand {
        command: NodeId,
        interpreter: Option<InterpreterHandle>,
    },
}

#[derive(Clone, Debug)]
pub enum RuntimeProcessExitAction {
    ChromeProcess {
        process: ProcessIdentity,
        status: Status,
    },
    HostProcess {
        process: ProcessIdentity,
        status: Status,
    },
    FilterRunHandle {
        index: usize,
        process: ProcessIdentity,
        status: Status,
    },
    MultiRunHandle {
        index: usize,
        process: ProcessIdentity,
        status: Status,
    },
    TestParallelWorker {
        index: usize,
        process: ProcessIdentity,
        status: Status,
    },
    ShellCommand {
        command: NodeId,
        interpreter: Option<InterpreterHandle>,
        process: ProcessIdentity,
        status: Status,
    },
}

impl RuntimeProcessExitTarget {
    #[inline]
    pub fn on_process_exit(self, ctx: &ProcessExitContext<'_>) -> RuntimeProcessExitAction {
        match self {
            Self::ChromeProcess => RuntimeProcessExitAction::ChromeProcess {
                process: ctx.process_identity(),
                status: ctx.status.clone(),
            },
            Self::HostProcess => RuntimeProcessExitAction::HostProcess {
                process: ctx.process_identity(),
                status: ctx.status.clone(),
            },
            Self::FilterRunHandle { index } => RuntimeProcessExitAction::FilterRunHandle {
                index,
                process: ctx.process_identity(),
                status: ctx.status.clone(),
            },
            Self::MultiRunHandle { index } => RuntimeProcessExitAction::MultiRunHandle {
                index,
                process: ctx.process_identity(),
                status: ctx.status.clone(),
            },
            Self::TestParallelWorker { index } => RuntimeProcessExitAction::TestParallelWorker {
                index,
                process: ctx.process_identity(),
                status: ctx.status.clone(),
            },
            Self::ShellCommand {
                command,
                interpreter,
            } => RuntimeProcessExitAction::ShellCommand {
                command,
                interpreter,
                process: ctx.process_identity(),
                status: ctx.status.clone(),
            },
        }
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
    fn cli_targets_preserve_slot_and_process_identity() {
        let process = process_identity(1);
        let rusage = rusage_zeroed();
        let ctx = ProcessExitContext::new(
            process,
            Status::Exited(Exited { code: 0, signal: 0 }),
            &rusage,
        );

        match (RuntimeProcessExitTarget::FilterRunHandle { index: 3 }).on_process_exit(&ctx) {
            RuntimeProcessExitAction::FilterRunHandle {
                index,
                process: actual_process,
                status,
            } => {
                assert_eq!(index, 3);
                assert_eq!(actual_process, process);
                assert_eq!(status.exit_code(), Some(0));
            }
            _ => panic!("wrong action"),
        }

        match (RuntimeProcessExitTarget::MultiRunHandle { index: 4 }).on_process_exit(&ctx) {
            RuntimeProcessExitAction::MultiRunHandle {
                index,
                process: actual_process,
                status,
            } => {
                assert_eq!(index, 4);
                assert_eq!(actual_process, process);
                assert_eq!(status.exit_code(), Some(0));
            }
            _ => panic!("wrong action"),
        }

        match (RuntimeProcessExitTarget::TestParallelWorker { index: 5 }).on_process_exit(&ctx) {
            RuntimeProcessExitAction::TestParallelWorker {
                index,
                process: actual_process,
                status,
            } => {
                assert_eq!(index, 5);
                assert_eq!(actual_process, process);
                assert_eq!(status.exit_code(), Some(0));
            }
            _ => panic!("wrong action"),
        }

        match (RuntimeProcessExitTarget::ShellCommand {
            command: crate::shell::NodeId(6),
            interpreter: None,
        })
        .on_process_exit(&ctx)
        {
            RuntimeProcessExitAction::ShellCommand {
                command,
                interpreter,
                process: actual_process,
                status,
            } => {
                assert_eq!(command, crate::shell::NodeId(6));
                assert_eq!(interpreter, None);
                assert_eq!(actual_process, process);
                assert_eq!(status.exit_code(), Some(0));
            }
            _ => panic!("wrong action"),
        }
    }
}
