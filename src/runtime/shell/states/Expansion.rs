//! This state node is used for expansions.
//!
//! If a word contains command substitution or glob expansion syntax then it
//! needs to do IO, so we have to keep track of the state for that.
//!
//! TODO PERF: in the case of expanding cmd args, we probably want to use the spawn args arena
//! otherwise the interpreter allocator

use core::ffi::{c_char, c_void};
use core::fmt;
use core::mem::{offset_of, MaybeUninit};

use bun_core::{self, Error};
use bun_jsc::{self as jsc, EventLoopHandle, EventLoopTask, JSGlobalObject, JSValue, ZigString};
use bun_output::{declare_scope, scoped_log};
// TODO(port): verify bun_str owned NUL-terminated buffer type name (ZStrBuf assumed; ZStr::from_bytes per PORTING.md §Allocators).
use bun_str::{strings, ZStr, ZStrBuf};
use bun_sys as Syscall;
use bun_threading::{WorkPool, WorkPoolTask};

use crate::shell::interpret::{
    self, Arena, Braces, EnvStr, GlobWalker, StatePtrUnion, OOM,
};
use crate::shell::interpreter::{
    Assigns, Cmd, CondExpr, Interpreter, Script, ShellExecEnv, State, Subshell, IO,
};
use crate::shell::{ast, ExitCode, ShellErr, Yield};

declare_scope!(ShellGlobTask, hidden);

pub struct Expansion<'a> {
    pub base: State,
    pub node: &'a ast::Atom,
    pub parent: ParentPtr,
    pub io: IO,

    pub word_idx: u32,
    pub current_out: Vec<u8>,
    pub state: ExpansionState,
    pub child_state: ChildState,
    pub out_exit_code: ExitCode, // = 0
    pub out: Result<'a>,
    pub out_idx: u32,
    /// Set when the word contains a quoted_empty atom, indicating that an empty
    /// result should still be preserved as an argument (POSIX: `""` produces an empty arg).
    pub has_quoted_empty: bool, // = false
}

pub enum ExpansionState {
    Normal,
    Braces,
    Glob,
    Done,
    Err(ShellErr),
}

pub enum ChildState {
    Idle,
    CmdSubst {
        cmd: Box<Script>,
        quoted: bool, // = false
    },
    // TODO
    Glob {
        initialized: bool, // = false
        walker: GlobWalker,
    },
}

pub type ParentPtr = StatePtrUnion<(Cmd, Assigns, CondExpr, Subshell)>;

pub type ChildPtr = StatePtrUnion<(
    // Cmd,
    Script,
)>;

pub enum Result<'a> {
    ArrayOfSlice(&'a mut Vec<ZStrBuf>),
    ArrayOfPtr(&'a mut Vec<Option<*const c_char>>),
    Single {
        list: &'a mut Vec<u8>,
        done: bool, // = false
    },
}

pub enum PushAction {
    /// We just copied the buf into the result, caller can just do
    /// `.clearRetainingCapacity()`
    Copied,
    /// We took ownershipo of the result and placed the pointer in the buf,
    /// caller should remove any references to the underlying data.
    Moved,
}

impl<'a> Result<'a> {
    pub fn push_result_slice_owned(&mut self, buf: ZStrBuf) -> PushAction {
        // ZStrBuf guarantees trailing NUL by construction; Zig's debug_assert(buf[len]==0) is implicit.
        match self {
            Result::ArrayOfSlice(list) => {
                list.push(buf);
                PushAction::Moved
            }
            Result::ArrayOfPtr(list) => {
                // TODO(port): lifetime — ZStrBuf is leaked into a raw ptr; caller must free.
                list.push(Some(buf.into_raw() as *const c_char));
                PushAction::Moved
            }
            Result::Single { list, done } => {
                if *done {
                    return PushAction::Copied;
                }
                list.extend_from_slice(buf.as_bytes_with_nul());
                *done = true;
                PushAction::Copied
            }
        }
    }

    pub fn push_result(&mut self, buf: &mut Vec<u8>) -> PushAction {
        if cfg!(debug_assertions) {
            debug_assert!(buf[buf.len() - 1] == 0);
        }

        match self {
            Result::ArrayOfSlice(list) => {
                // buf.items[0 .. buf.items.len - 1 :0] — move ownership of buf's allocation
                // into the list (Zig aliased the storage; caller is told `Moved`).
                let owned = core::mem::take(buf);
                // SAFETY: last byte is 0 (asserted above); ZStrBuf adopts the allocation without copy.
                let zbuf = unsafe { ZStrBuf::from_vec_with_nul_unchecked(owned) };
                list.push(zbuf);
                PushAction::Moved
            }
            Result::ArrayOfPtr(list) => {
                list.push(Some(buf.as_ptr() as *const c_char));
                PushAction::Moved
            }
            Result::Single { list, done } => {
                if *done {
                    return PushAction::Copied;
                }
                list.extend_from_slice(&buf[..]);
                PushAction::Copied
            }
        }
    }
}

impl<'a> fmt::Display for Expansion<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Expansion(0x{:x})", self as *const _ as usize)
    }
}

