use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId};
use crate::shell::io::IO;
use crate::shell::states::base::{Base, Env};
use crate::shell::states::stmt::Stmt;
use crate::shell::yield_::Yield;

pub(crate) struct If<'a> {
    pub(crate) base: Base,
    pub node: &'a ast::If<'a>,
    pub(crate) io: IO,
    pub(crate) state: IfState<'a>,
    pub(crate) shell: Env,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum IfState<'a> {
    #[default]
    Idle,
    Exec(Exec<'a>),
}

pub struct Exec<'a> {
    pub(crate) state: ExecBranch,
    /// The current `SmolList<ast::Stmt>` being walked.
    pub(crate) stmts: &'a ast::SmolList<'a, ast::Stmt<'a>>,
    pub(crate) stmt_idx: u32,
    pub(crate) last_exit_code: ExitCode,
}

impl Exec<'_> {
    #[inline]
    fn stmts_len(&self) -> u32 {
        self.stmts.len() as u32
    }
}

pub(crate) enum ExecBranch {
    Cond,
    Then,
    Elif { idx: u32 },
    Else,
}

impl<'a> If<'a> {
    pub(crate) fn init(
        interp: &mut Interpreter<'a>,
        shell: Env,
        node: &'a ast::If<'a>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::If(If {
            base: Base::new(parent),
            shell,
            node,
            io,
            state: IfState::Idle,
        }))
    }

    pub(crate) fn start(_interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        let parent = interp.as_if(this).base.parent;
        loop {
            // Read/mutate `state` via a short-lived borrow, decide an action,
            // then drop the borrow before calling back into `interp`.
            let action = {
                let me = interp.as_if_mut(this);
                let n = me.node;
                match &mut me.state {
                    IfState::Idle => {
                        me.state = IfState::Exec(Exec {
                            state: ExecBranch::Cond,
                            stmts: &n.cond,
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
                                        exec.stmts = &n.then;
                                        exec.stmt_idx = 0;
                                        continue;
                                    }
                                    let else_len = n.else_parts.len() as u32;
                                    match else_len {
                                        0 => Action::Done(0),
                                        1 => {
                                            exec.state = ExecBranch::Else;
                                            exec.stmts = &n.else_parts[0];
                                            exec.stmt_idx = 0;
                                            continue;
                                        }
                                        _ => {
                                            exec.state = ExecBranch::Elif { idx: 0 };
                                            exec.stmts = &n.else_parts[0];
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
                                        exec.stmts = &n.else_parts[then_idx as usize];
                                        exec.stmt_idx = 0;
                                        continue;
                                    }
                                    *idx += 2;
                                    let else_len = n.else_parts.len() as u32;
                                    if *idx >= else_len {
                                        Action::Done(0)
                                    } else if *idx == else_len - 1 {
                                        exec.state = ExecBranch::Else;
                                        exec.stmts = &n.else_parts[(else_len - 1) as usize];
                                        exec.stmt_idx = 0;
                                        continue;
                                    } else {
                                        exec.stmts = &n.else_parts[*idx as usize];
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
                            Action::SpawnStmt(&exec.stmts[i as usize])
                        }
                    }
                }
            };
            return match action {
                Action::Done(exit) => interp.child_done(parent, this, exit),
                Action::SpawnStmt(stmt_node) => {
                    let (shell, io) = {
                        let me = interp.as_if(this);
                        (me.shell.id(), me.io)
                    };
                    let new_stmt = Stmt::init(interp, shell, stmt_node, this, io);
                    Stmt::start(interp, new_stmt)
                }
            };
        }
    }

    pub(crate) fn child_done(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        interp.deinit_node(child);
        if interp.interrupted(this) {
            let parent = interp.as_if(this).base.parent;
            return interp.child_done(parent, this, exit_code);
        }
        let me = interp.as_if_mut(this);
        let IfState::Exec(exec) = &mut me.state else {
            panic!(
                "Expected `exec` state in If, this indicates a bug in Bun. Please file a GitHub issue."
            );
        };
        exec.last_exit_code = exit_code;
        Yield::Next(this)
    }
}

pub(crate) enum Action<'a> {
    Done(ExitCode),
    SpawnStmt(&'a ast::Stmt<'a>),
}
