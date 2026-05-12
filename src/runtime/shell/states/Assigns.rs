//! In pipeline expressions, assigns (e.g. `FOO=bar BAR=baz | echo hi`) have
//! no effect on the environment of the shell, so we can skip them.

use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, StateKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::expansion::{Expansion, ExpansionOpts};
use crate::shell::yield_::Yield;
use crate::shell::{EnvStr, ExitCode};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AssignCtx {
    Cmd,
    Shell,
    Exported,
}

pub struct Assigns {
    pub base: Base,
    /// Points into the AST arena, which outlives every state node — `RawSlice`
    /// invariant.
    pub node: bun_ptr::RawSlice<ast::Assign>,
    pub io: IO,
    pub state: AssignsState,
    pub ctx: AssignCtx,
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
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &[ast::Assign],
        parent: NodeId,
        ctx: AssignCtx,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Assigns(Assigns {
            base: Base::new(StateKind::Assign, parent, shell),
            // AST arena outlives every state node — `RawSlice` invariant.
            node: bun_ptr::RawSlice::new(node),
            io,
            state: AssignsState::Idle,
            ctx,
        }))
    }

    pub fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
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
                    let io = interp.as_assigns(this).io.clone();
                    let child = Expansion::init(
                        interp,
                        shell,
                        atom,
                        this,
                        io,
                        ExpansionOpts {
                            for_spawn: false,
                            single: false,
                        },
                    );
                    return Expansion::start(interp, child);
                }
                AssignsState::Done => {
                    let parent = interp.as_assigns(this).base.parent;
                    return interp.child_done(parent, this, 0);
                }
            }
        }
    }

    pub fn child_done(
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
        let label = node.slice()[*idx as usize].label;
        *idx += 1;

        // Join multi-word expansions with a single space (Spec: Assigns.zig
        // childDone). `ExpansionOut` stores all words contiguously in `buf`
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

        let value_ref = EnvStr::init_ref_counted(&value);
        interp.as_assigns_mut(this).base.shell_mut().assign_var(
            EnvStr::init_slice(label),
            value_ref,
            ctx,
        );
        value_ref.deref();

        Yield::Next(this)
    }

    pub fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Assigns {} deinit", this);
        interp.as_assigns_mut(this).base.end_scope();
    }
}

// ported from: src/shell/states/Assigns.zig
