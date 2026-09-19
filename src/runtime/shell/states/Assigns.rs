//! In pipeline expressions, assigns (e.g. `FOO=bar BAR=baz | echo hi`) have
//! no effect on the environment of the shell, so we can skip them.

use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, log};
use crate::shell::states::base::Base;
use crate::shell::states::expansion::Expansion;
use crate::shell::yield_::Yield;
use crate::shell::{EnvStr, ExitCode};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AssignCtx {
    Cmd,
    Shell,
}

pub struct Assigns {
    pub(crate) base: Base,
    /// Points into the AST arena, which outlives every state node — `RawSlice`
    /// invariant.
    pub node: bun_ptr::RawSlice<ast::Assign>,
    pub(crate) state: AssignsState,
    pub ctx: AssignCtx,
    /// Status of the last `$(...)` performed while expanding the values, 0 if
    /// none. An assignment list with no command name completes with it
    /// (POSIX 2.9.1), so `FOO=$(false)` fails the way `false` does.
    cmd_subst_exit_code: ExitCode,
}

#[derive(Default)]
pub enum AssignsState {
    #[default]
    Idle,
    Expanding {
        idx: u32,
    },
    Done,
}

impl Assigns {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &[ast::Assign],
        parent: NodeId,
        ctx: AssignCtx,
    ) -> NodeId {
        interp.alloc_node(Node::Assigns(Assigns {
            base: Base::new(parent, shell),
            // AST arena outlives every state node — `RawSlice` invariant.
            node: bun_ptr::RawSlice::new(node),
            state: AssignsState::Idle,
            ctx,
            cmd_subst_exit_code: 0,
        }))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        loop {
            let (shell, node) = {
                let me = interp.as_assigns(this);
                (me.base.shell, me.node)
            };
            let assigns = node.slice();
            match interp.as_assigns(this).state {
                AssignsState::Idle => {
                    interp.as_assigns_mut(this).state = AssignsState::Expanding { idx: 0 };
                    continue;
                }
                AssignsState::Expanding { idx } => {
                    if (idx as usize) >= assigns.len() {
                        interp.as_assigns_mut(this).state = AssignsState::Done;
                        continue;
                    }
                    let atom: *const ast::Atom = &raw const assigns[idx as usize].value;
                    let child = Expansion::init(interp, shell, atom, this, true);
                    return Expansion::start(interp, child);
                }
                AssignsState::Done => {
                    let (parent, exit_code) = {
                        let me = interp.as_assigns(this);
                        let exit_code = match me.ctx {
                            AssignCtx::Shell => me.cmd_subst_exit_code,
                            // `Cmd` treats a nonzero status from this node as
                            // an expansion failure; the command being prefixed
                            // supplies the status (`FOO=$(false) echo hi` is 0).
                            AssignCtx::Cmd => 0,
                        };
                        (me.base.parent, exit_code)
                    };
                    return interp.child_done(parent, this, exit_code);
                }
            }
        }
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Child is always an Expansion.
        if exit_code != 0 {
            interp.deinit_node(child);
            interp.as_assigns_mut(this).state = AssignsState::Done;
            let parent = interp.as_assigns(this).base.parent;
            return interp.child_done(parent, this, 1);
        }

        let out = Expansion::take_out(interp, child);
        interp.deinit_node(child);

        let (node, ctx) = {
            let me = interp.as_assigns(this);
            (me.node, me.ctx)
        };
        let AssignsState::Expanding { idx } = &mut interp.as_assigns_mut(this).state else {
            unreachable!("Assigns child_done outside Expanding")
        };
        // `idx` was bounds-checked in `next` before spawning the child.
        let assign = &node.slice()[*idx as usize];
        *idx += 1;

        // Expansion reports `out_exit_code` only for a value that is a bare
        // `$(...)` (0 when it succeeded). A value without a substitution leaves
        // the status of an earlier one alone: `FOO=$(exit 3) BAR=x` is 3, while
        // `FOO=$(exit 3) BAR=$(true)` is 0.
        if matches!(
            assign.value,
            ast::Atom::Simple(ast::SimpleAtom::CmdSubst(_))
        ) {
            interp.as_assigns_mut(this).cmd_subst_exit_code = out.out_exit_code;
        }

        // Join multi-word expansions with a single space. `ExpansionOut` stores all words contiguously in `buf`
        // with `bounds` marking inter-word offsets, so the merged value is
        // `buf` with a space inserted at each boundary.
        let value: Vec<u8> = if out.bounds.is_empty() {
            out.buf
        } else {
            let mut merged = Vec::with_capacity(out.buf.len() + out.bounds.len());
            let mut prev = 0usize;
            for &b in &out.bounds {
                merged.extend_from_slice(&out.buf[prev..b as usize]);
                merged.push(b' ');
                prev = b as usize;
            }
            merged.extend_from_slice(&out.buf[prev..]);
            merged
        };

        let value_ref = EnvStr::init_ref_counted(value.into_boxed_slice());
        interp.as_assigns_mut(this).base.shell_mut().assign_var(
            EnvStr::init_slice(assign.label),
            value_ref,
            ctx,
        );
        value_ref.deref();

        Yield::Next(this)
    }

    pub(crate) fn deinit(_interp: &Interpreter, this: NodeId) {
        log!("Assigns {} deinit", this);
    }
}
