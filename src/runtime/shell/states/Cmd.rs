//! A shell primarily runs commands, so this is the main big mac daddy state node, the
//! bread and butter, the fuel that makes this lil shell scripting language go.
//!
//! There are two kinds of commands we are going to run:
//! - builtins: commands we implement natively in Zig and which run in the
//!             current Bun process (see `Builtin.zig` and the `builtins` folder)
//!
//! - subprocesses: commands which run in a new process

use core::ffi::c_char;
use core::fmt;
use core::mem::MaybeUninit;
use std::rc::Rc;

use bun_alloc::Arena;
use bun_collections::BabyList;
use bun_core::which;
use bun_jsc::{self as jsc, EventLoopTask, SystemError};
use bun_paths as paths;
use bun_str::{self as strings, ZStr};

use crate::shell::ast;
use crate::shell::interpret::{
    log, stderr_no, stdin_no, stdout_no, CowFd, ShellSyscall, StatePtrUnion,
};
use crate::shell::subproc::{self, ShellSubprocess as Subprocess, Stdio};
use crate::shell::{ExitCode, ShellErr, Yield};

use super::{
    Assigns, Async, Binary, Builtin, Expansion, Interpreter, Pipeline, ShellExecEnv, State, Stmt,
    IO,
};

bun_output::declare_scope!(SHELL, hidden);

pub struct Cmd<'a> {
    pub base: State,
    pub node: &'a ast::Cmd,
    pub parent: ParentPtr,

    /// Arena used for memory needed to spawn command.
    /// For subprocesses:
    ///   - allocates argv, env array, etc.
    ///   - Freed after calling posix spawn since its not needed anymore
    /// For Builtins:
    ///   - allocates argv, sometimes used by the builtin for small allocations.
    ///   - Freed when builtin is done (since it contains argv which might be used at any point)
    ///
    /// TODO: Change to `AllocationScope`. This will allow us to track memory misuse in debug
    ///       builds
    pub spawn_arena: core::mem::ManuallyDrop<Arena>,
    pub spawn_arena_freed: bool,

    // TODO(port): lifetime — entries are NUL-terminated argv strings owned by `base.allocator()`
    pub args: Vec<Option<*const c_char>>,

    /// If the cmd redirects to a file we have to expand that string.
    /// Allocated in `spawn_arena`
    // PERF(port): was `ArrayList(u8)` backed by spawn_arena (bulk-freed); using heap Vec — profile in Phase B
    pub redirection_file: Vec<u8>,
    pub redirection_fd: Option<Rc<CowFd>>,

    /// The underlying state to manage the command (builtin or subprocess)
    pub exec: Exec,
    pub exit_code: Option<ExitCode>,
    pub io: IO,

    pub state: CmdState,
}

pub enum CmdState {
    Idle,
    ExpandingAssigns(Assigns),
    ExpandingRedirect { idx: u32, expansion: Expansion },
    ExpandingArgs { idx: u32, expansion: Expansion },
    Exec,
    Done,
    WaitingWriteErr,
}

/// If a subprocess and its stdout/stderr exit immediately, we queue
/// completion of this `Cmd` onto the event loop to avoid having the Cmd
/// unexpectedly deinitalizing deeper in the callstack and becoming
/// undefined memory.
pub struct ShellAsyncSubprocessDone {
    pub cmd: *mut Cmd<'static>,
    pub concurrent_task: EventLoopTask,
}

impl fmt::Display for ShellAsyncSubprocessDone {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "ShellAsyncSubprocessDone(0x{:x}, cmd=0{:x})",
            self as *const _ as usize, self.cmd as usize
        )
    }
}

impl ShellAsyncSubprocessDone {
    pub fn enqueue(&mut self) {
        bun_output::scoped_log!(SHELL, "{} enqueue", self);
        let ctx = self as *mut Self;
        // SAFETY: cmd is valid until childDone runs (BACKREF; queued for main thread)
        let evtloop = unsafe { (*self.cmd).base.event_loop() };

        match evtloop {
            jsc::EventLoopHandle::Js(js) => {
                js.enqueue_task_concurrent(self.concurrent_task.js().from(ctx, jsc::TaskDeinit::ManualDeinit));
            }
            jsc::EventLoopHandle::Mini(mini) => {
                mini.enqueue_task_concurrent(self.concurrent_task.mini().from(ctx, "runFromMainThreadMini"));
            }
        }
    }

    pub fn run_from_main_thread_mini(&mut self, _: *mut core::ffi::c_void) {
        self.run_from_main_thread();
    }

    pub fn run_from_main_thread(&mut self) {
        bun_output::scoped_log!(SHELL, "{} runFromMainThread", self);
        let this = self as *mut Self;
        // Zig: `defer this.deinit()` — free self AFTER `.run()`
        // SAFETY: allocated via Box::new in buffered_output_close; reclaimed at scope exit
        let _guard = scopeguard::guard(this, |p| drop(unsafe { Box::from_raw(p) }));
        // SAFETY: cmd is alive until parent.child_done consumes it
        let cmd = unsafe { &mut *self.cmd };
        let exit_code = cmd.exit_code.unwrap_or(0);
        cmd.parent.child_done(cmd, exit_code).run();
    }
}