impl<'a> Expansion<'a> {
    // TODO(port): allocator() returned the state's scoped allocator; in Rust the global mimalloc
    // is used everywhere except arenas. Kept as a no-op accessor for diff parity.
    pub fn allocator(&self) -> () {
        // self.base.allocator()
    }

    // PORT NOTE: reshaped from out-param constructor `fn init(.., expansion: *Expansion, ..) void`.
    // TODO(port): in-place init — Expansion is likely a pre-allocated slot in the parent state.
    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::Atom,
        parent: ParentPtr,
        out_result: Result<'a>,
        io: IO,
    ) -> Self {
        // log("Expansion(0x{x}) init", ...) — pointer not available pre-construction
        scoped_log!(interpret, "Expansion init");
        let base = State::init_borrowed_alloc_scope(
            StateKind::Expansion,
            interpreter,
            shell_state,
            parent.scoped_allocator(),
        );
        Self {
            node,
            base,
            parent,

            word_idx: 0,
            state: ExpansionState::Normal,
            child_state: ChildState::Idle,
            out: out_result,
            out_idx: 0,
            current_out: Vec::new(),
            io,
            out_exit_code: 0,
            has_quoted_empty: false,
        }
    }

    pub fn start(&mut self) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(matches!(self.child_state, ChildState::Idle));
            debug_assert!(self.word_idx == 0);
        }

        self.state = ExpansionState::Normal;
        Yield::Expansion(self)
    }

    pub fn next(&mut self) -> Yield {
        while !matches!(self.state, ExpansionState::Done | ExpansionState::Err(_)) {
            match self.state {
                ExpansionState::Normal => {
                    // initialize
                    if self.word_idx == 0 {
                        let mut has_unknown = false;
                        // + 1 for sentinel
                        let string_size = self.expansion_size_hint(self.node, &mut has_unknown);
                        self.current_out.reserve(string_size + 1);
                    }

                    while self.word_idx < self.node.atoms_len() {
                        if let Some(yield_) = self.expand_var_and_cmd_subst(self.word_idx) {
                            return yield_;
                        }
                    }

                    if self.word_idx >= self.node.atoms_len() {
                        if self.node.has_tilde_expansion() && self.node.atoms_len() > 1 {
                            let homedir = self.base.shell.get_homedir();
                            // `defer homedir.deref()` — Drop on EnvStr decrements the refcount at scope exit.
                            if !self.current_out.is_empty() {
                                match self.current_out[0] {
                                    b'/' | b'\\' => {
                                        // insertSlice(0, ..)
                                        self.current_out.splice(0..0, homedir.slice().iter().copied());
                                    }
                                    _ => {
                                        // TODO: Handle username
                                        self.current_out.insert(0, b'~');
                                    }
                                }
                            } else if self.has_quoted_empty {
                                // ~"" or ~'' should expand to the home directory
                                self.current_out.extend_from_slice(homedir.slice());
                            }
                        }

                        // NOTE brace expansion + cmd subst has weird behaviour we don't support yet, ex:
                        // echo $(echo a b c){1,2,3}
                        // >> a b c1 a b c2 a b c3
                        if self.node.has_brace_expansion() {
                            self.state = ExpansionState::Braces;
                            continue;
                        }

                        if self.node.has_glob_expansion() {
                            self.state = ExpansionState::Glob;
                            continue;
                        }

                        self.push_current_out();
                        self.state = ExpansionState::Done;
                        continue;
                    }

                    // Shouldn't fall through to here
                    debug_assert!(self.word_idx >= self.node.atoms_len());
                    return Yield::Suspended;
                }
                ExpansionState::Braces => {
                    // PERF(port): was arena bulk-free — profile in Phase B
                    let brace_str = &self.current_out[..];
                    let mut lexer_output = if strings::is_all_ascii(brace_str) {
                        // @branchHint(.likely)
                        Braces::Lexer::tokenize(brace_str).expect("oom")
                    } else {
                        Braces::NewLexer::<{ Encoding::Wtf8 }>::tokenize(brace_str).expect("oom")
                    };
                    let expansion_count =
                        Braces::calculate_expanded_amount(&lexer_output.tokens[..]);

                    const STACK_MAX: usize = 16;
                    const _: () = assert!(
                        core::mem::size_of::<&[Vec<u8>]>() * STACK_MAX <= 256
                    );
                    // PERF(port): was stack-fallback — profile in Phase B
                    let mut expanded_strings: Vec<Vec<u8>> =
                        (0..expansion_count).map(|_| Vec::new()).collect();

                    match Braces::expand(
                        &lexer_output.tokens[..],
                        &mut expanded_strings,
                        lexer_output.contains_nested,
                    ) {
                        Ok(()) => {}
                        Err(e) if e == bun_core::err!("OutOfMemory") => bun_core::out_of_memory(),
                        Err(e) if e == bun_core::err!("UnexpectedToken") => {
                            panic!("unexpected error from Braces.expand: UnexpectedToken")
                        }
                        Err(_) => unreachable!(),
                    }

                    self.out_ensure_unused_capacity(expansion_count);

                    // Add sentinel values
                    for i in 0..expansion_count {
                        expanded_strings[i].push(0);
                        match self.out.push_result(&mut expanded_strings[i]) {
                            PushAction::Copied => {
                                // expanded_strings[i].deinit() — Drop handles it
                            }
                            PushAction::Moved => {
                                expanded_strings[i].clear();
                            }
                        }
                    }

                    if self.node.has_glob_expansion() {
                        self.state = ExpansionState::Glob;
                    } else {
                        self.state = ExpansionState::Done;
                    }
                }
                ExpansionState::Glob => {
                    return self.transition_to_glob_state();
                }
                ExpansionState::Done | ExpansionState::Err(_) => unreachable!(),
            }
        }

        if matches!(self.state, ExpansionState::Done) {
            return self.parent.child_done(self, 0);
        }

        // Parent will inspect the `this.state.err`
        if matches!(self.state, ExpansionState::Err(_)) {
            return self.parent.child_done(self, 1);
        }

        unreachable!()
    }

    fn transition_to_glob_state(&mut self) -> Yield {
        // PERF(port): was arena bulk-free — Arena passed to GlobWalker; Phase B verify ownership.
        let mut arena = Arena::new();
        self.child_state = ChildState::Glob {
            initialized: false,
            walker: GlobWalker::default(),
        };
        let pattern = &self.current_out[..];

        let cwd = self.base.shell.cwd();

        let ChildState::Glob { walker, .. } = &mut self.child_state else {
            unreachable!()
        };
        match GlobWalker::init_with_cwd(
            walker, &mut arena, pattern, cwd, false, false, false, false, false,
        )
        .expect("oom")
        {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(e) => {
                drop(arena);
                self.child_state = ChildState::Idle;
                self.state = ExpansionState::Err(ShellErr::new_sys(e));
                return Yield::Expansion(self);
            }
        }

        let task = ShellGlobTask::create_on_main_thread(walker, self);
        task.schedule();
        Yield::Suspended
    }

    pub fn expand_var_and_cmd_subst(&mut self, start_word_idx: u32) -> Option<Yield> {
        match self.node {
            ast::Atom::Simple(simp) => {
                let is_cmd_subst = self.expand_simple_no_io::<true>(simp, &mut self.current_out);
                // PORT NOTE: reshaped for borrowck — `simp` borrow vs &mut self.current_out.
                if is_cmd_subst {
                    let mut io = IO {
                        stdin: self.base.root_io().stdin.ref_(),
                        stdout: IOKind::Pipe,
                        stderr: self.base.root_io().stderr.ref_(),
                    };
                    let shell_state = match self.base.shell.dupe_for_subshell(
                        self.base.alloc_scope(),
                        io.clone(),
                        SubshellKind::CmdSubst,
                    ) {
                        bun_sys::Result::Ok(s) => s,
                        bun_sys::Result::Err(e) => {
                            io.deref();
                            self.base.throw(&ShellErr::new_sys(e));
                            return Some(Yield::Failed);
                        }
                    };
                    let ast::Atom::Simple(ast::SimpleAtom::CmdSubst(cs)) = self.node else {
                        unreachable!()
                    };
                    let script = Script::init(
                        self.base.interpreter,
                        shell_state,
                        &cs.script,
                        Script::ParentPtr::init(self),
                        io,
                    );
                    let quoted = cs.quoted;
                    self.child_state = ChildState::CmdSubst {
                        cmd: script,
                        quoted,
                    };
                    // PORT NOTE: reshaped for borrowck — re-borrow the moved Box<Script> from child_state
                    // so that child_state is assigned BEFORE script.start(), matching Zig control flow.
                    let ChildState::CmdSubst { cmd, .. } = &mut self.child_state else {
                        unreachable!()
                    };
                    return Some(cmd.start());
                } else {
                    self.word_idx += 1;
                }
            }
            ast::Atom::Compound(cmp) => {
                // The tilde is always the first atom of the compound word. Skip it only on the
                // initial pass (start_word_idx == 0); when we re-enter after a command
                // substitution completes, `start_word_idx` already points at the next atom to
                // process and applying the offset again would skip it.
                let starting_offset: usize =
                    if start_word_idx == 0 && self.node.has_tilde_expansion() {
                        self.word_idx += 1;
                        1
                    } else {
                        0
                    };
                for simple_atom in &cmp.atoms[start_word_idx as usize + starting_offset..] {
                    let is_cmd_subst =
                        self.expand_simple_no_io::<true>(simple_atom, &mut self.current_out);
                    // PORT NOTE: reshaped for borrowck.
                    if is_cmd_subst {
                        let mut io = IO {
                            stdin: self.base.root_io().stdin.ref_(),
                            stdout: IOKind::Pipe,
                            stderr: self.base.root_io().stderr.ref_(),
                        };
                        let shell_state = match self.base.shell.dupe_for_subshell(
                            self.base.alloc_scope(),
                            io.clone(),
                            SubshellKind::CmdSubst,
                        ) {
                            bun_sys::Result::Ok(s) => s,
                            bun_sys::Result::Err(e) => {
                                io.deref();
                                self.base.throw(&ShellErr::new_sys(e));
                                return Some(Yield::Failed);
                            }
                        };
                        let ast::SimpleAtom::CmdSubst(cs) = simple_atom else {
                            unreachable!()
                        };
                        let script = Script::init(
                            self.base.interpreter,
                            shell_state,
                            &cs.script,
                            Script::ParentPtr::init(self),
                            io,
                        );
                        let quoted = cs.quoted;
                        self.child_state = ChildState::CmdSubst {
                            cmd: script,
                            quoted,
                        };
                        // PORT NOTE: reshaped for borrowck — re-borrow from child_state so assignment
                        // precedes script.start(), matching Zig control flow.
                        let ChildState::CmdSubst { cmd, .. } = &mut self.child_state else {
                            unreachable!()
                        };
                        return Some(cmd.start());
                    } else {
                        self.word_idx += 1;
                        self.child_state = ChildState::Idle;
                    }
                }
            }
        }

        None
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        if cfg!(debug_assertions) {
            debug_assert!(!matches!(
                self.state,
                ExpansionState::Done | ExpansionState::Err(_)
            ));
            debug_assert!(!matches!(self.child_state, ChildState::Idle));
        }

        // Command substitution
        if child.ptr.is::<Script>() {
            if cfg!(debug_assertions) {
                debug_assert!(matches!(self.child_state, ChildState::CmdSubst { .. }));
            }

            // This branch is true means that we expanded
            // a single command substitution and it failed.
            //
            // This information is propagated to `Cmd` because in the case
            // that the command substitution would be expanded to the
            // command name (e.g. `$(lkdfjsldf)`), and it fails, the entire
            // command should fail with the exit code of the command
            // substitution.
            if exit_code != 0
                && matches!(self.node, ast::Atom::Simple(ast::SimpleAtom::CmdSubst(_)))
            {
                self.out_exit_code = exit_code;
            }

            let ChildState::CmdSubst { cmd, quoted } = &self.child_state else {
                unreachable!()
            };
            let stdout = cmd.base.shell.buffered_stdout().slice();
            if !*quoted {
                // TODO(port): borrowck — postSubshellExpansion mutates self while borrowing
                // child_state. In Zig the slice aliases the child's buffer. Phase B: copy or
                // restructure ownership.
                self.post_subshell_expansion(stdout);
            } else {
                let trimmed = strings::trim_right(stdout, b" \n\t\r");
                self.current_out.extend_from_slice(trimmed);
            }

            self.word_idx += 1;
            self.child_state = ChildState::Idle;
            child.deinit();
            return Yield::Expansion(self);
        }

        panic!("Invalid child to Expansion, this indicates a bug in Bun. Please file a report on Github.");
    }

    fn on_glob_walk_done(&mut self, task: &mut ShellGlobTask) -> Yield {
        scoped_log!(interpret, "{} onGlobWalkDone", self);
        if cfg!(debug_assertions) {
            debug_assert!(matches!(self.child_state, ChildState::Glob { .. }));
        }

        if let Some(err) = &task.err {
            match err {
                ShellGlobTaskErr::Syscall(sys) => {
                    self.base.throw(&ShellErr::new_sys(*sys));
                }
                ShellGlobTaskErr::Unknown(errtag) => {
                    self.base.throw(&ShellErr::Custom(
                        Box::<[u8]>::from(errtag.name().as_bytes()),
                    ));
                }
            }
        }

        if task.result.is_empty() {
            // In variable assignments, a glob that fails to match should not produce an error, but instead expand to just the pattern
            if self.parent.ptr.is::<Assigns>()
                || (self.parent.ptr.is::<Cmd>()
                    && matches!(
                        self.parent.ptr.as_::<Cmd>().state,
                        CmdState::ExpandingAssigns
                    ))
            {
                self.push_current_out();
                if let ChildState::Glob { walker, .. } = &mut self.child_state {
                    walker.deinit(true);
                }
                self.child_state = ChildState::Idle;
                self.state = ExpansionState::Done;
                return Yield::Expansion(self);
            }

            let pattern = if let ChildState::Glob { walker, .. } = &self.child_state {
                walker.pattern.as_ref()
            } else {
                unreachable!()
            };
            let mut msg = Vec::new();
            use std::io::Write as _;
            write!(&mut msg, "no matches found: {}", bstr::BStr::new(pattern)).unwrap();
            self.state = ExpansionState::Err(ShellErr::Custom(msg.into_boxed_slice()));
            if let ChildState::Glob { walker, .. } = &mut self.child_state {
                walker.deinit(true);
            }
            self.child_state = ChildState::Idle;
            return Yield::Expansion(self);
        }

        for sentinel_str in &task.result {
            // The string is allocated in the glob walker arena and will be freed, so needs to be duped here
            // allocator.dupeZ(u8, ..) → bun_str::ZStr::from_bytes (PORTING.md §Allocators).
            let duped = ZStr::from_bytes(sentinel_str.as_bytes());
            match self.out.push_result_slice_owned(duped) {
                PushAction::Copied => {
                    // allocator().free(duped) — Drop handles it (already moved into push)
                }
                PushAction::Moved => {}
            }
        }

        self.word_idx += 1;
        if let ChildState::Glob { walker, .. } = &mut self.child_state {
            walker.deinit(true);
        }
        self.child_state = ChildState::Idle;
        self.state = ExpansionState::Done;
        Yield::Expansion(self)
    }

    /// If the atom is actually a command substitution then does nothing and returns true
    pub fn expand_simple_no_io<const EXPAND_TILDE: bool>(
        &mut self,
        atom: &ast::SimpleAtom,
        str_list: &mut Vec<u8>,
    ) -> bool {
        match atom {
            ast::SimpleAtom::Text(txt) => {
                str_list.extend_from_slice(txt);
            }
            ast::SimpleAtom::QuotedEmpty => {
                // A quoted empty string ("", '', or ${''}). We must ensure the word
                // is not dropped by pushCurrentOut, so mark it with a flag.
                self.has_quoted_empty = true;
            }
            ast::SimpleAtom::Var(label) => {
                str_list.extend_from_slice(self.expand_var(label));
            }
            ast::SimpleAtom::VarArgv(int) => {
                str_list.extend_from_slice(self.expand_var_argv(*int));
            }
            ast::SimpleAtom::Asterisk => {
                str_list.push(b'*');
            }
            ast::SimpleAtom::DoubleAsterisk => {
                str_list.extend_from_slice(b"**");
            }
            ast::SimpleAtom::BraceBegin => {
                str_list.push(b'{');
            }
            ast::SimpleAtom::BraceEnd => {
                str_list.push(b'}');
            }
            ast::SimpleAtom::Comma => {
                str_list.push(b',');
            }
            ast::SimpleAtom::Tilde => {
                if EXPAND_TILDE {
                    let homedir = self.base.shell.get_homedir();
                    // `defer homedir.deref()` — Drop on EnvStr decrements the refcount at scope exit.
                    str_list.extend_from_slice(homedir.slice());
                } else {
                    str_list.push(b'~');
                }
            }
            ast::SimpleAtom::CmdSubst(_) => {
                // TODO:
                // if the command substution is comprised of solely shell variable assignments then it should do nothing
                // if (atom.cmd_subst.* == .assigns) return false;
                return true;
            }
        }
        false
    }

    pub fn append_slice(&self, buf: &mut Vec<u8>, slice: &[u8]) {
        let _ = self;
        buf.extend_from_slice(slice);
    }

    pub fn push_current_out(&mut self) {
        if self.current_out.is_empty() && !self.has_quoted_empty {
            return;
        }
        if self.current_out.is_empty() || self.current_out[self.current_out.len() - 1] != 0 {
            self.current_out.push(0);
        }
        match self.out.push_result(&mut self.current_out) {
            PushAction::Copied => {
                self.current_out.clear();
            }
            PushAction::Moved => {
                self.current_out = Vec::new();
            }
        }
    }

    fn expand_var(&self, label: &[u8]) -> &[u8] {
        let value = self
            .base
            .shell
            .shell_env
            .get(EnvStr::init_slice(label))
            .or_else(|| self.base.shell.export_env.get(EnvStr::init_slice(label)));
        let Some(value) = value else {
            return b"";
        };
        // `defer value.deref()` — Drop on EnvStr decrements the refcount at scope exit.
        // TODO(port): verify slice lifetime — slice borrows env-map storage which outlives the EnvStr handle.
        value.slice()
    }

    fn expand_var_argv(&self, original_int: u8) -> &[u8] {
        let mut int = original_int;
        match &self.base.interpreter.event_loop {
            EventLoopHandle::Js(event_loop) => {
                if int == 0 {
                    return bun_core::self_exe_path().unwrap_or(b"");
                }
                int -= 1;

                let vm = event_loop.virtual_machine;
                if !vm.main.is_empty() {
                    if int == 0 {
                        return vm.main;
                    }
                    int -= 1;
                }

                if let Some(worker) = vm.worker {
                    if usize::from(int) >= worker.argv.len() {
                        return b"";
                    }
                    return self.base.interpreter.get_vm_args_utf8(&worker.argv, int);
                }
                let argv = &vm.argv;
                if usize::from(int) >= argv.len() {
                    return b"";
                }
                &argv[usize::from(int)]
            }
            EventLoopHandle::Mini(_) => {
                let ctx = &self.base.interpreter.command_ctx;
                if usize::from(int) >= 1 + ctx.passthrough.len() {
                    return b"";
                }
                if int == 0 {
                    return &ctx.positionals[ctx.positionals.len() - 1 - usize::from(int)];
                }
                &ctx.passthrough[usize::from(int) - 1]
            }
        }
    }

    fn current_word(&self) -> &ast::SimpleAtom {
        match self.node {
            ast::Atom::Simple(s) => s,
            ast::Atom::Compound(c) => &c.atoms[self.word_idx as usize],
        }
    }

    /// Returns the size of the atom when expanded.
    /// If the calculation cannot be computed trivially (cmd substitution, brace expansion), this value is not accurate and `has_unknown` is set to true
    fn expansion_size_hint(&self, atom: &ast::Atom, has_unknown: &mut bool) -> usize {
        match atom {
            ast::Atom::Simple(s) => self.expansion_size_hint_simple(s, has_unknown),
            ast::Atom::Compound(c) => {
                if c.brace_expansion_hint {
                    *has_unknown = true;
                }

                let mut out: usize = 0;
                for simple in c.atoms.iter() {
                    out += self.expansion_size_hint_simple(simple, has_unknown);
                }
                out
            }
        }
    }

    fn expansion_size_hint_simple(&self, simple: &ast::SimpleAtom, has_unknown: &mut bool) -> usize {
        match simple {
            ast::SimpleAtom::Text(txt) => txt.len(),
            ast::SimpleAtom::QuotedEmpty => 0,
            ast::SimpleAtom::Var(label) => self.expand_var(label).len(),
            ast::SimpleAtom::VarArgv(int) => self.expand_var_argv(*int).len(),
            ast::SimpleAtom::BraceBegin
            | ast::SimpleAtom::BraceEnd
            | ast::SimpleAtom::Comma
            | ast::SimpleAtom::Asterisk => 1,
            ast::SimpleAtom::DoubleAsterisk => 2,
            ast::SimpleAtom::CmdSubst(_subst) => {
                // TODO check if the command substitution is comprised entirely of assignments or zero-sized things
                // if (@as(ast.CmdOrAssigns.Tag, subst.*) == .assigns) {
                //     return 0;
                // }
                *has_unknown = true;
                0
            }
            ast::SimpleAtom::Tilde => {
                *has_unknown = true;
                0
            }
        }
    }

    fn out_ensure_unused_capacity(&mut self, additional: usize) {
        match &mut self.out {
            Result::ArrayOfPtr(list) => {
                list.reserve(additional);
            }
            Result::ArrayOfSlice(list) => {
                list.reserve(additional);
            }
            Result::Single { .. } => {}
        }
    }

    /// 1. Turn all newlines into spaces
    /// 2. Strip last newline if it exists
    /// 3. Trim leading, trailing, and consecutive whitespace
    fn post_subshell_expansion(&mut self, stdout_: &mut [u8]) {
        // 1. and 2.
        let stdout = convert_newlines_to_spaces(stdout_);

        // Trim leading & trailing whitespace
        let stdout = trim(stdout, b" \n  \r\t");
        if stdout.is_empty() {
            return;
        }

        // Trim consecutive
        let mut prev_whitespace: bool = false;
        let mut a: usize = 0;
        let mut b: usize = 1;
        for (i, &c) in stdout.iter().enumerate() {
            if prev_whitespace {
                if c != b' ' {
                    a = i;
                    b = i + 1;
                    prev_whitespace = false;
                }
                continue;
            }

            b = i + 1;
            if c == b' ' {
                b = i;
                prev_whitespace = true;
                self.current_out.extend_from_slice(&stdout[a..b]);
                self.push_current_out();
            }
        }
        // "aa bbb"

        self.current_out.extend_from_slice(&stdout[a..b]);
    }
}

