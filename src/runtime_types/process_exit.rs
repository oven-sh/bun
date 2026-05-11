use bun_spawn_types::{ProcessExitContext, ProcessIdentity, Status};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeProcessExitTarget {
    ChromeProcess,
    HostProcess,
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
        }
    }
}
