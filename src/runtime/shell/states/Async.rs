use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{EventLoopHandle, Interpreter, Node, NodeId, ShellExecEnv, log};
use crate::shell::io::IO;
use crate::shell::states::base::{Base, Env};
use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::r#if::If;
use crate::shell::states::pipeline::Pipeline;
use crate::shell::yield_::Yield;
use bun_event_loop::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, MiniTask};

pub(crate) struct Async {
    pub(crate) base: Base,
    shell: *mut ShellExecEnv,
    pub node: bun_ptr::BackRef<ast::Expr>,
    pub(crate) io: IO,
    pub(crate) state: AsyncState,
    pub(crate) event_loop: EventLoopHandle,
    /// `None` while it is queued.
    task: Option<Box<ShellAsyncTask>>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum AsyncState {
    #[default]
    Idle,
    Exec {
        child: Option<NodeId>,
    },
    Done(ExitCode),
}

impl Async {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Expr,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp
            .async_commands_executing
            .set(interp.async_commands_executing.get() + 1);
        let evtloop = interp.event_loop;
        let id = interp.alloc_node(Node::Async(Async {
            base: Base::new(parent),
            shell,
            node: bun_ptr::BackRef::new(node),
            io,
            state: AsyncState::Idle,
            event_loop: evtloop,
            task: None,
        }));
        interp.as_async_mut(id).task = Some(Box::new(ShellAsyncTask {
            interp: interp.as_ctx_ptr(),
            node: id,
            mini_task: AnyTaskWithExtraContext::default(),
        }));
        id
    }

    pub(crate) fn start(interp: &Interpreter, this: NodeId) -> Yield {
        log!("Async {} start", this);
        Self::enqueue_self(interp, this);
        let parent = interp.as_async(this).base.parent;
        // Appear "done" immediately to the parent so it moves on; the async
        // body runs in the background via `enqueue_self`.
        interp.child_done(parent, this, 0)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        log!(
            "Async {} next {}",
            this,
            <&'static str>::from(&interp.as_async(this).state)
        );
        let action = {
            let me = interp.as_async_mut(this);
            match &mut me.state {
                AsyncState::Idle => {
                    me.state = AsyncState::Exec { child: None };
                    NextAction::Enqueue
                }
                AsyncState::Exec { child } => {
                    if let Some(c) = *child {
                        NextAction::StartChild(c)
                    } else {
                        NextAction::SpawnChild
                    }
                }
                AsyncState::Done(_) => NextAction::Finish,
            }
        };
        match action {
            NextAction::Enqueue => {
                Self::enqueue_self(interp, this);
                Yield::suspended()
            }
            NextAction::StartChild(c) => interp.start_node(c),
            NextAction::SpawnChild => {
                let (shell, io, node) = {
                    let me = interp.as_async(this);
                    (me.shell, me.io.clone(), me.node)
                };
                // Init the child WITHOUT starting it, store it, enqueue self, return
                // suspended. The child is started on the NEXT event-loop tick
                // via the `StartChild` arm above. Restricted to
                // pipeline/cmd/if/condexpr — other Expr variants panic.
                let child = match node.get() {
                    ast::Expr::Pipeline(p) => Pipeline::init(interp, shell, *p, this, io),
                    ast::Expr::Cmd(c) => Cmd::init(interp, Env::inherited(shell), *c, this, io),
                    ast::Expr::If(i) => If::init(interp, Env::inherited(shell), *i, this, io),
                    ast::Expr::CondExpr(c) => {
                        CondExpr::init(interp, Env::inherited(shell), *c, this, io)
                    }
                    ast::Expr::Assign(_)
                    | ast::Expr::Binary(_)
                    | ast::Expr::Subshell(_)
                    | ast::Expr::Async(_) => panic!(
                        "Unexpected Expr variant as Async child, this indicates a bug in Bun."
                    ),
                };
                if let AsyncState::Exec { child: slot } = &mut interp.as_async_mut(this).state {
                    *slot = Some(child);
                }
                Self::enqueue_self(interp, this);
                Yield::suspended()
            }
            NextAction::Finish => {
                interp.async_cmd_done(this);
                Yield::done()
            }
        }
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        log!("Async {} childDone", this);
        interp.deinit_node(child);
        interp.as_async_mut(this).state = AsyncState::Done(exit_code);
        Self::enqueue_self(interp, this);
        Yield::suspended()
    }

    /// Bounce `next` through the event loop so the async body runs on subsequent ticks while the
    /// parent proceeds.
    fn enqueue_self(interp: &Interpreter, this: NodeId) {
        let me = interp.as_async_mut(this);
        let task = me.task.take().expect("queued once at a time");
        match me.event_loop {
            // Next loop iteration, after I/O has had a turn.
            EventLoopHandle::Js { owner } => {
                owner.enqueue_task_after_yield(bun_jsc::Task::from_boxed(task))
            }
            EventLoopHandle::Mini(mini) => mini.post(task, |task| &mut task.mini_task),
        }
    }
}

enum NextAction {
    Enqueue,
    StartChild(NodeId),
    SpawnChild,
    Finish,
}

/// The bounce back to the main thread.
pub(crate) struct ShellAsyncTask {
    interp: *mut Interpreter,
    node: NodeId,
    mini_task: AnyTaskWithExtraContext,
}

impl bun_event_loop::BoxedTask for ShellAsyncTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellAsync;
    fn release_unrun(self: Box<Self>) {}
    /// See [`ShellTask`](crate::shell::interpreter::ShellTask): a step of a shell script always runs.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl MiniTask for ShellAsyncTask {
    fn run_from_main_thread(self: Box<Self>) {
        // SAFETY: the interpreter does not finish before `async_cmd_done`; this is its thread.
        let (interp, node) = (unsafe { &*self.interp }, self.node);
        interp.as_async_mut(node).task = Some(self);
        Async::next(interp, node).run(interp);
    }
}
