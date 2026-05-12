use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, Node, NodeId, ShellExecEnv, StateKind, log,
};
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
    // TODO(b2-blocked): bun_jsc::EventLoopTask — concurrent_task field
}

#[derive(strum::IntoStaticStr)]
pub enum AsyncState {
    Idle,
    Exec { child: Option<NodeId> },
    Done(ExitCode),
}

impl Default for AsyncState {
    fn default() -> Self {
        AsyncState::Idle
    }
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
        interp.alloc_node(Node::Async(Async {
            base: Base::new(StateKind::Async, parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            state: AsyncState::Idle,
            event_loop: evtloop,
        }))
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
                // Spec (Async.zig next() `.exec` arm, child==null): init the
                // child WITHOUT starting it, store it, enqueue self, return
                // suspended. The child is started on the NEXT event-loop tick
                // via the `StartChild` arm above. Restricted to
                // pipeline/cmd/if/condexpr — other Expr variants panic
                // (Async.zig:102-104).
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

    fn enqueue_self(_interp: &Interpreter, _this: NodeId) {
        // TODO(b2-blocked): bun_jsc::EventLoopHandle/EventLoopTask — schedule
        // `run_from_main_thread` on the JS or mini event loop.
    }

    /// `deinit` is purposefully empty: an `Async` appears "done" to its parent
    /// immediately (see `start`), so the parent must not free it. Real cleanup
    /// happens in `actually_deinit` once the background body finishes.
    pub fn actually_deinit(interp: &Interpreter, this: NodeId) {
        let me = interp.as_async_mut(this);
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

// ported from: src/shell/states/Async.zig
