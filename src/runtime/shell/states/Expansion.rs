//! Word expansion: tilde, variable, command substitution, brace, and glob.
//!
//! If a word contains command substitution or glob expansion syntax then it
//! needs to be evaluated at runtime — this state node walks the atom and
//! produces zero or more output strings.

use crate::shell::ast;
use crate::shell::interpreter::{
    log, Interpreter, Node, NodeId, ShellExecEnv, ShellExecEnvKind, StateKind,
};
use crate::shell::io::{IO, OutKind};
use crate::shell::states::base::Base;
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;
use crate::shell::{ExitCode, ShellErr};

pub struct Expansion {
    pub base: Base,
    pub node: *const ast::Atom,
    pub io: IO,
    pub state: ExpansionState,
    /// Index of the next sub-atom to expand. For `Atom::Simple` this is 0/1;
    /// for `Atom::Compound` it walks `c.atoms`. Spec: Expansion.zig `word_idx`.
    pub word_idx: u32,
    /// Output sink the parent provided. The Zig version stored a
    /// `*anyopaque + vtable` so any parent could receive expanded strings;
    /// in the NodeId port the parent is reachable via `base.parent`, so the
    /// sink is just a buffer the parent reads back on `child_done`.
    pub out: ExpansionOut,
    /// Working buffer for the *current* word being assembled. When a word
    /// boundary is hit (IFS split / glob result), it is flushed into `out`
    /// via `push_current_out`. Spec: Expansion.zig `current_out`.
    pub current_out: Vec<u8>,
    pub child_script: Option<NodeId>,
    /// Whether the in-flight command substitution was `"$(...)"` (no IFS
    /// splitting on its result). Only meaningful while `state == CmdSubst`.
    pub cmd_subst_quoted: bool,
    /// Exit code of a sole-command-substitution arg. Spec: Expansion.zig
    /// `out_exit_code` — propagated to `Cmd` so `$(false)` as argv0 fails.
    pub out_exit_code: ExitCode,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum ExpansionState {
    #[default]
    Idle,
    Walking,
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
            word_idx: 0,
            out: ExpansionOut::default(),
            current_out: Vec::new(),
            child_script: None,
            cmd_subst_quoted: false,
            out_exit_code: 0,
        }))
    }

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    /// Spec: Expansion.zig `next()` + `expandVarAndCmdSubst()`. Walks the
    /// atom, appending no-IO expansions to `current_out` and yielding to a
    /// child `Script` whenever a `$(...)` is encountered. Re-entered after
    /// `child_done` advances `word_idx`.
    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        loop {
            let me = interp.as_expansion_mut(this);
            match me.state {
                ExpansionState::Idle => {
                    me.state = ExpansionState::Walking;
                    continue;
                }
                ExpansionState::CmdSubst | ExpansionState::Glob | ExpansionState::BraceExpand => {
                    // Re-entered while a child is in flight.
                    return Yield::suspended();
                }
                ExpansionState::Done => break,
                ExpansionState::Walking => {}
            }

            // SAFETY: `node` points into the AST arena (`ShellArgs::__arena`)
            // which the interpreter holds for its entire lifetime.
            let atom = unsafe { &*me.node };
            let atoms_len = atom.atoms_len();
            // Leading `~` in a compound is skipped during the walk and
            // post-processed below (Spec: Expansion.zig next() lines 186-203).
            let leading_tilde = matches!(atom, ast::Atom::Compound(c)
                if c.atoms.first().is_some_and(|a| matches!(a, ast::SimpleAtom::Tilde)));
            if me.word_idx == 0 && leading_tilde {
                me.word_idx = 1;
            }

            let shell_ptr: *mut ShellExecEnv = me.base.shell;
            while me.word_idx < atoms_len {
                let simple: &ast::SimpleAtom = match atom {
                    ast::Atom::Simple(s) => s,
                    ast::Atom::Compound(c) => &c.atoms[me.word_idx as usize],
                };
                // SAFETY: `shell_ptr` is a live env owned by the parent state
                // node; the Expansion never outlives it.
                let shell = unsafe { &*shell_ptr };
                let is_cmd_subst =
                    Self::expand_simple_no_io(shell, simple, &mut me.current_out, true);
                if !is_cmd_subst {
                    me.word_idx += 1;
                    continue;
                }
                // ── Command substitution: spawn a Script with stdout piped
                //    into a fresh owned buffer. Spec: expandVarAndCmdSubst.
                let ast::SimpleAtom::CmdSubst(sub) = simple else { unreachable!() };
                let quoted = sub.quoted;
                let script_ast: *const ast::Script = &raw const sub.script;
                me.state = ExpansionState::CmdSubst;
                me.cmd_subst_quoted = quoted;

                let io = IO {
                    stdin: interp.root_io().stdin.clone(),
                    stdout: OutKind::Pipe,
                    stderr: interp.root_io().stderr.clone(),
                };
                // SAFETY: `shell_ptr` is a live env owned by the parent state
                // node and outlives this expansion.
                let duped = match unsafe {
                    (*shell_ptr).dupe_for_subshell(&io, ShellExecEnvKind::CmdSubst)
                } {
                    Ok(d) => d,
                    Err(e) => {
                        drop(io);
                        interp.throw(ShellErr::new_sys(e));
                        return Yield::failed();
                    }
                };
                let script = Script::init(interp, duped, script_ast, this, io);
                interp.as_expansion_mut(this).child_script = Some(script);
                return Script::start(interp, script);
            }

            // All sub-atoms expanded — post-process leading tilde then finish.
            if leading_tilde {
                // SAFETY: see above.
                let home = unsafe { &*shell_ptr }.get_homedir();
                match me.current_out.first() {
                    None | Some(b'/') | Some(b'\\') => {
                        me.current_out.splice(0..0, home.slice().iter().copied());
                    }
                    _ => me.current_out.insert(0, b'~'),
                }
                home.deref();
            }
            // TODO(port): brace + glob expansion (Expansion.zig `.braces` /
            // `.glob` arms). For now flush the assembled word.
            Self::push_current_out(me);
            me.state = ExpansionState::Done;
        }
        let parent = interp.as_expansion(this).base.parent;
        interp.child_done(parent, this, 0)
    }

    /// Spec: Expansion.zig `expandSimpleNoIO`. Appends the no-IO expansion of
    /// one [`ast::SimpleAtom`] to `out`. Returns `true` for `CmdSubst` so the
    /// caller spawns a `Script` for it.
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
            ast::SimpleAtom::CmdSubst(_) => return true,
        }
        false
    }

    /// Spec: Expansion.zig `pushCurrentOut`. Flush `current_out` into `out`
    /// as the next argv word. The word boundary is recorded as the *previous*
    /// end-offset so the consumer's `[prev..bound]` slicing reconstructs each
    /// word and the trailing `[prev..]` slice yields the final one.
    fn push_current_out(me: &mut Expansion) {
        if !me.out.buf.is_empty() {
            me.out.bounds.push(me.out.buf.len() as u32);
        }
        me.out.buf.append(&mut me.current_out);
    }

    /// Spec: Expansion.zig `postSubshellExpansion` + `convertNewlinesToSpaces`.
    /// Newlines→spaces, trim, then split on whitespace runs into separate
    /// argv words.
    fn post_subshell_expansion(me: &mut Expansion, mut stdout: Vec<u8>) {
        // Strip a single trailing newline, then convert remaining newlines
        // to spaces.
        if stdout.last() == Some(&b'\n') {
            stdout.pop();
        }
        for b in stdout.iter_mut() {
            if *b == b'\n' {
                *b = b' ';
            }
        }
        // Trim leading/trailing whitespace.
        let s: &[u8] = {
            let mut lo = 0usize;
            let mut hi = stdout.len();
            while lo < hi && matches!(stdout[lo], b' ' | b'\n' | b'\r' | b'\t') {
                lo += 1;
            }
            while hi > lo && matches!(stdout[hi - 1], b' ' | b'\n' | b'\r' | b'\t') {
                hi -= 1;
            }
            &stdout[lo..hi]
        };
        if s.is_empty() {
            return;
        }
        // Split on runs of spaces — each run is a word boundary.
        let mut prev_ws = false;
        let mut a = 0usize;
        for (i, &c) in s.iter().enumerate() {
            if prev_ws {
                if c != b' ' {
                    a = i;
                    prev_ws = false;
                }
                continue;
            }
            if c == b' ' {
                prev_ws = true;
                me.current_out.extend_from_slice(&s[a..i]);
                Self::push_current_out(me);
            }
        }
        me.current_out.extend_from_slice(&s[a..]);
    }

    pub fn child_done(
        interp: &mut Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Child is a Script (command substitution). Its captured stdout lives
        // in the duped `ShellExecEnv` it owns; read it before deinit.
        debug_assert!(matches!(interp.node(child).kind(), StateKind::Script));
        // SAFETY: `base.shell` is the env duped in `next()` and owned by the
        // child Script; freed by `deinit_node` below.
        let stdout = unsafe {
            let env = interp.as_script_mut(child).base.shell;
            (*(*env).buffered_stdout()).clone()
        };

        // Propagate the exit code if the *whole* atom was a single `$(...)`
        // (so `$(false)` as argv0 fails the command). Spec: childDone:517.
        let sole_cmd_subst = {
            // SAFETY: `node` points into the AST arena which outlives every
            // state node.
            matches!(unsafe { &*interp.as_expansion(this).node },
                ast::Atom::Simple(ast::SimpleAtom::CmdSubst(_)))
        };

        let quoted = interp.as_expansion(this).cmd_subst_quoted;
        {
            let me = interp.as_expansion_mut(this);
            if exit_code != 0 && sole_cmd_subst {
                me.out_exit_code = exit_code;
            }
            if quoted {
                let mut hi = stdout.len();
                while hi > 0 && matches!(stdout[hi - 1], b' ' | b'\n' | b'\r' | b'\t') {
                    hi -= 1;
                }
                me.current_out.extend_from_slice(&stdout[..hi]);
            } else {
                Self::post_subshell_expansion(me, stdout);
            }
            me.word_idx += 1;
            me.state = ExpansionState::Walking;
            me.child_script = None;
        }
        interp.deinit_node(child);
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
        me.current_out.clear();
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
//   confidence: low-medium — no-IO atom walk + command substitution ported;
//               brace + glob expansion still TODO
//   blocked_on: bun_glob::GlobWalker
// ──────────────────────────────────────────────────────────────────────────