impl<'a> Drop for Expansion<'a> {
    fn drop(&mut self) {
        scoped_log!(
            interpret,
            "Expansion(0x{:x}) deinit",
            self as *const _ as usize
        );
        // current_out: Vec<u8> dropped automatically
        // io.deinit() — IO has its own Drop
        self.base.end_scope();
    }
}

/// Remove a set of values from the beginning and end of a slice.
pub fn trim<'s>(slice: &'s mut [u8], values_to_strip: &[u8]) -> &'s mut [u8] {
    let mut begin: usize = 0;
    let mut end: usize = slice.len();
    while begin < end && values_to_strip.contains(&slice[begin]) {
        begin += 1;
    }
    while end > begin && values_to_strip.contains(&slice[end - 1]) {
        end -= 1;
    }
    &mut slice[begin..end]
}

fn convert_newlines_to_spaces(stdout_: &mut [u8]) -> &mut [u8] {
    let stdout: &mut [u8] = 'brk: {
        if stdout_.is_empty() {
            return stdout_;
        }
        let len = stdout_.len();
        if stdout_[len.saturating_sub(1)] == b'\n' {
            break 'brk &mut stdout_[..len.saturating_sub(1)];
        }
        break 'brk &mut stdout_[..];
    };

    if stdout.is_empty() {
        return stdout;
    }

    // From benchmarks the SIMD stuff only is faster when chars >= 64
    if stdout.len() < 64 {
        convert_newlines_to_spaces_slow(0, stdout);
        return &mut stdout[..];
    }

    // PERF(port): Zig used @Vector(16, u8) SIMD select. Port via core::simd or highway in Phase B.
    // TODO(port): SIMD newline→space replacement
    let mut i: usize = 0;
    while i + 16 <= stdout.len() {
        for b in &mut stdout[i..i + 16] {
            if *b == b'\n' {
                *b = b' ';
            }
        }
        i += 16;
    }

    if i < stdout.len() {
        convert_newlines_to_spaces_slow(i, stdout);
    }
    &mut stdout[..]
}

