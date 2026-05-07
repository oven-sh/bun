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
        // Spec: Expansion.zig `next()` + `expandVarAndCmdSubst()` +
        // `expandSimpleNoIO()`. Walks the atom and writes the expanded text
        // into `out.buf`.
        //
        // PORT NOTE: this is a synchronous first cut covering the no-IO atom
        // kinds (Text/QuotedEmpty/Var/glob-chars/brace-chars/Tilde). The
        // async paths (CmdSubst → Script spawn, glob → ShellGlobTask, brace
        // expansion) are still gated and fall through with a TODO marker.
        // blocked_on: bun_glob::GlobWalker, ShellExecEnv::dupe_for_subshell
        let me = interp.as_expansion_mut(this);
        if matches!(me.state, ExpansionState::Idle) {
            me.state = ExpansionState::Walking { idx: 0 };
            // SAFETY: `node` points into the AST arena (`ShellArgs::__arena`)
            // which the interpreter holds for its entire lifetime.
            let atom = unsafe { &*me.node };
            let shell = me.base.shell();
            match atom {
                ast::Atom::Simple(s) => {
                    Self::expand_simple_no_io(shell, s, &mut me.out.buf, true);
                }
                ast::Atom::Compound(c) => {
                    // Spec (Expansion.zig next() lines 186-203 +
                    // expandVarAndCmdSubst lines 372-376): a leading Tilde in
                    // a compound is SKIPPED during the atom walk, then
                    // post-processed — prepend $HOME only if the expanded
                    // remainder begins with '/' or '\\', otherwise prepend a
                    // literal '~' (so `~user` stays `~user`, not `<HOME>user`).
                    let leading_tilde = c
                        .atoms
                        .first()
                        .is_some_and(|a| matches!(a, ast::SimpleAtom::Tilde));
                    let start = if leading_tilde { 1 } else { 0 };
                    for s in &c.atoms[start..] {
                        Self::expand_simple_no_io(shell, s, &mut me.out.buf, false);
                    }
                    if leading_tilde {
                        match me.out.buf.first() {
                            None | Some(b'/') | Some(b'\\') => {
                                let home = shell.get_homedir();
                                me.out.buf.splice(0..0, home.slice().iter().copied());
                                home.deref();
                            }
                            _ => me.out.buf.insert(0, b'~'),
                        }
                    }
                }
            }
            me.state = ExpansionState::Done;
        }
        let parent = interp.as_expansion(this).base.parent;
        interp.child_done(parent, this, 0)
    }

    /// Spec: Expansion.zig `expandSimpleNoIO`. Appends the no-IO expansion of
    /// one [`ast::SimpleAtom`] to `out`. Returns `true` for `CmdSubst` (the
    /// caller in the spec then spawns a Script; here that path is still
    /// gated so the return value is currently unused).
    fn expand_simple_no_io(
        shell: &ShellExecEnv,
        atom: &ast::SimpleAtom,
        out: &mut Vec<u8>,
        expand_tilde: bool,
    ) -> bool {
        use crate::shell::env_str::EnvStr;
        match atom {
            ast::SimpleAtom::Text(txt) => out.extend_from_slice(txt),
            ast::SimpleAtom::QuotedEmpty => {
                // Spec: sets `has_quoted_empty = true` so an empty word is
                // still pushed as an arg. The NodeId port's parent already
                // pushes `out.buf` unconditionally (see Cmd::child_done /
                // CondExpr::child_done), so the empty buffer is preserved
                // without a separate flag.
            }
            ast::SimpleAtom::Var(label) => {
                // Spec `expandVar`: shell_env first, then export_env, else "".
                let key = EnvStr::init_slice(label);
                if let Some(v) = shell.shell_env.get(key) {
                    out.extend_from_slice(v.slice());
                    v.deref();
                } else if let Some(v) = shell.export_env.get(EnvStr::init_slice(label)) {
                    out.extend_from_slice(v.slice());
                    v.deref();
                }
            }
            ast::SimpleAtom::VarArgv(_) => {
                // TODO(port): Expansion.zig `expandVarArgv` reaches into
                // `vm.main`/`vm.argv`/`worker.argv`. Empty until the
                // VirtualMachine accessors are wired.
            }
            ast::SimpleAtom::Asterisk => out.push(b'*'),
            ast::SimpleAtom::DoubleAsterisk => out.extend_from_slice(b"**"),
            ast::SimpleAtom::BraceBegin => out.push(b'{'),
            ast::SimpleAtom::BraceEnd => out.push(b'}'),
            ast::SimpleAtom::Comma => out.push(b','),
            ast::SimpleAtom::Tilde => {
                if expand_tilde {
                    let home = shell.get_homedir();
                    out.extend_from_slice(home.slice());
                    home.deref();
                } else {
                    out.push(b'~');
                }
            }
            ast::SimpleAtom::CmdSubst(_) => {
                // TODO(port): spawn Script with stdout captured into `out`.
                // blocked_on: ShellExecEnv::dupe_for_subshell
                return true;
            }
        }
        false
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
