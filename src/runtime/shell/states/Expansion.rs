//! Word expansion: tilde, variable, command substitution, brace, and glob.
//!
//! If a word contains command substitution or glob expansion syntax then it
//! needs to be evaluated at runtime — this state node walks the atom and
//! produces zero or more output strings.

use crate::shell::ast;
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, Node, NodeId, ShellExecEnv, ShellExecEnvKind, StateKind, log,
};
use crate::shell::io::{IO, OutKind};
use crate::shell::states::base::Base;
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;
use crate::shell::{ExitCode, ShellErr};

pub struct Expansion {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::Atom>,
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
    /// Spec: Expansion.zig `has_quoted_empty`. Set when a `""`/`''` literal
    /// was seen so an *empty* expansion is still pushed as an argv word.
    /// Without this, `$unset` and `""` are indistinguishable in
    /// [`ExpansionOut`] (both → `buf=[], bounds=[]`) and Cmd would push an
    /// empty arg for unset vars — diverging from POSIX field-splitting.
    pub has_quoted_empty: bool,
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
    /// Spec: Expansion.zig `.err`. The parent inspects this on
    /// `child_done(_, 1)` to print the message.
    Err(ShellErr),
}

#[derive(Default)]
pub struct ExpansionOut {
    pub buf: Vec<u8>,
    /// Word boundaries within `buf` (for IFS splitting / glob results).
    pub bounds: Vec<u32>,
    /// Spec: `Expansion.out_exit_code`. Set when the atom is a sole `$(…)`
    /// that exited non-zero, so [`Cmd::child_done`] can propagate it as the
    /// command's exit code when that substitution was argv0 and argv is
    /// otherwise empty.
    pub out_exit_code: ExitCode,
    /// Spec: Expansion.zig `has_quoted_empty`. When `buf`/`bounds` are both
    /// empty, this distinguishes `""` (push one empty arg) from `$unset`
    /// (push no arg). See [`Expansion::has_quoted_empty`].
    pub has_quoted_empty: bool,
}

#[derive(Clone, Copy, Default)]
pub struct ExpansionOpts {
    pub for_spawn: bool,
    pub single: bool,
}