pub enum Exec {
    None,
    Bltn(Builtin),
    Subproc {
        child: Box<Subprocess>,
        buffered_closed: BufferedIoClosed,
    },
}

#[derive(Default)]
pub struct BufferedIoClosed {
    pub stdin: Option<bool>,
    pub stdout: Option<BufferedIoState>,
    pub stderr: Option<BufferedIoState>,
}

pub struct BufferedIoState {
    pub state: BufferedIoStateKind,
}

pub enum BufferedIoStateKind {
    Open,
    Closed(BabyList<u8>),
}

impl Default for BufferedIoState {
    fn default() -> Self {
        Self { state: BufferedIoStateKind::Open }
    }
}

impl Drop for BufferedIoState {
    fn drop(&mut self) {
        // The closed buffer was taken via PipeReader.takeBuffer(); we own it
        // regardless of the original stdio variant.
        if let BufferedIoStateKind::Closed(list) = &mut self.state {
            list.clear_and_free();
        }
    }
}

impl BufferedIoState {
    pub fn closed(&self) -> bool {
        matches!(self.state, BufferedIoStateKind::Closed(_))
    }
}

pub enum CloseIo<'r> {
    Stdout(&'r mut subproc::Readable),
    Stderr(&'r mut subproc::Readable),
    Stdin,
}

impl BufferedIoClosed {
    fn all_closed(&self) -> bool {
        let ret = self.stdin.unwrap_or(true)
            && self.stdout.as_ref().map(|s| s.closed()).unwrap_or(true)
            && self.stderr.as_ref().map(|s| s.closed()).unwrap_or(true);
        bun_output::scoped_log!(
            SHELL,
            "BufferedIOClosed(0x{:x}) all_closed={} stdin={} stdout={} stderr={}",
            self as *const _ as usize,
            ret,
            self.stdin.unwrap_or(true),
            self.stdout.as_ref().map(|s| s.closed()).unwrap_or(true),
            self.stderr.as_ref().map(|s| s.closed()).unwrap_or(true)
        );
        ret
    }

    fn close(&mut self, cmd: &mut Cmd, io: CloseIo<'_>) {
        match io {
            CloseIo::Stdout(readable) => {
                if let Some(stdout) = &mut self.stdout {
                    // If the shell state is piped (inside a cmd substitution) aggregate the output of this command
                    if matches!(cmd.io.stdout, IO::OutKind::Pipe(_))
                        && matches!(cmd.io.stdout, IO::OutKind::Pipe(_))
                        && !cmd.node.redirect.redirects_elsewhere(ast::RedirectTarget::Stdout)
                    {
                        let the_slice = readable.pipe.slice();
                        cmd.base.shell.buffered_stdout().extend_from_slice(the_slice);
                    }

                    let buffer = readable.pipe.take_buffer();
                    stdout.state = BufferedIoStateKind::Closed(BabyList::move_from_list(buffer));
                }
            }
            CloseIo::Stderr(readable) => {
                if let Some(stderr) = &mut self.stderr {
                    // If the shell state is piped (inside a cmd substitution) aggregate the output of this command
                    if matches!(cmd.io.stderr, IO::OutKind::Pipe(_))
                        && matches!(cmd.io.stderr, IO::OutKind::Pipe(_))
                        && !cmd.node.redirect.redirects_elsewhere(ast::RedirectTarget::Stderr)
                    {
                        let the_slice = readable.pipe.slice();
                        cmd.base.shell.buffered_stderr().extend_from_slice(the_slice);
                    }

                    let buffer = readable.pipe.take_buffer();
                    stderr.state = BufferedIoStateKind::Closed(BabyList::move_from_list(buffer));
                }
            }
            CloseIo::Stdin => {
                self.stdin = Some(true);
            }
        }
    }

    // PERF(port): was comptime enum dispatch — profile in Phase B
    fn is_buffered(&self, io: BufferedIoSlot) -> bool {
        match io {
            BufferedIoSlot::Stdout => self.stdout.is_some(),
            BufferedIoSlot::Stderr => self.stderr.is_some(),
            BufferedIoSlot::Stdin => self.stdin.is_some(),
        }
    }

    fn from_stdio(io: &[Stdio; 3]) -> BufferedIoClosed {
        BufferedIoClosed {
            stdin: if io[stdin_no].is_piped() { Some(false) } else { None },
            stdout: if io[stdout_no].is_piped() { Some(BufferedIoState::default()) } else { None },
            stderr: if io[stderr_no].is_piped() { Some(BufferedIoState::default()) } else { None },
        }
    }
}

#[derive(Clone, Copy)]
pub enum BufferedIoSlot {
    Stdout,
    Stderr,
    Stdin,
}

pub type ParentPtr = StatePtrUnion<(
    Stmt,
    Binary,
    Pipeline,
    Async,
    // Expansion,
    // TODO
    // .subst = void,
)>;

pub type ChildPtr = StatePtrUnion<(
    Assigns,
    Expansion,
)>;

impl<'a> Cmd<'a> {
    pub fn is_subproc(&self) -> bool {
        matches!(self.exec, Exec::Subproc { .. })
    }

    /// If starting a command results in an error (failed to find executable in path for example)
    /// then it should write to the stderr of the entire shell script process
    pub fn write_failing_error(&mut self, args: fmt::Arguments<'_>) -> Yield {
        fn enqueue_cb(ctx: &mut Cmd) {
            ctx.state = CmdState::WaitingWriteErr;
        }
        self.base.shell.write_failing_error_fmt(self, enqueue_cb, args)
    }

    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: &'a ast::Cmd,
        parent: ParentPtr,
        io: IO,
    ) -> *mut Cmd<'a> {
        let cmd = parent.create::<Cmd>();
        // SAFETY: parent.create returns uninitialized storage owned by the parent's pool
        unsafe {
            core::ptr::write(
                cmd,
                Cmd {
                    base: State::init_with_new_alloc_scope(State::Kind::Cmd, interpreter, shell_state),
                    node,
                    parent,

                    spawn_arena: core::mem::ManuallyDrop::new(Arena::new()),
                    spawn_arena_freed: false,
                    args: Vec::with_capacity(node.name_and_args.len()),
                    // PERF(port): was arena-backed ArrayList(u8)
                    redirection_file: Vec::new(),
                    redirection_fd: None,

                    exec: Exec::None,
                    exit_code: None,
                    io,
                    state: CmdState::Idle,
                },
            );
        }
        cmd
    }

    pub fn next(&mut self) -> Yield {
        while !matches!(self.state, CmdState::Done) {
            match &mut self.state {
                CmdState::Idle => {
                    // TODO(port): in-place init of Assigns into enum payload
                    // SAFETY: overwritten by Assigns::init_borrowed below before any read
                    self.state = CmdState::ExpandingAssigns(unsafe {
                        MaybeUninit::<Assigns>::uninit().assume_init()
                    });
                    let CmdState::ExpandingAssigns(assigns) = &mut self.state else { unreachable!() };
                    Assigns::init_borrowed(
                        assigns,
                        self.base.interpreter,
                        self.base.shell,
                        self.node.assigns,
                        Assigns::Ctx::Cmd,
                        Assigns::ParentPtr::init(self),
                        self.io.copy(),
                    );
                    return assigns.start();
                }
                CmdState::ExpandingAssigns(_) => {
                    return Yield::Suspended;
                }
                CmdState::ExpandingRedirect { idx, expansion } => {
                    if *idx >= 1 {
                        self.state = CmdState::ExpandingArgs {
                            idx: 0,
                            // SAFETY: expansion is initialized by Expansion::init on the next loop iteration before any read
                            expansion: unsafe { MaybeUninit::uninit().assume_init() },
                        };
                        continue;
                    }
                    *idx += 1;

                    // Get the node to expand otherwise go straight to
                    // `expanding_args` state
                    let node_to_expand = 'brk: {
                        if let Some(ast::RedirectFile::Atom(atom)) = &self.node.redirect_file {
                            break 'brk atom;
                        }
                        self.state = CmdState::ExpandingArgs {
                            idx: 0,
                            // SAFETY: expansion is initialized by Expansion::init on the next loop iteration before any read
                            expansion: unsafe { MaybeUninit::uninit().assume_init() },
                        };
                        continue;
                    };

                    // PERF(port): was arena-backed ArrayList(u8)
                    self.redirection_file = Vec::new();

                    Expansion::init(
                        self.base.interpreter,
                        self.base.shell,
                        expansion,
                        node_to_expand,
                        Expansion::ParentPtr::init(self),
                        Expansion::Out::Single { list: &mut self.redirection_file },
                        self.io.copy(),
                    );

                    return expansion.start();
                }
                CmdState::ExpandingArgs { idx, expansion } => {
                    if *idx as usize >= self.node.name_and_args.len() {
                        return self.transition_to_exec_state_and_yield();
                    }

                    self.args.reserve(1);
                    Expansion::init(
                        self.base.interpreter,
                        self.base.shell,
                        expansion,
                        &self.node.name_and_args[*idx as usize],
                        Expansion::ParentPtr::init(self),
                        Expansion::Out::ArrayOfPtr(&mut self.args),
                        self.io.copy(),
                    );

                    *idx += 1;

                    return expansion.start();
                }
                CmdState::WaitingWriteErr => {
                    crate::shell::unreachable_state("Cmd.next", "waiting_write_err");
                }
                CmdState::Exec => {
                    crate::shell::unreachable_state("Cmd.next", "exec");
                }
                CmdState::Done => unreachable!(),
            }
        }

        if matches!(self.state, CmdState::Done) {
            return self.parent.child_done(self, self.exit_code.unwrap());
        }

        self.parent.child_done(self, 1)
    }

    fn transition_to_exec_state_and_yield(&mut self) -> Yield {
        self.state = CmdState::Exec;
        self.init_subproc()
    }

    pub fn start(&mut self) -> Yield {
        bun_output::scoped_log!(SHELL, "cmd start {:x}", self as *mut _ as usize);
        Yield::Cmd(self)
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, e: Option<SystemError>) -> Yield {
        if let Some(err) = e {
            self.base.throw(&ShellErr::new_sys(err));
            return Yield::Failed;
        }
        debug_assert!(matches!(self.state, CmdState::WaitingWriteErr));
        self.parent.child_done(self, 1)
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        if child.ptr.is::<Assigns>() {
            if exit_code != 0 {
                let CmdState::ExpandingAssigns(assigns) = &mut self.state else { unreachable!() };
                let err = core::mem::replace(&mut assigns.state.err, ShellErr::Custom(b"".into()));
                // TODO(port): Assigns::deinit — Zig calls deinit() explicitly here before transitioning state
                assigns.deinit();
                let yield_ = self.write_failing_error(format_args!("{}\n", err));
                drop(err);
                return yield_;
            }

            let CmdState::ExpandingAssigns(assigns) = &mut self.state else { unreachable!() };
            assigns.deinit();
            self.state = CmdState::ExpandingRedirect {
                idx: 0,
                // SAFETY: expansion is initialized by Expansion::init in next() before any read
                expansion: unsafe { MaybeUninit::uninit().assume_init() },
            };
            return Yield::Cmd(self);
        }

        if child.ptr.is::<Expansion>() {
            child.deinit();
            if exit_code != 0 {
                let err = match &self.state {
                    CmdState::ExpandingRedirect { expansion, .. } => expansion.state.err.clone(),
                    CmdState::ExpandingArgs { expansion, .. } => expansion.state.err.clone(),
                    _ => panic!("Invalid state"),
                };
                let yield_ = self.write_failing_error(format_args!("{}\n", err));
                drop(err);
                return yield_;
            }
            // Handling this case from the shell spec:
            // "If there is no command name, but the command contained a
            // command substitution, the command shall complete with the
            // exit status of the last command substitution performed."
            //
            // See the comment where `this.out_exit_code` is assigned for
            // more info.
            let e: &Expansion = child.ptr.as_::<Expansion>();
            if let CmdState::ExpandingArgs { idx, .. } = &self.state {
                if matches!(*e.node, ast::Atom::Simple(ast::SimpleAtom::CmdSubst(_)))
                    && *idx == 1
                    && self.node.name_and_args.len() == 1
                {
                    self.exit_code = Some(e.out_exit_code);
                }
            }
            return Yield::Cmd(self);
        }

        panic!("Expected Cmd child to be Assigns or Expansion. This indicates a bug in Bun. Please file a GitHub issue. ");
    }

    fn init_subproc(&mut self) -> Yield {
        bun_output::scoped_log!(
            SHELL,
            "cmd init subproc ({:x}, cwd={})",
            self as *mut _ as usize,
            bstr::BStr::new(self.base.shell.cwd())
        );

        let arena = &mut *self.spawn_arena;
        // var arena_allocator = arena.allocator();
        let mut spawn_args = Subprocess::SpawnArgs::default(arena, self, self.base.interpreter.event_loop, false);

        spawn_args.cmd_parent = self;
        spawn_args.cwd = self.base.shell.cwd_z();

        {
            self.args.push(None);

            bun_output::scoped_log!(
                SHELL,
                "Cmd(0x{:x}, {}) IO: {}",
                self as *mut _ as usize,
                bstr::BStr::new(
                    self.args
                        .first()
                        .and_then(|a| *a)
                        // SAFETY: argv entries are NUL-terminated strings owned by base alloc scope
                        .map(|p| unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes())
                        .unwrap_or(b"<no args>")
                ),
                self.io
            );
            #[cfg(debug_assertions)]
            {
                for maybe_arg in &self.args {
                    if let Some(arg) = maybe_arg {
                        // SAFETY: argv entries are NUL-terminated
                        let s = unsafe { core::ffi::CStr::from_ptr(*arg) }.to_bytes();
                        if s.len() > 80 {
                            bun_output::scoped_log!(SHELL, "ARG: {}...\n", bstr::BStr::new(&s[0..80]));
                        } else {
                            bun_output::scoped_log!(SHELL, "ARG: {}\n", bstr::BStr::new(s));
                        }
                    }
                }
            }

            let Some(first_arg) = self.args[0] else {
                // Sometimes the expansion can result in an empty string
                //
                //  For example:
                //
                //     await $`echo "" > script.sh`
                //     await $`(bash ./script.sh)`
                //     await $`$(lkdlksdfjsf)`
                //
                // In this case, we should just exit.
                //
                // BUT, if the expansion contained a single command
                // substitution (third example above), then we need to
                // return the exit code of that command substitution.
                return self.parent.child_done(self, self.exit_code.unwrap_or(0));
            };

            // SAFETY: first_arg is a NUL-terminated string from expansion
            let first_arg_real = unsafe { core::ffi::CStr::from_ptr(first_arg) }.to_bytes();
            let first_arg_len = first_arg_real.len();

            if let Some(b) = Builtin::Kind::from_str(&first_arg_real[0..first_arg_len]) {
                let cwd = self.base.shell.cwd_fd;
                let maybe_yield = Builtin::init(
                    self,
                    self.base.interpreter,
                    b,
                    arena,
                    self.node,
                    &mut self.args,
                    &mut self.base.shell.export_env,
                    &mut self.base.shell.cmd_local_env,
                    cwd,
                    &mut self.io,
                );
                if let Some(y) = maybe_yield {
                    return y;
                }

                debug_assert!(matches!(self.exec, Exec::Bltn(_)));

                bun_output::scoped_log!(SHELL, "Builtin name: {}", <&'static str>::from(&self.exec));

                let Exec::Bltn(bltn) = &mut self.exec else { unreachable!() };
                return bltn.start();
            }

            let mut path_buf = paths::path_buffer_pool().get();
            let resolved = 'blk: {
                if let Some(r) = which(&mut path_buf, spawn_args.path, spawn_args.cwd, first_arg_real) {
                    break 'blk r;
                }
                if first_arg_real == b"bun" || first_arg_real == b"bun-debug" {
                    if let Ok(p) = bun_core::self_exe_path() {
                        break 'blk p;
                    }
                }
                return self.write_failing_error(format_args!(
                    "bun: command not found: {}\n",
                    // SAFETY: argv entries are NUL-terminated strings owned by base alloc scope
                    bstr::BStr::new(unsafe { core::ffi::CStr::from_ptr(first_arg) }.to_bytes())
                ));
            };

            // TODO(port): free first_arg_real (was allocator.free); argv strings are owned by base alloc scope
            let duped = ZStr::from_bytes(resolved);
            self.args[0] = Some(duped.as_ptr() as *const c_char);
            // TODO(port): lifetime — `duped` ownership must outlive argv; in Zig this is alloc-scope owned
            core::mem::forget(duped);
        }

        // Fill the env from the export end and cmd local env
        {
            let mut env_iter = self.base.shell.export_env.iterator();
            spawn_args.fill_env(&mut env_iter, false);
            let mut env_iter = self.base.shell.cmd_local_env.iterator();
            spawn_args.fill_env(&mut env_iter, false);
        }

        let mut shellio = subproc::ShellIO::default();
        let _shellio_guard = scopeguard::guard(&mut shellio, |s| s.deref_());
        self.io.to_subproc_stdio(&mut spawn_args.stdio, &mut shellio);

        match self.init_redirections(&mut spawn_args) {
            Ok(Some(y)) => return y,
            Ok(None) => {}
            Err(_) => return Yield::Failed,
        }

        let buffered_closed = BufferedIoClosed::from_stdio(&spawn_args.stdio);
        bun_output::scoped_log!(SHELL, "cmd ({:x}) set buffered closed", self as *mut _ as usize);

        self.exec = Exec::Subproc {
            // TODO(port): in-place init — Zig writes child via out-param in spawnAsync
            // SAFETY: child is fully written by Subprocess::spawn_async via out-param before any read
            child: unsafe { Box::new(MaybeUninit::uninit().assume_init()) },
            buffered_closed,
        };
        let mut did_exit_immediately = false;
        let Exec::Subproc { child, .. } = &mut self.exec else { unreachable!() };
        let subproc = match Subprocess::spawn_async(
            self.base.event_loop(),
            &mut shellio,
            spawn_args,
            child,
            &mut did_exit_immediately,
        ) {
            bun_sys::Result::Ok(_) => &mut **child,
            bun_sys::Result::Err(e) => {
                self.exec = Exec::None;
                let yield_ = self.write_failing_error(format_args!("{}\n", e));
                drop(e);
                return yield_;
            }
        };
        subproc.ref_();
        self.spawn_arena_freed = true;
        // SAFETY: spawn_arena_freed is now true; Drop will not double-free
        unsafe { core::mem::ManuallyDrop::drop(&mut self.spawn_arena) };

        if did_exit_immediately {
            if subproc.process.has_exited() {
                // process has already exited, we called wait4(), but we did not call onProcessExit()
                // SAFETY: all-zero is a valid Rusage (POD C struct)
                let rusage = unsafe { core::mem::zeroed::<bun_spawn::Rusage>() };
                subproc.process.on_exit(subproc.process.status, &rusage);
            } else {
                // process has already exited, but we haven't called wait4() yet
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subproc.process.wait(false);
            }
        }

        Yield::Suspended
    }

    fn init_redirections(&mut self, spawn_args: &mut Subprocess::SpawnArgs) -> bun_jsc::JsResult<Option<Yield>> {
        if let Some(redirect) = &self.node.redirect_file {
            const IN_CMD_SUBST: bool = false;

            if IN_CMD_SUBST {
                set_stdio_from_redirect(&mut spawn_args.stdio, self.node.redirect, Stdio::Ignore);
            } else {
                match redirect {
                    ast::RedirectFile::JsBuf(val) => {
                        // JS values in here is probably a bug
                        let jsc::EventLoopHandle::Js(js_loop) = self.base.event_loop() else {
                            panic!("JS values not allowed in this context");
                        };
                        let global = js_loop.global;

                        if val.idx as usize >= self.base.interpreter.jsobjs.len() {
                            return Err(global.throw(format_args!("Invalid JS object reference in shell")));
                        }

                        let jsval = self.base.interpreter.jsobjs[val.idx as usize];

                        if let Some(buf) = jsval.as_array_buffer(global) {
                            // Each slot needs its own Strong; copying one Stdio into multiple slots
                            // (e.g. for &>) would alias the same *Impl and double-free in deinit.
                            let flags = self.node.redirect;
                            if flags.stdin {
                                spawn_args.stdio[stdin_no] = Stdio::ArrayBuffer {
                                    array_buffer: buf,
                                    held: bun_jsc::Strong::create(buf.value, global),
                                };
                            }
                            if flags.duplicate_out {
                                spawn_args.stdio[stdout_no] = Stdio::ArrayBuffer {
                                    array_buffer: buf,
                                    held: bun_jsc::Strong::create(buf.value, global),
                                };
                                spawn_args.stdio[stderr_no] = Stdio::ArrayBuffer {
                                    array_buffer: buf,
                                    held: bun_jsc::Strong::create(buf.value, global),
                                };
                            } else {
                                if flags.stdout {
                                    spawn_args.stdio[stdout_no] = Stdio::ArrayBuffer {
                                        array_buffer: buf,
                                        held: bun_jsc::Strong::create(buf.value, global),
                                    };
                                }
                                if flags.stderr {
                                    spawn_args.stdio[stderr_no] = Stdio::ArrayBuffer {
                                        array_buffer: buf,
                                        held: bun_jsc::Strong::create(buf.value, global),
                                    };
                                }
                            }
                        } else if let Some(blob__) = jsval.as_::<bun_jsc::webcore::Blob>() {
                            let blob = blob__.dupe();
                            if self.node.redirect.stdin {
                                spawn_args.stdio[stdin_no].extract_blob(global, bun_jsc::webcore::AnyBlob::Blob(blob), stdin_no)?;
                            } else if self.node.redirect.stdout {
                                spawn_args.stdio[stdout_no].extract_blob(global, bun_jsc::webcore::AnyBlob::Blob(blob), stdout_no)?;
                            } else if self.node.redirect.stderr {
                                spawn_args.stdio[stderr_no].extract_blob(global, bun_jsc::webcore::AnyBlob::Blob(blob), stderr_no)?;
                            }
                        } else if let Some(rstream) = bun_jsc::webcore::ReadableStream::from_js(jsval, global)? {
                            let _ = rstream;
                            panic!("TODO SHELL READABLE STREAM");
                        } else if let Some(req) = jsval.as_::<bun_jsc::webcore::Response>() {
                            req.get_body_value().to_blob_if_possible();
                            if self.node.redirect.stdin {
                                spawn_args.stdio[stdin_no].extract_blob(global, req.get_body_value().use_as_any_blob(), stdin_no)?;
                            }
                            if self.node.redirect.stdout {
                                spawn_args.stdio[stdout_no].extract_blob(global, req.get_body_value().use_as_any_blob(), stdout_no)?;
                            }
                            if self.node.redirect.stderr {
                                spawn_args.stdio[stderr_no].extract_blob(global, req.get_body_value().use_as_any_blob(), stderr_no)?;
                            }
                        } else {
                            return Err(global.throw(format_args!(
                                "Unknown JS value used in shell: {}",
                                jsval.fmt_string(global)
                            )));
                        }
                    }
                    ast::RedirectFile::Atom(_) => {
                        if self.redirection_file.is_empty() {
                            let arg0 = spawn_args.cmd_parent.args[0]
                                // SAFETY: argv entries are NUL-terminated strings owned by base alloc scope
                                .map(|p| unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes())
                                .unwrap_or(b"<unknown>");
                            return Ok(Some(self.write_failing_error(format_args!(
                                "bun: ambiguous redirect: at `{}`\n",
                                bstr::BStr::new(arg0)
                            ))));
                        }
                        let len = self.redirection_file.len().saturating_sub(1);
                        // SAFETY: redirection_file[len] == 0 written by Expansion
                        let path = unsafe { ZStr::from_raw(self.redirection_file.as_ptr(), len) };
                        bun_output::scoped_log!(
                            SHELL,
                            "Expanded Redirect: {}\n",
                            bstr::BStr::new(&self.redirection_file[..])
                        );
                        let perm = 0o666;
                        let flags = self.node.redirect.to_flags();
                        let redirfd = match ShellSyscall::openat(self.base.shell.cwd_fd, &path, flags, perm) {
                            bun_sys::Result::Err(e) => {
                                let sys_err = e.to_shell_system_error();
                                let yield_ = self.write_failing_error(format_args!(
                                    "bun: {}: {}",
                                    sys_err.message,
                                    bstr::BStr::new(path.as_bytes())
                                ));
                                sys_err.deref_();
                                return Ok(Some(yield_));
                            }
                            bun_sys::Result::Ok(f) => f,
                        };
                        self.redirection_fd = Some(CowFd::init(redirfd));
                        set_stdio_from_redirect(&mut spawn_args.stdio, self.node.redirect, Stdio::Fd(redirfd));
                    }
                }
            }
        } else if self.node.redirect.duplicate_out {
            if self.node.redirect.stdout {
                spawn_args.stdio[stderr_no] = Stdio::Dup2 { out: subproc::OutKind::Stderr, to: subproc::OutKind::Stdout };
            }

            if self.node.redirect.stderr {
                spawn_args.stdio[stdout_no] = Stdio::Dup2 { out: subproc::OutKind::Stdout, to: subproc::OutKind::Stderr };
            }
        }

        Ok(None)
    }

    /// Returns null if stdout is buffered
    pub fn stdout_slice(&self) -> Option<&[u8]> {
        match &self.exec {
            Exec::None => None,
            Exec::Subproc { buffered_closed, .. } => {
                if let Some(stdout) = &buffered_closed.stdout {
                    if let BufferedIoStateKind::Closed(list) = &stdout.state {
                        return Some(list.slice());
                    }
                }
                None
            }
            Exec::Bltn(bltn) => match &bltn.stdout {
                Builtin::Output::Buf(buf) => Some(&buf[..]),
                Builtin::Output::ArrayBuf(ab) => Some(ab.buf.slice()),
                Builtin::Output::Blob(blob) => Some(blob.shared_view()),
                _ => None,
            },
        }
    }

    pub fn has_finished(&self) -> bool {
        bun_output::scoped_log!(
            SHELL,
            "Cmd(0x{:x}) exit_code={:?}",
            self as *const _ as usize,
            self.exit_code
        );
        if self.exit_code.is_none() {
            return false;
        }
        match &self.exec {
            Exec::None => true,
            Exec::Subproc { buffered_closed, .. } => buffered_closed.all_closed(),
            Exec::Bltn(_) => false,
        }
    }

    /// Called by Subprocess
    pub fn on_exit(&mut self, exit_code: ExitCode) {
        self.exit_code = Some(exit_code);

        let has_finished = self.has_finished();
        bun_output::scoped_log!(
            SHELL,
            "cmd exit code={} has_finished={} ({:x})",
            exit_code,
            has_finished,
            self as *mut _ as usize
        );
        if has_finished {
            self.state = CmdState::Done;
            self.next().run();
        }
    }

    // TODO check that this also makes sure that the poll ref is killed because if it isn't then this Cmd pointer will be stale and so when the event for pid exit happens it will cause crash
    // TODO(port): deinit → Drop vs pool destroy — Cmd is pool-allocated via parent.create()/destroy(); revisit ownership in Phase B
    pub fn deinit(&mut self) {
        bun_output::scoped_log!(
            SHELL,
            "Cmd(0x{:x}, {}) cmd deinit",
            self as *mut _ as usize,
            <&'static str>::from(&self.exec)
        );
        if let Some(_redirfd) = self.redirection_fd.take() {
            // Rc drop handles deref
        }

        match core::mem::replace(&mut self.exec, Exec::None) {
            Exec::Subproc { child, buffered_closed } => {
                let mut cmd = child;
                if !cmd.has_exited() {
                    let _ = cmd.try_kill(9);
                }
                cmd.unref(true);
                cmd.deinit();

                drop(buffered_closed);
            }
            Exec::Bltn(mut bltn) => {
                bltn.deinit();
            }
            Exec::None => {}
        }

        {
            for maybe_arg in &self.args {
                if let Some(_arg) = maybe_arg {
                    // TODO(port): allocator.free(bun.sliceTo(arg, 0)) — argv strings owned by base alloc scope
                }
            }
            self.args.clear();
            self.args.shrink_to_fit();
        }

        if !self.spawn_arena_freed {
            bun_output::scoped_log!(SHELL, "Spawn arena free");
            // SAFETY: spawn_arena_freed == false means it has not been dropped yet
            unsafe { core::mem::ManuallyDrop::drop(&mut self.spawn_arena) };
        }

        self.io.deref_();
        self.base.end_scope();
        self.parent.destroy(self);
    }

    pub fn buffered_input_close(&mut self) {
        let Exec::Subproc { buffered_closed, .. } = &mut self.exec else { unreachable!() };
        // PORT NOTE: reshaped for borrowck — buffered_closed.close needs &mut self and &mut Cmd
        // TODO(port): self-aliasing &mut — Zig passes `this` and `this.exec.subproc.buffered_closed` simultaneously
        buffered_closed.stdin = Some(true);
    }

    pub fn buffered_output_close(&mut self, kind: subproc::OutKind, err: Option<SystemError>) -> Yield {
        match kind {
            subproc::OutKind::Stdout => self.buffered_output_close_stdout(err),
            subproc::OutKind::Stderr => self.buffered_output_close_stderr(err),
        }
        if self.has_finished() {
            if !self.spawn_arena_freed {
                let async_subprocess_done = Box::into_raw(Box::new(ShellAsyncSubprocessDone {
                    cmd: self as *mut Cmd<'_> as *mut Cmd<'static>,
                    concurrent_task: EventLoopTask::from_event_loop(self.base.event_loop()),
                }));
                // SAFETY: just allocated; ownership transferred to event loop queue
                unsafe { (*async_subprocess_done).enqueue() };
                return Yield::Suspended;
            } else {
                return self.parent.child_done(self, self.exit_code.unwrap_or(0));
            }
        }
        Yield::Suspended
    }

    pub fn buffered_output_close_stdout(&mut self, err: Option<SystemError>) {
        debug_assert!(matches!(self.exec, Exec::Subproc { .. }));
        bun_output::scoped_log!(SHELL, "cmd ({:x}) close buffered stdout", self as *mut _ as usize);
        if let Some(e) = err {
            self.exit_code = Some(ExitCode::try_from(e.get_errno() as u32).unwrap());
            e.deref_();
        }
        // PORT NOTE: reshaped for borrowck — split borrows of self.io / self.node / self.exec
        if let IO::OutKind::Fd { captured: Some(buf), .. } = &mut self.io.stdout {
            if !self.node.redirect.redirects_elsewhere(ast::RedirectTarget::Stdout) {
                let Exec::Subproc { child, .. } = &self.exec else { unreachable!() };
                let the_slice = child.stdout.pipe.slice();
                buf.extend_from_slice(the_slice);
            }
        }
        // TODO(port): self-aliasing &mut — Zig passes `this` and `&this.exec.subproc.child.stdout` into buffered_closed.close
        let Exec::Subproc { child, buffered_closed } = &mut self.exec else { unreachable!() };
        let readable = &mut child.stdout as *mut subproc::Readable;
        // SAFETY: readable and buffered_closed are disjoint fields of self.exec.subproc; cmd access in close() touches self.io/self.node/self.base only
        unsafe {
            buffered_closed.close(&mut *(self as *mut Cmd), CloseIo::Stdout(&mut *readable));
        }
        let Exec::Subproc { child, .. } = &mut self.exec else { unreachable!() };
        child.close_io(subproc::OutKind::Stdout);
    }

    pub fn buffered_output_close_stderr(&mut self, err: Option<SystemError>) {
        debug_assert!(matches!(self.exec, Exec::Subproc { .. }));
        bun_output::scoped_log!(SHELL, "cmd ({:x}) close buffered stderr", self as *mut _ as usize);
        if let Some(e) = err {
            self.exit_code = Some(ExitCode::try_from(e.get_errno() as u32).unwrap());
            e.deref_();
        }
        if let IO::OutKind::Fd { captured: Some(buf), .. } = &mut self.io.stderr {
            if !self.node.redirect.redirects_elsewhere(ast::RedirectTarget::Stderr) {
                let Exec::Subproc { child, .. } = &self.exec else { unreachable!() };
                buf.extend_from_slice(child.stderr.pipe.slice());
            }
        }
        // TODO(port): self-aliasing &mut — see buffered_output_close_stdout
        let Exec::Subproc { child, buffered_closed } = &mut self.exec else { unreachable!() };
        let readable = &mut child.stderr as *mut subproc::Readable;
        // SAFETY: disjoint fields; see above
        unsafe {
            buffered_closed.close(&mut *(self as *mut Cmd), CloseIo::Stderr(&mut *readable));
        }
        let Exec::Subproc { child, .. } = &mut self.exec else { unreachable!() };
        child.close_io(subproc::OutKind::Stderr);
    }
}

fn set_stdio_from_redirect(stdio: &mut [Stdio; 3], flags: ast::RedirectFlags, val: Stdio) {
    if flags.stdin {
        stdio[stdin_no] = val.clone();
    }

    if flags.duplicate_out {
        stdio[stdout_no] = val.clone();
        stdio[stderr_no] = val;
    } else {
        if flags.stdout {
            stdio[stdout_no] = val.clone();
        }

        if flags.stderr {
            stdio[stderr_no] = val;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Cmd.zig (843 lines)
//   confidence: medium
//   todos:      11
//   notes:      heavy self-aliasing &mut (buffered_closed.close takes &mut Cmd + field of Cmd); argv string ownership, in-place enum payload init, and Cmd::deinit→Drop/pool-destroy need Phase B redesign
// ──────────────────────────────────────────────────────────────────────────
