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

pub(crate) struct Async {
    pub(crate) base: Base,
    shell: *mut ShellExecEnv,
    pub node: bun_ptr::BackRef<ast::Expr>,
    pub(crate) io: IO,
    pub(crate) state: AsyncState,
    pub(crate) event_loop: EventLoopHandle,
    /// Heap payload for the main-thread bounce. The node lives in the
    /// reallocatable `Interpreter::nodes` arena, so the intrusive
    /// concurrent-task node must live in a stable heap allocation instead.
    task: bun_ptr::AliasableBox<crate::shell::dispatch_tasks::ShellAsyncTask>,
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
            task: bun_ptr::AliasableBox::new(crate::shell::dispatch_tasks::ShellAsyncTask {
                interp: interp.as_ctx_ptr(),
                node: core::cell::Cell::new(NodeId::NONE),
            }),
        }));
        interp.as_async(id).task.node.set(id);
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

    /// Bounce `run_from_main_thread` through the event loop so the async body runs on subsequent ticks while the
    /// parent proceeds.
    fn enqueue_self(interp: &Interpreter, this: NodeId) {
        let me = interp.as_async_mut(this);
        let task = me.task.as_ptr();
        match me.event_loop {
            // Next loop iteration, after I/O has had a turn.
            EventLoopHandle::Js { owner } => {
                owner.enqueue_task_after_yield(bun_jsc::Task::init(task))
            }
            EventLoopHandle::Mini(mini) => {
                // The payload embeds only the JS-arm `ConcurrentTask`, so the
                // mini arm heap-allocates an auto-deinit wrapper per bounce.
                let any = bun_jsc::AnyTaskWithExtraContext::AnyTaskWithExtraContext::from_callback_auto_deinit(
                    task,
                    run_from_main_thread_mini,
                );
                mini.enqueue_task_concurrent(core::ptr::NonNull::new(any).expect("heap task"));
            }
        }
    }

    pub(crate) fn run_from_main_thread(interp: &Interpreter, this: NodeId) {
        Self::next(interp, this).run(interp);
    }
}

enum NextAction {
    Enqueue,
    StartChild(NodeId),
    SpawnChild,
    Finish,
}

// `runtime::dispatch::run_task`'s `task_tag::ShellAsync` arm casts the
// enqueued pointer back to `ShellAsyncTask`; both sides MUST agree.
impl bun_event_loop::Taskable for crate::shell::dispatch_tasks::ShellAsyncTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellAsync;
    /// The `Async` node's, which drops with the interpreter.
    unsafe fn release_unrun(_: *mut Self) {}
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

/// Mini-loop trampoline.
fn run_from_main_thread_mini(
    task: *mut crate::shell::dispatch_tasks::ShellAsyncTask,
    _: *mut core::ffi::c_void,
) {
    // SAFETY: `task` is owned by the Async node, which is freed at the tail of
    // this bounce chain, and `interp` outlives every node.
    unsafe {
        let interp = &*(*task).interp;
        let node = (*task).node.get();
        Async::run_from_main_thread(interp, node);
    }
}
