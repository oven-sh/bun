use core::fmt;

use bun_jsc::{EventLoopHandle, EventLoopTask};
use bun_shell::ast;
use bun_shell::interpret::{log, StatePtrUnion};
use bun_shell::interpreter::{
    Binary, Cmd, CondExpr, If, Interpreter, Pipeline, ShellExecEnv, State, Stmt, IO,
};
use bun_shell::{ExitCode, Yield};

pub struct Async<'a> {
    pub base: State,
    pub node: &'a ast::Expr,
    pub parent: ParentPtr,
    pub io: IO,
    pub state: AsyncState,
    pub event_loop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
}

pub enum AsyncState {
    Idle,
    Exec { child: Option<ChildPtr> },
    Done(ExitCode),
}

impl Default for AsyncState {
    fn default() -> Self {
        AsyncState::Idle
    }
}

pub type ParentPtr = StatePtrUnion<(Binary, Stmt)>;

pub type ChildPtr = StatePtrUnion<(Pipeline, Cmd, If, CondExpr)>;

impl<'a> fmt::Display for Async<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Async(0x{:x}, child={})",
            self as *const _ as usize,
            <&'static str>::from(self.node),
        )
    }
}

impl<'a> Async<'a> {
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::Expr,
        parent: ParentPtr,
        io: IO,
    ) -> *mut Async<'a> {
        interpreter.async_commands_executing += 1;
        let async_cmd = parent.create::<Async>();
        // SAFETY: parent.create returns a freshly allocated, uninitialized slot for Async.
        // TODO(port): in-place init — parent.create allocates from a pool/arena.
        unsafe {
            async_cmd.write(Async {
                base: State::init_with_new_alloc_scope(StateKind::Async, interpreter, shell_state),
                node,
                parent,
                io,
                state: AsyncState::Idle,
                event_loop: interpreter.event_loop,
                concurrent_task: EventLoopTask::from_event_loop(interpreter.event_loop),
            });
            &mut *async_cmd
        }
    }

    pub fn start(&mut self) -> Yield {
        log!("{} start", self);
        self.enqueue_self();
        self.parent.child_done(self, 0)
    }

    pub fn next(&mut self) -> Yield {
        log!("{} next {}", self, <&'static str>::from(&self.state));
        match &mut self.state {
            AsyncState::Idle => {
                self.state = AsyncState::Exec { child: None };
                self.enqueue_self();
                Yield::Suspended
            }
            AsyncState::Exec { child } => {
                if let Some(child) = child {
                    return child.start();
                }

                let new_child: ChildPtr = 'brk: {
                    match self.node {
                        ast::Expr::Pipeline(pipeline) => {
                            break 'brk ChildPtr::init(Pipeline::init(
                                self.base.interpreter,
                                self.base.shell,
                                pipeline,
                                Pipeline::ParentPtr::init(self),
                                self.io.copy(),
                            ));
                        }
                        ast::Expr::Cmd(cmd) => {
                            break 'brk ChildPtr::init(Cmd::init(
                                self.base.interpreter,
                                self.base.shell,
                                cmd,
                                Cmd::ParentPtr::init(self),
                                self.io.copy(),
                            ));
                        }
                        ast::Expr::If(if_) => {
                            break 'brk ChildPtr::init(If::init(
                                self.base.interpreter,
                                self.base.shell,
                                if_,
                                If::ParentPtr::init(self),
                                self.io.copy(),
                            ));
                        }
                        ast::Expr::CondExpr(condexpr) => {
                            break 'brk ChildPtr::init(CondExpr::init(
                                self.base.interpreter,
                                self.base.shell,
                                condexpr,
                                CondExpr::ParentPtr::init(self),
                                self.io.copy(),
                            ));
                        }
                        _ => {
                            panic!("Encountered an unexpected child of an async command, this indicates a bug in Bun. Please open a GitHub issue.");
                        }
                    }
                };
                // PORT NOTE: reshaped for borrowck — re-match to assign into self.state.exec.child
                if let AsyncState::Exec { child } = &mut self.state {
                    *child = Some(new_child);
                }
                self.enqueue_self();
                Yield::Suspended
            }
            AsyncState::Done(_) => {
                self.base.interpreter.async_cmd_done(self);
                Yield::Done
            }
        }
    }

    pub fn enqueue_self(&mut self) {
        // TODO(port): EventLoopHandle/EventLoopTask are tagged unions in Zig; the Rust shapes
        // (enum variants vs. accessor methods) are owned by bun_jsc. This mirrors the Zig branch.
        match &self.event_loop {
            EventLoopHandle::Js(js) => {
                js.enqueue_task_concurrent(
                    self.concurrent_task.js().from(self, TaskDeinit::ManualDeinit),
                );
            }
            EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(
                    self.concurrent_task.mini().from(self, "runFromMainThreadMini"),
                );
            }
        }
    }

    pub fn child_done(&mut self, child_ptr: ChildPtr, exit_code: ExitCode) -> Yield {
        log!("{} childDone", self);
        child_ptr.deinit();
        self.state = AsyncState::Done(exit_code);
        self.enqueue_self();
        Yield::Suspended
    }

    pub fn actually_deinit(&mut self) {
        self.io.deref();
        self.base.end_scope();
        self.parent.destroy(self);
    }

    pub fn run_from_main_thread(&mut self) {
        self.next().run();
    }

    pub fn run_from_main_thread_mini(&mut self, _: &mut ()) {
        self.run_from_main_thread();
    }
}

/// This is purposefully empty as a hack to ensure Async runs in the background while appearing to
/// the parent that it is done immediately.
///
/// For example, in a script like `sleep 1 & echo hello`, the `sleep 1` part needs to appear as done
/// immediately so the parent doesn't wait for it and instead immediately moves to executing the
/// next command.
///
/// Actual deinitialization is executed once this Async calls
/// `this.base.interpreter.asyncCmdDone(this)`, where the interpreter will call `.actually_deinit()`
impl<'a> Drop for Async<'a> {
    fn drop(&mut self) {}
}

// TODO(port): StateKind / TaskDeinit are placeholder names for the enum tags `.async` and
// `.manual_deinit` from the Zig side; resolve to the real types in bun_shell / bun_jsc in Phase B.
use bun_shell::interpreter::StateKind;
use bun_jsc::TaskDeinit;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Async.zig (181 lines)
//   confidence: medium
//   todos:      3
//   notes:      EventLoopHandle/EventLoopTask variant access + StatePtrUnion generics need Phase B type fixes; Drop is intentionally a no-op (see actually_deinit).
// ──────────────────────────────────────────────────────────────────────────