fn convert_newlines_to_spaces_slow(i: usize, stdout: &mut [u8]) {
    for j in i..stdout.len() {
        if stdout[j] == b'\n' {
            stdout[j] = b' ';
        }
    }
}

pub struct ShellGlobTask<'a> {
    pub task: WorkPoolTask, // = .{ .callback = &run_from_thread_pool }

    /// Not owned by this struct
    pub expansion: *mut Expansion<'a>,
    /// Not owned by this struct
    pub walker: &'a mut GlobWalker,

    pub result: Vec<ZStrBuf>,
    pub event_loop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
    // This is a poll because we want it to enter the uSockets loop
    pub ref_: bun_aio::KeepAlive, // = .{}
    pub err: Option<ShellGlobTaskErr>, // = None
    pub alloc_scope: bun_alloc::AllocationScope,
}

pub enum ShellGlobTaskErr {
    Syscall(Syscall::Error),
    Unknown(bun_core::Error),
}

impl ShellGlobTaskErr {
    // TODO(port): move to *_jsc — to_js belongs in a jsc-aware crate via extension trait.
    pub fn to_js(&self, global_this: &JSGlobalObject) -> JSValue {
        match self {
            ShellGlobTaskErr::Syscall(err) => err.to_js(global_this),
            ShellGlobTaskErr::Unknown(err) => {
                ZigString::from_bytes(err.name().as_bytes()).to_js(global_this)
            }
        }
    }
}

