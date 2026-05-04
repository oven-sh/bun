use core::fmt;

use crate::ast;
use crate::interpret::StatePtrUnion;
// TODO(port): `log` is `bun.shell.interpret.log` (a scoped Output logger). The shell crate
// should expose this as a macro; using it as `log!(...)` here.
use crate::interpret::log;
use crate::interpreter::{Async, Binary, Interpreter, Pipeline, ShellExecEnv, State, Stmt, IO};
use crate::{ExitCode, SmolList, Yield};

pub struct If<'a> {
    pub base: State,
    pub node: &'a ast::If,
    pub parent: ParentPtr,
    pub io: IO,
    pub state: IfState<'a>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum IfState<'a> {
    #[default]
    #[strum(serialize = "idle")]
    Idle,
    #[strum(serialize = "exec")]
    Exec(Exec<'a>),
    #[strum(serialize = "waiting_write_err")]
    WaitingWriteErr,
    #[strum(serialize = "done")]
    Done,
}

pub struct Exec<'a> {
    pub state: ExecBranch,
    pub stmts: &'a SmolList<ast::Stmt, 1>,
    pub stmt_idx: u32,
    pub last_exit_code: ExitCode,
}

pub enum ExecBranch {
    Cond,
    Then,
    Elif { idx: u32 },
    Else,
}

pub type ParentPtr = StatePtrUnion<(Stmt, Binary, Pipeline, Async)>;

pub type ChildPtr = StatePtrUnion<(Stmt,)>;

impl<'a> fmt::Display for If<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "If(0x{:x}, state={})",
            self as *const _ as usize,
            <&'static str>::from(&self.state),
        )
    }
}