impl Expansion {
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Atom,
        parent: NodeId,
        io: IO,
        _opts: ExpansionOpts,
    ) -> NodeId {
        interp.alloc_node(Node::Expansion(Expansion {
            base: Base::new(StateKind::Expansion, parent, shell),
            // SAFETY: `node` is non-null and points into the AST arena
            // (`ShellArgs::__arena`), which the interpreter holds for its
            // entire lifetime — strictly outliving every state node (the
            // BackRef invariant). Callers pass `&raw const` only to escape
            // borrowck across the `&Interpreter` reborrow.
            node: unsafe { bun_ptr::BackRef::from_raw(node as *mut ast::Atom) },
            io,
            state: ExpansionState::Idle,
            word_idx: 0,
            out: ExpansionOut::default(),
            current_out: Vec::new(),
            child_script: None,
            cmd_subst_quoted: false,
            has_quoted_empty: false,
            out_exit_code: 0,
        }))
    }

    pub fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    /// Spec: Expansion.zig `next()` + `expandVarAndCmdSubst()`. Walks the
    /// atom, appending no-IO expansions to `current_out` and yielding to a
    /// child `Script` whenever a `$(...)` is encountered. Re-entered after
    /// `child_done` advances `word_idx`.
    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
        loop {
            // Split-borrow: `me` from `nodes`, `vm_args_utf8` from its own
            // field, so `expand_simple_no_io` can expand `$N` without aliasing.
            // R-2: both are `JsCell`-backed; `as_ptr()`/`node_mut()` project
            // disjoint `&mut` from `&Interpreter`.
            let event_loop = interp.event_loop;
            let command_ctx = interp.command_ctx;
            // SAFETY: single-JS-thread; `vm_args_utf8` and `nodes` are
            // disjoint `JsCell` fields (no aliasing between the two borrows).
            let vm_args_utf8 = unsafe { &mut *interp.vm_args_utf8.as_ptr() };
            let me = interp.as_expansion_mut(this);
            match me.state {
                ExpansionState::Idle => {
                    me.state = ExpansionState::Walking;
                    continue;
                }
                ExpansionState::CmdSubst | ExpansionState::Glob => {
                    // Re-entered while a child is in flight.
                    return Yield::suspended();
                }
                ExpansionState::BraceExpand => {
                    Self::do_brace_expand(me);
                    continue;
                }
                ExpansionState::Done | ExpansionState::Err(_) => break,
                ExpansionState::Walking => {}
            }

            // Copy the BackRef out so `atom` borrows a local, leaving `me`
            // free for the `&mut me.*` field writes below.
            let node = me.node;
            let atom = node.get();
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
                let shell = me.base.shell();
                let is_cmd_subst = Self::expand_simple_no_io(
                    shell,
                    simple,
                    &mut me.current_out,
                    &mut me.has_quoted_empty,
                    true,
                    event_loop,
                    command_ctx,
                    vm_args_utf8,
                );
                if !is_cmd_subst {
                    me.word_idx += 1;
                    continue;
                }
                // ── Command substitution: spawn a Script with stdout piped
                //    into a fresh owned buffer. Spec: expandVarAndCmdSubst.
                let ast::SimpleAtom::CmdSubst(sub) = simple else {
                    unreachable!()
                };
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
                let duped = match unsafe { &mut *shell_ptr }
                    .dupe_for_subshell(&io, ShellExecEnvKind::CmdSubst)
                {
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
                let home = me.base.shell().get_homedir();
                match me.current_out.first() {
                    Some(b'/') | Some(b'\\') => {
                        me.current_out.splice(0..0, home.slice().iter().copied());
                    }
                    Some(_) => me.current_out.insert(0, b'~'),
                    // Spec (Expansion.zig 199-202): `~""` expands to $HOME,
                    // but `~$unset` expands to nothing (word is dropped).
                    None if me.has_quoted_empty => {
                        me.current_out.extend_from_slice(home.slice());
                    }
                    None => {}
                }
                home.deref();
            }
            // Spec (Expansion.zig next() lines 209-221): brace expansion
            // first, then glob, else flush as a single word.
            if atom.has_brace_expansion() {
                me.state = ExpansionState::BraceExpand;
                continue;
            }
            if atom.has_glob_expansion() {
                return Self::transition_to_glob_state(interp, this);
            }
            Self::push_current_out(me);
            me.state = ExpansionState::Done;
        }
        let parent = interp.as_expansion(this).base.parent;
        let exit: ExitCode = if matches!(interp.as_expansion(this).state, ExpansionState::Err(_)) {
            1
        } else {
            0
        };
        interp.child_done(parent, this, exit)
    }

    /// Spec: Expansion.zig `.braces` arm. Re-tokenize `current_out` (the
    /// fully-expanded word with `{`/`,`/`}` markers preserved by
    /// `expand_simple_no_io`) and push each variant as a separate argv word.
    fn do_brace_expand(me: &mut Expansion) {
        use bun_shell_parser::braces;
        let brace_str = &me.current_out[..];
        let mut lexer_output = if bun_core::is_all_ascii(brace_str) {
            bun_core::handle_oom(braces::Lexer::tokenize(brace_str))
        } else {
            bun_core::handle_oom(
                braces::NewLexer::<{ braces::StringEncoding::Wtf8 }>::tokenize(brace_str),
            )
        };
        let count = braces::calculate_expanded_amount(&lexer_output.tokens[..]) as usize;
        let mut expanded: Vec<Vec<u8>> = (0..count).map(|_| Vec::new()).collect();

        let arena = bun_alloc::Arena::new();
        if let Err(e) = braces::expand(
            &arena,
            &mut lexer_output.tokens[..],
            &mut expanded[..],
            lexer_output.contains_nested,
        ) {
            // Spec: error.UnexpectedToken → panic. Mirror it.
            panic!("unexpected error from Braces.expand: {e:?}");
        }
        drop(arena);

        // Spec lines 268-279: push each variant as its own word. The Zig
        // version NUL-terminated then `out.pushResult`; the NodeId port
        // records word boundaries via `bounds` instead.
        me.current_out.clear();
        for s in expanded {
            if !me.out.buf.is_empty() {
                me.out.bounds.push(me.out.buf.len() as u32);
            }
            me.out.buf.extend_from_slice(&s);
        }

        let node = me.node;
        let atom = node.get();
        me.state = if atom.has_glob_expansion() {
            // Spec: brace+glob composes — re-enter via the glob arm. The
            // NodeId port currently routes glob through `current_out`, so
            // brace-produced multi-word + glob is left as a TODO (matches the
            // Zig "weird behaviour" note above the spec).
            ExpansionState::Done
        } else {
            ExpansionState::Done
        };
    }

    /// Spec: Expansion.zig `transitionToGlobState`. Kick off an off-thread
    /// glob walk for the assembled pattern in `current_out`.
    fn transition_to_glob_state(interp: &Interpreter, this: NodeId) -> Yield {
        use crate::shell::dispatch_tasks::ShellGlobTask;
        let pattern: Vec<u8>;
        let cwd: Vec<u8>;
        {
            let me = interp.as_expansion_mut(this);
            me.state = ExpansionState::Glob;
            pattern = me.current_out.clone();
            cwd = me.base.shell().cwd().to_vec();
        }
        let walker = match bun_glob::BunGlobWalkerZ::init_with_cwd(
            &pattern, &cwd, false, false, false, false, false, None,
        ) {
            Ok(Ok(w)) => w,
            Ok(Err(e)) => {
                interp.as_expansion_mut(this).state = ExpansionState::Err(ShellErr::new_sys(e));
                return Yield::Next(this);
            }
            Err(e) => {
                interp.as_expansion_mut(this).state =
                    ExpansionState::Err(ShellErr::Custom(e.to_string().into_bytes().into()));
                return Yield::Next(this);
            }
        };
        ShellGlobTask::create_and_schedule(interp, this, walker);
        Yield::suspended()
    }

    /// Spec: Expansion.zig `expandSimpleNoIO`. Appends the no-IO expansion of
    /// one [`ast::SimpleAtom`] to `out`. Returns `true` for `CmdSubst` so the
    /// caller spawns a `Script` for it.
    fn expand_simple_no_io(
        shell: &ShellExecEnv,
        atom: &ast::SimpleAtom,
        out: &mut Vec<u8>,
        has_quoted_empty: &mut bool,
        expand_tilde: bool,
        event_loop: EventLoopHandle,
        command_ctx: *mut bun_options_types::context::ContextData,
        vm_args_utf8: &mut Vec<bun_core::ZigStringSlice>,
    ) -> bool {
        use crate::shell::env_str::EnvStr;
        match atom {
            ast::SimpleAtom::Text(txt) => out.extend_from_slice(txt),
            ast::SimpleAtom::QuotedEmpty => {
                // Spec: Expansion.zig `expandSimpleNoIO` sets
                // `has_quoted_empty = true` so an empty word is still pushed
                // as an arg. The flag is *required* — without it Cmd cannot
                // tell `""` (one empty arg) from `$unset` (no arg), since
                // both leave `out.buf` empty.
                *has_quoted_empty = true;
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
            ast::SimpleAtom::VarArgv(int) => {
                Interpreter::append_var_argv(out, *int, event_loop, command_ctx, vm_args_utf8);
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
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Child is a Script (command substitution). Its captured stdout lives
        // in the duped `ShellExecEnv` it owns; read it before deinit.
        debug_assert!(matches!(interp.node(child).kind(), StateKind::Script));
        // SAFETY: single trampoline frame; the child script's env (and its
        // parent buffer in the `Borrowed` case) has no other live borrow.
        let stdout = unsafe {
            interp
                .as_script_mut(child)
                .base
                .shell_mut()
                .buffered_stdout_mut()
        }
        .clone();

        // Propagate the exit code if the *whole* atom was a single `$(...)`
        // (so `$(false)` as argv0 fails the command). Spec: childDone:517.
        let sole_cmd_subst = matches!(
            interp.as_expansion(this).node.get(),
            ast::Atom::Simple(ast::SimpleAtom::CmdSubst(_))
        );

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
        interp: &Interpreter,
        this: NodeId,
        result: Vec<Vec<u8>>,
        err: Option<crate::shell::dispatch_tasks::ShellGlobErr>,
    ) {
        use crate::shell::dispatch_tasks::ShellGlobErr;
        log!("Expansion {} onGlobWalkDone", this);
        if let Some(err) = err {
            let shell_err = match err {
                ShellGlobErr::Syscall(e) => ShellErr::new_sys(e),
                ShellGlobErr::Unknown(e) => ShellErr::Custom(e.to_string().into_bytes().into()),
            };
            interp.throw(shell_err);
            interp.as_expansion_mut(this).state = ExpansionState::Done;
            Yield::Next(this).run(interp);
            return;
        }

        if result.is_empty() {
            // Spec lines 559-578: in variable assignments a no-match glob
            // expands to the literal pattern; otherwise it's an error.
            let parent = interp.as_expansion(this).base.parent;
            let in_assign = matches!(interp.node(parent).kind(), StateKind::Assign)
                || matches!(
                    interp.node(parent),
                    Node::Cmd(c) if matches!(
                        c.state,
                        crate::shell::states::cmd::CmdState::ExpandingAssigns
                    )
                );
            let me = interp.as_expansion_mut(this);
            if in_assign {
                Self::push_current_out(me);
                me.state = ExpansionState::Done;
            } else {
                let msg = format!("no matches found: {}", bstr::BStr::new(&me.current_out));
                me.state = ExpansionState::Err(ShellErr::Custom(msg.into_bytes().into()));
            }
            Yield::Next(this).run(interp);
            return;
        }

        {
            let me = interp.as_expansion_mut(this);
            // Spec lines 580-588: push each match as its own argv word. The
            // walker arena owns the strings, so they were `to_vec`'d already.
            for entry in result {
                if !me.out.buf.is_empty() {
                    me.out.bounds.push(me.out.buf.len() as u32);
                }
                me.out.buf.extend_from_slice(&entry);
            }
            me.state = ExpansionState::Done;
        }
        Yield::Next(this).run(interp);
    }

    /// Take the error out of `state == Err(_)` (called by the parent on
    /// `child_done(_, 1)` to print it). Leaves `state == Done`.
    pub fn take_err(interp: &Interpreter, this: NodeId) -> Option<ShellErr> {
        let me = interp.as_expansion_mut(this);
        match core::mem::replace(&mut me.state, ExpansionState::Done) {
            ExpansionState::Err(e) => Some(e),
            other => {
                me.state = other;
                None
            }
        }
    }

    pub fn deinit(interp: &Interpreter, this: NodeId) {
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
    pub fn take_out(interp: &Interpreter, this: NodeId) -> ExpansionOut {
        let me = interp.as_expansion_mut(this);
        let mut out = core::mem::take(&mut me.out);
        out.out_exit_code = me.out_exit_code;
        out.has_quoted_empty = me.has_quoted_empty;
        out
    }
}

// ported from: src/shell/states/Expansion.zig