impl<'a> ShellGlobTask<'a> {
    pub fn create_on_main_thread(
        walker: &'a mut GlobWalker,
        expansion: *mut Expansion<'a>,
    ) -> Box<Self> {
        scoped_log!(ShellGlobTask, "createOnMainThread");
        // PERF(port): Zig used AllocationScope wrapping default_allocator; global mimalloc here.
        let alloc_scope = bun_alloc::AllocationScope::init();
        // SAFETY: expansion is a valid back-pointer to the creator (BACKREF per LIFETIMES.tsv).
        let event_loop = unsafe { (*expansion).base.event_loop() };
        let mut this = Box::new(Self {
            alloc_scope,
            task: WorkPoolTask {
                callback: Self::run_from_thread_pool,
            },
            event_loop,
            concurrent_task: EventLoopTask::from_event_loop(event_loop),
            walker,
            expansion,
            result: Vec::new(),
            ref_: bun_aio::KeepAlive::default(),
            err: None,
        });

        this.ref_.ref_(this.event_loop);

        this
    }

    pub fn run_from_thread_pool(task: *mut WorkPoolTask) {
        scoped_log!(ShellGlobTask, "runFromThreadPool");
        // SAFETY: task points to ShellGlobTask.task
        let this: &mut Self = unsafe {
            &mut *((task as *mut u8).sub(offset_of!(Self, task)).cast::<Self>())
        };
        match this.walk_impl() {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(e) => {
                this.err = Some(ShellGlobTaskErr::Syscall(e));
            }
        }
        this.on_finish();
    }