impl<'a> If<'a> {
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::If,
        parent: ParentPtr,
        io: IO,
    ) -> &'a mut If<'a> {
        // TODO(port): in-place init — `parent.create(If)` allocates a slot from the parent's
        // state pool/arena and returns `*If`, which is then filled. Keeping the shape; Phase B
        // should confirm `StatePtrUnion::create<T>()` returns `&'a mut MaybeUninit<T>` or similar.
        let if_stmt = parent.create::<If>();
        *if_stmt = If {
            base: State::init_with_new_alloc_scope(StateKind::IfClause, interpreter, shell_state),
            node,
            parent,
            io,
            state: IfState::Idle,
        };
        if_stmt
    }

    pub fn start(&mut self) -> Yield {
        Yield::If(self)
    }

    // TODO(port): borrowck — this fn matches on `&mut self.state` while also calling
    // `self.parent.child_done(self, ..)` and constructing `Stmt::init(.., self, ..)` from inside
    // the match arm. `ParentPtr` is a tagged pointer (Copy) so Phase B can hoist `let parent =
    // self.parent;` / `let node = self.node;` before the match and reshape the returns.
    // PORT NOTE: reshaped for borrowck where it does not change control flow.
    pub fn next(&mut self) -> Yield {
        let node = self.node;
        while !matches!(self.state, IfState::Done) {
            match &mut self.state {
                IfState::Idle => {
                    self.state = IfState::Exec(Exec {
                        state: ExecBranch::Cond,
                        stmts: &node.cond,
                        stmt_idx: 0,
                        last_exit_code: 0,
                    });
                }
                IfState::Exec(exec) => {
                    let stmts = exec.stmts;
                    // Executed all the stmts in the condition/branch
                    if exec.stmt_idx >= stmts.len() {
                        match &mut exec.state {
                            // Move to the then, elif, or else branch based on the exit code
                            // and the amount of else parts
                            ExecBranch::Cond => {
                                if exec.last_exit_code == 0 {
                                    exec.state = ExecBranch::Then;
                                    exec.stmt_idx = 0;
                                    exec.stmts = &node.then;
                                    continue;
                                }
                                match node.else_parts.len() {
                                    0 => {
                                        return self.parent.child_done(self, 0);
                                    }
                                    1 => {
                                        exec.state = ExecBranch::Else;
                                        exec.stmt_idx = 0;
                                        exec.stmts = node.else_parts.get_const(0);
                                        continue;
                                    }
                                    _ => {
                                        exec.state = ExecBranch::Elif { idx: 0 };
                                        exec.stmt_idx = 0;
                                        exec.stmts = node.else_parts.get_const(0);
                                        continue;
                                    }
                                }
                            }
                            // done
                            ExecBranch::Then => {
                                return self.parent.child_done(self, exec.last_exit_code);
                            }
                            // if succesful, execute the elif's then branch
                            // otherwise, move to the next elif, or to the final else if it exists
                            ExecBranch::Elif { idx } => {
                                if exec.last_exit_code == 0 {
                                    exec.stmts = node.else_parts.get_const(*idx + 1);
                                    exec.stmt_idx = 0;
                                    exec.state = ExecBranch::Then;
                                    continue;
                                }

                                *idx += 2;

                                if *idx >= node.else_parts.len() {
                                    return self.parent.child_done(self, 0);
                                }

                                if *idx == node.else_parts.len().saturating_sub(1) {
                                    exec.state = ExecBranch::Else;
                                    exec.stmt_idx = 0;
                                    exec.stmts = node.else_parts.last_unchecked_const();
                                    continue;
                                }

                                exec.stmt_idx = 0;
                                exec.stmts = node.else_parts.get_const(*idx);
                                continue;
                            }
                            ExecBranch::Else => {
                                return self.parent.child_done(self, exec.last_exit_code);
                            }
                        }
                    }

                    let idx = exec.stmt_idx;
                    exec.stmt_idx += 1;
                    let stmt = exec.stmts.get_const(idx);
                    let newstmt =
                        Stmt::init(self.base.interpreter, self.base.shell, stmt, self, self.io.copy());
                    return newstmt.start();
                }
                IfState::WaitingWriteErr => return Yield::Suspended, // yield execution
                IfState::Done => panic!("This code should not be reachable"),
            }
        }

        self.parent.child_done(self, 0)
    }

    // TODO(port): not `impl Drop` — body calls `self.parent.destroy(self)` which deallocates the
    // storage of `self` from the parent's pool/arena. `Drop::drop` takes `&mut self` and cannot
    // free its own backing storage. Kept as an explicit inherent method; the StatePtrUnion pool
    // owns the lifecycle.
    pub fn deinit(&mut self) {
        log!("{} deinit", self);
        self.io.deref();
        self.base.end_scope();
        self.parent.destroy(self);
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        // Zig: `defer child.deinit();` — `child` is not used below, so call immediately.
        child.deinit();

        let IfState::Exec(exec) = &mut self.state else {
            panic!("Expected `exec` state in If, this indicates a bug in Bun. Please file a GitHub issue.");
        };

        exec.last_exit_code = exit_code;

        match exec.state {
            ExecBranch::Cond => Yield::If(self),
            ExecBranch::Then => Yield::If(self),
            ExecBranch::Elif { .. } => {
                // if (exit_code == 0) {
                //     exec.stmts = this.node.else_parts.getConst(exec.state.elif.idx + 1);
                //     exec.state = .then;
                //     exec.stmt_idx = 0;
                //     this.next();
                //     return;
                // }
                Yield::If(self)
            }
            ExecBranch::Else => Yield::If(self),
        }
    }
}

// TODO(port): `State.initWithNewAllocScope(.if_clause, ..)` — `.if_clause` is an enum literal whose
// type is inferred at the callsite in Zig. Assuming a `StateKind` enum on `State`; adjust in Phase B.
use crate::interpreter::StateKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/If.zig (204 lines)
//   confidence: medium
//   todos:      4
//   notes:      State-machine with pool-allocated self (parent.create/destroy); borrowck reshape needed in next() for parent.child_done(self) inside &mut self.state match; StatePtrUnion<(..)> tuple-generic assumed.
// ──────────────────────────────────────────────────────────────────────────
