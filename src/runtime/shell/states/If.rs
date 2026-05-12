use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, StateKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::stmt::Stmt;
use crate::shell::yield_::Yield;

pub struct If {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::If>,
    pub io: IO,
    pub state: IfState,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum IfState {
    #[default]
    Idle,
    Exec(Exec),
    WaitingWriteErr,
    Done,
}

pub struct Exec {
    pub state: ExecBranch,
    /// Back-reference to the current `SmolList<ast::Stmt, 1>` being walked.
    /// Points into the AST arena, which the interpreter holds for its entire
    /// lifetime — it outlives every state node.
    pub stmts: bun_ptr::BackRef<ast::SmolList<ast::Stmt, 1>>,
    pub stmt_idx: u32,
    pub last_exit_code: ExitCode,
}

impl Exec {
    /// Borrow the current `SmolList<Stmt, 1>` being walked.
    ///
    /// `stmts` always points into the AST arena (`ShellArgs::__arena`), which
    /// the interpreter holds for its entire lifetime — it outlives every state
    /// node (BackRef invariant).
    #[inline]
    fn stmts(&self) -> &ast::SmolList<ast::Stmt, 1> {
        self.stmts.get()
    }

    #[inline]
    fn stmts_len(&self) -> u32 {
        self.stmts().len() as u32
    }
}

pub enum ExecBranch {
    Cond,
    Then,
    Elif { idx: u32 },
    Else,
}

impl If {
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::If,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::If(If {
            base: Base::new(StateKind::IfClause, parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            state: IfState::Idle,
        }))
    }

    pub fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
        let parent = interp.as_if(this).base.parent;
        loop {
            // PORT NOTE: reshaped for borrowck — we read/mutate `state` via a
            // short-lived borrow, decide an action, then drop the borrow
            // before calling back into `interp`.
            let action = {
                let me = interp.as_if_mut(this);
                // Copy the BackRef out so `n` borrows a local, leaving `me`
                // free for the disjoint `&mut me.state` borrow below.
                let node = me.node;
                let n = node.get();
                match &mut me.state {
                    IfState::Idle => {
                        me.state = IfState::Exec(Exec {
                            state: ExecBranch::Cond,
                            stmts: bun_ptr::BackRef::new(&n.cond),
                            stmt_idx: 0,
                            last_exit_code: 0,
                        });
                        continue;
                    }
                    IfState::Exec(exec) => {
                        if exec.stmt_idx >= exec.stmts_len() {
                            match &mut exec.state {
                                ExecBranch::Cond => {
                                    if exec.last_exit_code == 0 {
                                        exec.state = ExecBranch::Then;
                                        exec.stmts = bun_ptr::BackRef::new(&n.then);
                                        exec.stmt_idx = 0;
                                        continue;
                                    }
                                    let else_len = n.else_parts.len() as u32;
                                    match else_len {
                                        0 => Action::Done(0),
                                        1 => {
                                            exec.state = ExecBranch::Else;
                                            exec.stmts = bun_ptr::BackRef::new(&n.else_parts[0]);
                                            exec.stmt_idx = 0;
                                            continue;
                                        }
                                        _ => {
                                            exec.state = ExecBranch::Elif { idx: 0 };
                                            exec.stmts = bun_ptr::BackRef::new(&n.else_parts[0]);
                                            exec.stmt_idx = 0;
                                            continue;
                                        }
                                    }
                                }
                                ExecBranch::Then => Action::Done(exec.last_exit_code),
                                ExecBranch::Elif { idx } => {
                                    if exec.last_exit_code == 0 {
                                        // The matching `then` arm follows the
                                        // `elif` cond at `idx + 1`.
                                        let then_idx = *idx + 1;
                                        exec.state = ExecBranch::Then;
                                        exec.stmts =
                                            bun_ptr::BackRef::new(&n.else_parts[then_idx as usize]);
                                        exec.stmt_idx = 0;
                                        continue;
                                    }
                                    *idx += 2;
                                    let else_len = n.else_parts.len() as u32;
                                    if *idx >= else_len {
                                        Action::Done(0)
                                    } else if *idx == else_len - 1 {
                                        exec.state = ExecBranch::Else;
                                        exec.stmts = bun_ptr::BackRef::new(
                                            &n.else_parts[(else_len - 1) as usize],
                                        );
                                        exec.stmt_idx = 0;
                                        continue;
                                    } else {
                                        exec.stmts =
                                            bun_ptr::BackRef::new(&n.else_parts[*idx as usize]);
                                        exec.stmt_idx = 0;
                                        continue;
                                    }
                                }
                                ExecBranch::Else => Action::Done(exec.last_exit_code),
                            }
                        } else {
                            let i = exec.stmt_idx;
                            exec.stmt_idx += 1;
                            // `i` was bounds-checked against `stmts_len()`.
                            let stmt_node: *const ast::Stmt = &raw const exec.stmts()[i as usize];
                            Action::SpawnStmt(stmt_node)
                        }
                    }
                    IfState::WaitingWriteErr => return Yield::suspended(),
                    IfState::Done => panic!("This code should not be reachable"),
                }
            };
            return match action {
                Action::Done(exit) => interp.child_done(parent, this, exit),
                Action::SpawnStmt(stmt_node) => {
                    let (shell, io) = {
                        let me = interp.as_if(this);
                        (me.base.shell, me.io.clone())
                    };
                    let new_stmt = Stmt::init(interp, shell, stmt_node, this, io);
                    Stmt::start(interp, new_stmt)
                }
            };
        }
    }

    pub fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        interp.deinit_node(child);
        let me = interp.as_if_mut(this);
        let IfState::Exec(exec) = &mut me.state else {
            panic!(
                "Expected `exec` state in If, this indicates a bug in Bun. Please file a GitHub issue."
            );
        };
        exec.last_exit_code = exit_code;
        Yield::Next(this)
    }

    pub fn deinit(interp: &Interpreter, this: NodeId) {
        log!("If {} deinit", this);
        interp.as_if_mut(this).base.end_scope();
    }
}

enum Action {
    Done(ExitCode),
    SpawnStmt(*const ast::Stmt),
}

// ported from: src/shell/states/If.zig