    fn walk_impl(&mut self) -> bun_sys::Result<()> {
        scoped_log!(ShellGlobTask, "walkImpl");

        let mut iter = GlobWalker::Iterator {
            walker: self.walker,
        };
        // defer iter.deinit() — Drop on GlobWalker::Iterator
        match iter.init().expect("oom") {
            bun_sys::Result::Err(err) => return bun_sys::Result::Err(err),
            _ => {}
        }

        loop {
            let next = match iter.next() {
                Ok(v) => v,
                Err(e) => OOM(e),
            };
            let path = match next {
                bun_sys::Result::Err(err) => return bun_sys::Result::Err(err),
                bun_sys::Result::Ok(matched_path) => matched_path,
            };
            let Some(path) = path else { break };
            self.result.push(path);
        }

        bun_sys::Result::Ok(())
    }

    pub fn run_from_main_thread(&mut self) {
        scoped_log!(ShellGlobTask, "runFromJS");
        // SAFETY: expansion is a valid back-pointer set in create_on_main_thread.
        unsafe { (*self.expansion).on_glob_walk_done(self) }.run();
        self.ref_.unref(self.event_loop);
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut c_void) {
        self.run_from_main_thread();
    }

    pub fn schedule(&mut self) {
        scoped_log!(ShellGlobTask, "schedule");
        WorkPool::schedule(&mut self.task);
    }

