//! Word expansion: tilde, variable, command substitution, brace, and glob.
//!
//! If a word contains command substitution or glob expansion syntax then it
//! needs to be evaluated at runtime — this state node walks the atom and
//! produces zero or more output strings.

use crate::shell::ast;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Expansion {
    pub base: Base,
    pub node: *const ast::Atom,
    pub io: IO,
    pub state: ExpansionState,
    /// Output sink the parent provided. The Zig version stored a
    /// `*anyopaque + vtable` so any parent could receive expanded strings;
    /// in the NodeId port the parent is reachable via `base.parent`, so the
    /// sink is just a buffer the parent reads back on `child_done`.
    pub out: ExpansionOut,
    pub child_script: Option<NodeId>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum ExpansionState {
    #[default]
    Idle,
    Walking { idx: u32 },
    CmdSubst,
    Glob,
    BraceExpand,
    Done,
}

#[derive(Default)]
pub struct ExpansionOut {
    pub buf: Vec<u8>,
    /// Word boundaries within `buf` (for IFS splitting / glob results).
    pub bounds: Vec<u32>,
}

#[derive(Clone, Copy, Default)]
pub struct ExpansionOpts {
    pub for_spawn: bool,
    pub single: bool,
}

impl Expansion {
    pub fn init(
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Atom,
        parent: NodeId,
        io: IO,
        _opts: ExpansionOpts,
    ) -> NodeId {
        interp.alloc_node(Node::Expansion(Expansion {
            base: Base::new(StateKind::Expansion, parent, shell),
            node,
            io,
            state: ExpansionState::Idle,
            out: ExpansionOut::default(),
            child_script: None,
        }))
    }

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        // The full body (~700 lines) walks ast::Atom (Simple/Compound), and
        // for each part: appends literals, looks up env vars, spawns a Script
        // for `$(...)` capturing its stdout into `out.buf`, runs brace
        // expansion, and runs glob walk via bun_glob.
        //
        // Gated until: ast::Atom/SimpleAtom/CompoundAtom, bun_glob::GlobWalker,
        // ShellExecEnv::dupe_for_subshell (for $(...)).
        //
        // blocked_on: ast::Atom, bun_glob::GlobWalker, ShellExecEnv::dupe_for_subshell
        let parent = interp.as_expansion(this).base.parent;
        interp.child_done(parent, this, 0)
    }

    pub fn child_done(
        interp: &mut Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Child is a Script (command substitution). Its captured stdout was
        // wired to `out.buf` via the duped ShellExecEnv's _buffered_stdout.
        let _ = exit_code;
        interp.deinit_node(child);
        interp.as_expansion_mut(this).child_script = None;
        Yield::Next(this)
    }

    /// Spec: Expansion.zig `onGlobWalkDone`. Main-thread re-entry for the
    /// off-thread glob walker — splice each match as a separate word into
    /// `out` then resume the atom-walk trampoline.
    pub fn on_glob_walk_done(
        interp: &mut Interpreter,
        this: NodeId,
        result: Vec<Vec<u8>>,
        err: Option<bun_core::Error>,
    ) {
        {
            let me = interp.as_expansion_mut(this);
            for entry in result {
                me.out.buf.extend_from_slice(&entry);
                me.out.bounds.push(me.out.buf.len() as u32);
            }
            me.state = ExpansionState::Done;
        }
        // TODO(b2-blocked): on `err.is_some()` route through
        // `writeFailingError` (IOWriter::enqueue) instead of resuming clean.
        let _ = err;
        Yield::Next(this).run(interp);
    }

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        log!("Expansion {} deinit", this);
        let child = interp.as_expansion_mut(this).child_script.take();
        if let Some(c) = child {
            interp.deinit_node(c);
        }
        let me = interp.as_expansion_mut(this);
        me.out.buf.clear();
        me.out.bounds.clear();
        me.base.end_scope();
    }

    /// Take the expanded output (called by the parent after `child_done`).
    pub fn take_out(interp: &mut Interpreter, this: NodeId) -> ExpansionOut {
        core::mem::take(&mut interp.as_expansion_mut(this).out)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Expansion.zig (1015 lines)
//   confidence: low (NodeId scaffolding only; atom-walk body gated)
//   blocked_on: ast::Atom, bun_glob::GlobWalker, ShellExecEnv::dupe_for_subshell
// ──────────────────────────────────────────────────────────────────────────
