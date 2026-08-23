//! In pipeline expressions, assigns (e.g. `FOO=bar BAR=baz | echo hi`) have
//! no effect on the environment of the shell, so we can skip them.

use crate::shell::ast;
use crate::shell::interpreter::{EnvRc, Interpreter, Node, NodeId, log};
use crate::shell::states::base::Base;
use crate::shell::states::expansion::Expansion;
use crate::shell::yield_::Yield;
use crate::shell::{EnvStr, ExitCode};
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AssignCtx {
    Cmd,
    Shell,
}

pub struct Assigns {
    pub(crate) base: Base,
    /// Points into the AST arena, which outlives every state node.
    pub node: bun_ptr::BackRef<[ast::Assign]>,
    pub(crate) state: AssignsState,
    pub ctx: AssignCtx,
}

#[derive(Default, Clone, Copy)]
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
        shell: EnvRc,
        node: &[ast::Assign],
        parent: NodeId,
        ctx: AssignCtx,
    ) -> NodeId {
        interp.alloc_node(Node::Assigns(Assigns {
            base: Base::new(parent, shell),
            node: bun_ptr::BackRef::new(node),
            state: AssignsState::Idle,
            ctx,
        }))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        loop {
            let (shell, node) = {
                let me = interp.as_assigns(this);
                (Rc::clone(&me.base.shell), me.node)
            };
            let assigns = node.get();
            let state = interp.as_assigns(this).state;
            match state {
                AssignsState::Idle => {
                    interp.as_assigns_mut(this).state = AssignsState::Expanding { idx: 0 };
                    continue;
                }
                AssignsState::Expanding { idx } => {
                    if (idx as usize) >= assigns.len() {
                        interp.as_assigns_mut(this).state = AssignsState::Done;
                        continue;
                    }
                    let atom = bun_ptr::BackRef::new(&assigns[idx as usize].value);
                    let child = Expansion::init(interp, shell, atom, this, true);
                    return Expansion::start(interp, child);
                }
                AssignsState::Done => {
                    let parent = interp.as_assigns(this).base.parent;
                    return interp.child_done(parent, this, 0);
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
        let label = {
            let mut me = interp.as_assigns_mut(this);
            let AssignsState::Expanding { idx } = &mut me.state else {
                unreachable!("Assigns child_done outside Expanding")
            };
            // `idx` was bounds-checked in `next` before spawning the child.
            let label = node.get()[*idx as usize].label;
            *idx += 1;
            label
        };

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

        let value_ref = EnvStr::init_ref_counted(value);
        interp.as_assigns(this).base.shell_mut().assign_var(
            EnvStr::init_slice(label),
            value_ref,
            ctx,
        );

        Yield::Next(this)
    }

    pub(crate) fn deinit(_interp: &Interpreter, this: NodeId) {
        log!("Assigns {} deinit", this);
    }
}
