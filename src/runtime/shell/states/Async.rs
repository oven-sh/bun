use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{EventLoopHandle, Interpreter, Node, NodeId, ShellExecEnv, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::r#if::If;
use crate::shell::states::pipeline::Pipeline;
use crate::shell::yield_::Yield;

pub struct Async {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::Expr>,
    pub io: IO,
    pub state: AsyncState,
    pub event_loop: EventLoopHandle,
    /// Heap payload for the main-thread bounce. The node lives in the
    /// reallocatable `Interpreter::nodes` arena, so the intrusive
    /// concurrent-task node must live in a stable heap allocation instead.
    /// Allocated in `init`, freed in `actually_deinit`.
    task: *mut crate::shell::dispatch_tasks::ShellAsyncTask,
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
    pub fn init(
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
            base: Base::new(parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            state: AsyncState::Idle,
            event_loop: evtloop,
            task: core::ptr::null_mut(),
        }));
        // The payload needs the NodeId, so it's allocated after the node.
        interp.as_async_mut(id).task =
            bun_core::heap::alloc(crate::shell::dispatch_tasks::ShellAsyncTask {
                interp: interp.as_ctx_ptr(),
                node: id,
                concurrent_task: Default::default(),
            });
        id
    }

    pub fn start(interp: &Interpreter, this: NodeId) -> Yield {
        log!("Async {} start", this);
        Self::enqueue_self(interp, this);
        let parent = interp.as_async(this).base.parent;
        // Appear "done" immediately to the parent so it moves on; the async
        // body runs in the background via `enqueue_self`.
        interp.child_done(parent, this, 0)
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
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
                    (me.base.shell, me.io.clone(), me.node)
                };
                // Init the child WITHOUT starting it, store it, enqueue self, return
                // suspended. The child is started on the NEXT event-loop tick
                // via the `StartChild` arm above. Restricted to
                // pipeline/cmd/if/condexpr — other Expr variants panic.
                let child = match node.get() {
                    ast::Expr::Pipeline(p) => Pipeline::init(interp, shell, *p, this, io),
                    ast::Expr::Cmd(c) => Cmd::init(interp, shell, *c, this, io),
                    ast::Expr::If(i) => If::init(interp, shell, *i, this, io),
                    ast::Expr::CondExpr(c) => CondExpr::init(interp, shell, *c, this, io),
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

    pub fn child_done(
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
        use bun_event_loop::{ConcurrentTask::AutoDeinit, EventLoopTaskPtr};
        let me = interp.as_async_mut(this);
        let task = me.task;
        debug_assert!(!task.is_null());
        match me.event_loop {
            EventLoopHandle::Js { .. } => {
                // SAFETY: `task` is the live heap payload allocated in `init`
                // and freed only in `actually_deinit`. The embedded
                // `ConcurrentTask` is reused for each bounce and is never
                // in-flight twice: every enqueue is dispatched (dequeued)
                // before the state machine can enqueue again.
                unsafe {
                    let ct = (*task).concurrent_task.from(task, AutoDeinit::ManualDeinit);
                    me.event_loop.enqueue_task_concurrent(EventLoopTaskPtr {
                        js: std::ptr::from_mut(ct),
                    });
                }
            }
            EventLoopHandle::Mini(_) => {
                // The payload embeds only the JS-arm `ConcurrentTask`, so the
                // mini arm heap-allocates an auto-deinit wrapper per bounce
                // (same shape as `GlobalMini::enqueue_task_concurrent_wait_pid`).
                let any = bun_jsc::AnyTaskWithExtraContext::AnyTaskWithExtraContext::from_callback_auto_deinit(
                    task,
                    run_from_main_thread_mini,
                );
                me.event_loop
                    .enqueue_task_concurrent(EventLoopTaskPtr { mini: any });
            }
        }
    }

    /// `deinit` is purposefully empty: an `Async` appears "done" to its parent
    /// immediately (see `start`), so the parent must not free it. Real cleanup
    /// happens in `actually_deinit` once the background body finishes.
    pub fn actually_deinit(interp: &Interpreter, this: NodeId) {
        let me = interp.as_async_mut(this);
        if !me.task.is_null() {
            // SAFETY: allocated in `init`; the final bounce that reached
            // `async_cmd_done` (and thus here) has already been dequeued and
            // dispatched, so nothing else references the payload.
            drop(unsafe { bun_core::heap::take(me.task) });
            me.task = core::ptr::null_mut();
        }
        me.base.end_scope();
    }

    pub fn run_from_main_thread(interp: &Interpreter, this: NodeId) {
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
}

/// Mini-loop trampoline.
fn run_from_main_thread_mini(
    task: *mut crate::shell::dispatch_tasks::ShellAsyncTask,
    _: *mut core::ffi::c_void,
) {
    // SAFETY: `task` is the live payload owned by the Async node; it is freed
    // only in `actually_deinit`, which runs at the tail of this bounce chain
    // (after the final `next()` dispatch), and `interp` outlives every node.
    unsafe {
        let interp = &*(*task).interp;
        let node = (*task).node;
        Async::run_from_main_thread(interp, node);
    }
}
