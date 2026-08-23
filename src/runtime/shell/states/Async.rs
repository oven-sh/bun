use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::dispatch_tasks::ShellAsyncTask;
use crate::shell::interpreter::{EnvRc, EventLoopHandle, Interpreter, Node, NodeId, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::cmd::Cmd;
use crate::shell::states::cond_expr::CondExpr;
use crate::shell::states::r#if::If;
use crate::shell::states::pipeline::Pipeline;
use crate::shell::yield_::Yield;
use std::rc::Rc;

pub struct Async {
    pub(crate) base: Base,
    pub node: bun_ptr::BackRef<ast::Expr>,
    pub(crate) io: IO,
    pub(crate) state: AsyncState,
    pub(crate) event_loop: EventLoopHandle,
    /// The one bounce payload for this node: taken by `enqueue_self`, handed
    /// back by `run_from_main_thread` (at most one bounce is in flight).
    pub(crate) task: Option<Box<ShellAsyncTask>>,
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
        shell: EnvRc,
        node: &ast::Expr,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp
            .async_commands_executing
            .set(interp.async_commands_executing.get() + 1);
        let evtloop = interp.event_loop;
        interp.alloc_node(Node::Async(Async {
            base: Base::new(parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            state: AsyncState::Idle,
            event_loop: evtloop,
            task: None,
        }))
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
            let mut me = interp.as_async_mut(this);
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
                    (Rc::clone(&me.base.shell), me.io.clone(), me.node)
                };
                // Init the child WITHOUT starting it, store it, enqueue self, return
                // suspended. The child is started on the NEXT event-loop tick
                // via the `StartChild` arm above. Restricted to
                // pipeline/cmd/if/condexpr — other Expr variants panic.
                let child = match node.get() {
                    ast::Expr::Pipeline(p) => Pipeline::init(interp, shell, p, this, io),
                    ast::Expr::Cmd(c) => Cmd::init(interp, shell, c, this, io),
                    ast::Expr::If(i) => If::init(interp, shell, i, this, io),
                    ast::Expr::CondExpr(c) => CondExpr::init(interp, shell, c, this, io),
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

    /// Bounce `run_from_main_thread` through the event loop so the async body
    /// runs on subsequent ticks while the parent proceeds.
    fn enqueue_self(interp: &Interpreter, this: NodeId) {
        let (event_loop, task) = {
            let mut me = interp.as_async_mut(this);
            (me.event_loop, me.task.take())
        };
        let task = task.unwrap_or_else(|| {
            Box::new(ShellAsyncTask {
                interp: bun_ptr::ParentRef::new(interp),
                node: this,
                concurrent_task: Default::default(),
            })
        });
        match event_loop {
            // Next loop iteration, after I/O has had a turn. Reboxed by the
            // `ShellAsync` arm of `bun_runtime::dispatch::run_task`.
            EventLoopHandle::Js { owner } => {
                owner.enqueue_task_after_yield(bun_jsc::Task::from_boxed(task))
            }
            EventLoopHandle::Mini(_) => {
                bun_jsc::ConcurrentPoster::from_event_loop_handle(&event_loop).post_mini(
                    bun_jsc::AnyTaskWithExtraContext::AnyTaskWithExtraContext::arm_boxed::<
                        _,
                        ShellAsyncTask,
                    >(task, |t| &mut t.concurrent_task),
                )
            }
        }
    }

    // `deinit` is purposefully absent: an `Async` appears "done" to its parent
    // immediately (see `start`), so the parent must not free it. The slot is
    // freed by `Interpreter::async_cmd_done` once the background body finishes.

    pub(crate) fn run_from_main_thread(task: Box<ShellAsyncTask>) {
        let interp = task.interp;
        let this = task.node;
        interp.as_async_mut(this).task = Some(task);
        Self::next(&interp, this).run(&interp);
    }
}

enum NextAction {
    Enqueue,
    StartChild(NodeId),
    SpawnChild,
    Finish,
}

// `runtime::dispatch::run_task`'s `task_tag::ShellAsync` arm reboxes the
// enqueued pointer as `ShellAsyncTask`; both sides MUST agree.
bun_event_loop::boxed_taskable!(ShellAsyncTask, ShellAsync);
