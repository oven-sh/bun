//! https://www.gnu.org/software/bash/manual/bash.html#Bash-Conditional-Expressions

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, StateKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::expansion::{Expansion, ExpansionOpts};
use crate::shell::yield_::Yield;

pub struct CondExpr {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::CondExpr>,
    pub io: IO,
    pub state: CondExprState,
    pub args: Vec<Vec<u8>>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum CondExprState {
    #[default]
    Idle,
    ExpandingArgs {
        idx: u32,
    },
    WaitingStat,
    WaitingWriteErr,
    Done,
}

impl CondExpr {
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::CondExpr,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::CondExpr(CondExpr {
            base: Base::new(StateKind::Condexpr, parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            state: CondExprState::Idle,
            args: Vec::new(),
        }))
    }

    pub fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
        // Spec: CondExpr.zig `next()` — expand each arg via Expansion, then
        // evaluate the operator.
        loop {
            let (shell, node) = {
                let me = interp.as_condexpr(this);
                (me.base.shell, me.node)
            };
            let n = node.get();
            match interp.as_condexpr(this).state {
                CondExprState::Idle => {
                    interp.as_condexpr_mut(this).state = CondExprState::ExpandingArgs { idx: 0 };
                    continue;
                }
                CondExprState::ExpandingArgs { idx } => {
                    if (idx as usize) >= n.args.len() {
                        return Self::command_impl_start(interp, this, n.op);
                    }
                    let atom: *const ast::Atom = n.args.get_const(idx as usize);
                    let io = interp.as_condexpr(this).io.clone();
                    let child = Expansion::init(
                        interp,
                        shell,
                        atom,
                        this,
                        io,
                        ExpansionOpts {
                            for_spawn: false,
                            single: true,
                        },
                    );
                    return Expansion::start(interp, child);
                }
                CondExprState::WaitingStat => return Yield::suspended(),
                CondExprState::WaitingWriteErr => return Yield::suspended(),
                CondExprState::Done => {
                    let parent = interp.as_condexpr(this).base.parent;
                    return interp.child_done(parent, this, 0);
                }
            }
        }
    }

    /// Spec: CondExpr.zig `commandImplStart`. Evaluates the operator against
    /// the expanded `args` and returns the resulting exit code.
    fn command_impl_start(interp: &Interpreter, this: NodeId, op: ast::CondExprOp) -> Yield {
        use ast::CondExprOp as Op;
        let parent = interp.as_condexpr(this).base.parent;
        match op {
            Op::DashC | Op::DashD | Op::DashF => {
                // Spec: empty expansion or empty path → exit 1 (bash always
                // gives 1; Windows `stat("")` can succeed and return cwd's
                // stat, so the empty-path check must be explicit).
                let path_empty = {
                    let me = interp.as_condexpr(this);
                    me.args.is_empty() || me.args[0].is_empty()
                };
                if path_empty {
                    return interp.child_done(parent, this, 1);
                }
                // PORT NOTE: spec posts a `ShellCondExprStatTask` to the
                // thread pool then resumes via `.stat_complete`. The async
                // task plumbing isn't wired into the NodeId trampoline yet,
                // so call `shell_statat` synchronously and evaluate inline.
                // TODO(port): route through ShellCondExprStatTask once
                // ShellTask scheduling is un-gated.
                let (cwd_fd, mut path) = {
                    let me = interp.as_condexpr(this);
                    let cwd_fd = me.base.shell().cwd_fd;
                    (cwd_fd, me.args[0].clone())
                };
                if path.last() != Some(&0) {
                    path.push(0);
                }
                let z = bun_core::ZStr::from_buf(&path, path.len() - 1);
                let stat = crate::shell::interpreter::shell_statat(cwd_fd, z);
                let exit = match stat {
                    Err(_) => 1, // Spec: "bash always gives exit code 1".
                    Ok(st) => {
                        let mode = st.st_mode as _;
                        let ok = match op {
                            Op::DashF => bun_sys::S::ISREG(mode),
                            Op::DashD => bun_sys::S::ISDIR(mode),
                            Op::DashC => bun_sys::S::ISCHR(mode),
                            _ => unreachable!(),
                        };
                        if ok { 0 } else { 1 }
                    }
                };
                interp.child_done(parent, this, exit)
            }
            Op::DashZ => {
                let exit = {
                    let me = interp.as_condexpr(this);
                    if me.args.is_empty() || me.args[0].is_empty() {
                        0
                    } else {
                        1
                    }
                };
                interp.child_done(parent, this, exit)
            }
            Op::DashN => {
                let exit = {
                    let me = interp.as_condexpr(this);
                    if !me.args.is_empty() && !me.args[0].is_empty() {
                        0
                    } else {
                        1
                    }
                };
                interp.child_done(parent, this, exit)
            }
            Op::EqEq => {
                let exit = {
                    let me = interp.as_condexpr(this);
                    let is_eq =
                        me.args.is_empty() || (me.args.len() >= 2 && me.args[0] == me.args[1]);
                    if is_eq { 0 } else { 1 }
                };
                interp.child_done(parent, this, exit)
            }
            Op::NotEq => {
                let exit = {
                    let me = interp.as_condexpr(this);
                    let is_neq = me.args.len() >= 2 && me.args[0] != me.args[1];
                    if is_neq { 0 } else { 1 }
                };
                interp.child_done(parent, this, exit)
            }
            _ => {
                debug_assert!(
                    !ast::CondExprOp::is_supported(op),
                    "supported CondExprOp not handled in command_impl_start"
                );
                // Spec: unsupported op is unreachable (parser rejects it).
                interp.child_done(parent, this, 1)
            }
        }
    }

    /// Spec: CondExpr.zig `onIOWriterChunk` (lines 267-279).
    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        this: NodeId,
        _written: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        let parent = interp.as_condexpr(this).base.parent;
        if let Some(e) = err {
            // Spec: `@intFromEnum(err.?.getErrno())` — recover the positive
            // errno (`to_shell_system_error` negated it).
            let exit_code: ExitCode = e.errno.unsigned_abs() as ExitCode;
            return interp.child_done(parent, this, exit_code);
        }
        if matches!(
            interp.as_condexpr(this).state,
            CondExprState::WaitingWriteErr
        ) {
            return interp.child_done(parent, this, 1);
        }
        crate::shell::interpreter::unreachable_state(
            "CondExpr.onIOWriterChunk",
            <&'static str>::from(&interp.as_condexpr(this).state),
        )
    }

    /// Spec: CondExpr.zig `onStatTaskComplete`. Main-thread re-entry for the
    /// off-thread `stat`/`lstat` posted by a unary file-test operator.
    pub fn on_stat_task_done(
        interp: &Interpreter,
        this: NodeId,
        stat: &bun_sys::Result<bun_sys::Stat>,
        path: &[u8],
    ) {
        // Spec: CondExpr.zig `onStatTaskComplete` + `.stat_complete` arm of
        // `next()` — evaluate `op` against the stat result.
        let _ = path;
        debug_assert!(matches!(
            interp.as_condexpr(this).state,
            CondExprState::WaitingStat
        ));
        let op = interp.as_condexpr(this).node.op;
        let exit = match stat {
            Err(_) => 1,
            Ok(st) => {
                let mode = st.st_mode as _;
                let ok = match op {
                    ast::CondExprOp::DashF => bun_sys::S::ISREG(mode),
                    ast::CondExprOp::DashD => bun_sys::S::ISDIR(mode),
                    ast::CondExprOp::DashC => bun_sys::S::ISCHR(mode),
                    _ => {
                        unreachable!("CondExprOp does not need stat(); this indicates a bug in Bun")
                    }
                };
                if ok { 0 } else { 1 }
            }
        };
        let parent = interp.as_condexpr(this).base.parent;
        interp.child_done(parent, this, exit).run(interp);
    }

    pub fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Child is always an Expansion that produced one arg.
        // Spec: CondExpr.zig `childDone` — on nonzero, write the failing
        // error and finish; otherwise collect the expanded word and advance.
        if exit_code != 0 {
            // TODO(port): writeFailingError("{f}\n", err) — IOWriter path.
            interp.deinit_node(child);
            let parent = interp.as_condexpr(this).base.parent;
            return interp.child_done(parent, this, exit_code);
        }
        let out = Expansion::take_out(interp, child);
        interp.deinit_node(child);
        {
            let me = interp.as_condexpr_mut(this);
            me.args.push(out.buf);
            if let CondExprState::ExpandingArgs { ref mut idx } = me.state {
                *idx += 1;
            }
        }
        Yield::Next(this)
    }

    pub fn deinit(interp: &Interpreter, this: NodeId) {
        log!("CondExpr {} deinit", this);
        let me = interp.as_condexpr_mut(this);
        me.args.clear();
        me.base.end_scope();
    }
}

// ported from: src/shell/states/CondExpr.zig