    pub fn on_finish(&mut self) {
        scoped_log!(ShellGlobTask, "onFinish");
        if matches!(self.event_loop, EventLoopHandle::Js(_)) {
            self.event_loop
                .js()
                .enqueue_task_concurrent(self.concurrent_task.js().from(self, ManualDeinit));
        } else {
            self.event_loop
                .mini()
                .enqueue_task_concurrent(
                    self.concurrent_task.mini().from(self, "runFromMainThreadMini"),
                );
        }
    }

    // PORT NOTE: Zig `pub fn deinit` — body only freed owned fields, so per PORTING.md it would
    // normally vanish into Drop. Kept as `close(self)` (explicit-early-release exception) because
    // the event-loop concurrent task is registered with `.manual_deinit` and calls this explicitly.
    // TODO(port): verify event-loop callback name/shape; may collapse to plain Box drop in Phase B.
    pub fn close(self: Box<Self>) {
        scoped_log!(ShellGlobTask, "deinit");
        // result: Vec / alloc_scope dropped automatically by Box drop.
        drop(self);
    }
}

// TODO(port): placeholder imports for types referenced by name but defined elsewhere in bun_shell.
use crate::shell::interpreter::{CmdState, IOKind, StateKind, SubshellKind};
// TODO(port): Braces::NewLexer encoding enum location.
use crate::shell::braces::Encoding;
// TODO(port): ManualDeinit tag for concurrent_task.from(self, .manual_deinit).
use bun_jsc::ManualDeinit;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Expansion.zig (914 lines)
//   confidence: medium
//   todos:      12
//   notes:      Borrowck reshaping around child_state/node aliasing; ZStrBuf owned-type name and SIMD newline replacement need Phase B attention.
// ──────────────────────────────────────────────────────────────────────────
