//! The programs that a type check runs with `--runExternalCode`: TypeScript's content mappers, which a project's
//! `tsconfig.json` lists and which turn files such as `.vue` files into TypeScript.
//!
//! One thread owns an event loop, and everything that touches a program or its pipes happens on that thread, without
//! blocking. The threads that load the project's files only queue a command for it and then wait in
//! `Connection::wait`. What a program writes is passed on as is. The checker decodes and validates it.
//!
//! The process may go on after the check, as it does for `Bun.build`. `Programs::close` leaves nothing behind: the
//! programs have exited, the pipes and the loop are closed, and the thread has ended.

use core::ffi::CStr;
use core::time::Duration;
use std::ffi::CString;
use std::sync::Arc;

use bun_core::Output;
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop::{self as mini_event_loop, MiniEventLoop};
#[cfg(windows)]
use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
use bun_io::{BufferedReader, ReadState, StreamingWriter, WriteResult, WriteStatus};
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags};
use bun_sema_driver::host::{
    Call, CallError, Connection, Json, Mapper, Transport, receive_from_content_mapper, to_native,
};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{ProcessHandle, Rusage, SpawnEnv, SpawnOptions, Status, Stdio};
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::Guarded;

/// A program, as the threads that call it see it.
struct Program {
    /// `Mapper::identity`
    identity: Vec<u8>,
    /// `Mapper::exec`
    argv: Vec<Vec<u8>>,
    /// `Mapper::package_directory`
    directory: Vec<u8>,
    connection: Connection,
}

/// What the other threads ask the I/O thread to do.
enum Command {
    Start(Arc<Program>),
    /// Write `bytes` to the program's standard input.
    Write {
        program: Arc<Program>,
        bytes: Vec<u8>,
    },
    Kill(Arc<Program>),
    /// Kill every program, then end the thread.
    Stop,
}

/// The I/O thread's loop, for `wakeup`, which any thread may call.
struct LoopToWake(*mut bun_uws::Loop);

// SAFETY: the pointer is only used to wake the loop, under the lock of the `Inbox` that has it. The I/O thread removes
// it from there before it ends. The loop is that thread's own `MiniEventLoop`. A VM in the process has a loop of its
// own, so there's no VM or JS state behind this one.
unsafe impl Send for LoopToWake {}

#[derive(Default)]
struct Inbox {
    commands: Vec<Command>,
    /// `None` until the I/O thread runs, which then looks at `commands` by itself.
    event_loop: Option<LoopToWake>,
    /// `Command::Stop` was sent, and nothing may follow it.
    is_closed: bool,
}

/// Starts the programs and passes messages between them and the checker.
#[derive(Default)]
pub(crate) struct Programs {
    inbox: Arc<Guarded<Inbox>>,
    programs: Guarded<Vec<Arc<Program>>>,
    io_thread: Guarded<Option<std::thread::JoinHandle<()>>>,
}

impl Programs {
    /// Returns false if the I/O thread no longer accepts commands.
    fn send(&self, command: Command) -> bool {
        let mut inbox = self.inbox.lock();
        if inbox.is_closed {
            return false;
        }
        inbox.is_closed = matches!(command, Command::Stop);
        inbox.commands.push(command);
        if let Some(event_loop) = &inbox.event_loop {
            // Not `Loop::wakeup`: its `&mut Loop` would alias the one that the I/O thread has while it ticks.
            // SAFETY: see `LoopToWake`.
            unsafe { bun_uws::us_wakeup_loop(event_loop.0) };
        }
        true
    }

    /// Returns the program that `call` is for. The first call starts it.
    fn program_for(&self, call: &Call) -> Arc<Program> {
        let identity = call.mapper.identity();
        let mut programs = self.programs.lock();
        if let Some(program) = programs.iter().find(|it| it.identity == identity) {
            return Arc::clone(program);
        }
        let program = Arc::new(Program {
            identity,
            argv: call.mapper.exec.clone(),
            directory: call.mapper.package_directory.clone(),
            connection: Connection::default(),
        });
        programs.push(Arc::clone(&program));
        if let Err(detail) = self.start_io_thread() {
            program.connection.end(CallError::NotStarted { detail });
        } else if !self.send(Command::Start(Arc::clone(&program))) {
            program.connection.end(closed());
        }
        program
    }

    fn start_io_thread(&self) -> Result<(), Vec<u8>> {
        let mut io_thread = self.io_thread.lock();
        // After `close`, `send` refuses the command.
        if io_thread.is_some() || self.inbox.lock().is_closed {
            return Ok(());
        }
        let inbox = Arc::clone(&self.inbox);
        let builder = std::thread::Builder::new().name("ContentMappers".to_owned());
        match builder.spawn(move || run_io_thread(&inbox)) {
            Ok(handle) => *io_thread = Some(handle),
            Err(error) => return Err(error.to_string().into_bytes()),
        }
        Ok(())
    }
}

impl Transport for Programs {
    fn call(&self, call: &Call) -> Result<Option<Json>, CallError> {
        let program = self.program_for(call);
        let begun = program.connection.begin(call.method, &call.params)?;
        let write = Command::Write {
            program: Arc::clone(&program),
            bytes: begun.request,
        };
        if !self.send(write) {
            program.connection.end(closed());
        }
        let timeout = call.timeout_seconds.map(|seconds| {
            let for_tests = bun_core::env_var::BUN_DEBUG_TEST_CONTENT_MAPPER_TIMEOUT_MS.get();
            match for_tests.filter(|_| seconds > 0) {
                Some(milliseconds) => Duration::from_millis(milliseconds),
                None => Duration::from_secs(seconds.into()),
            }
        });
        program.connection.wait(begun.id, timeout)
    }

    fn stop(&self, mapper: &Mapper) {
        let identity = mapper.identity();
        let programs = self.programs.lock();
        if let Some(program) = programs.iter().find(|it| it.identity == identity) {
            program.connection.end(closed());
            self.send(Command::Kill(Arc::clone(program)));
        }
    }

    fn close(&self) {
        self.send(Command::Stop);
        let io_thread = self.io_thread.lock().take();
        if let Some(io_thread) = io_thread {
            let _ = io_thread.join();
        }
        for program in self.programs.lock().iter() {
            program.connection.end(closed());
        }
    }
}

impl Drop for Programs {
    fn drop(&mut self) {
        self.close();
    }
}

fn closed() -> CallError {
    CallError::Failed {
        detail: b"ipc: connection closed".to_vec(),
    }
}

/// Returns the process of `program`, unless it couldn't be started. `children` are live.
fn child_of(children: &[*mut Child], program: &Arc<Program>) -> Option<*mut Child> {
    // SAFETY: the caller's contract. Nothing ever borrows this field mutably.
    let is_of_program = |it: &&*mut Child| unsafe { Arc::ptr_eq(&(***it).program, program) };
    children.iter().find(is_of_program).copied()
}

fn run_io_thread(inbox: &Guarded<Inbox>) {
    // `Output`'s writers are per-thread state, and this thread isn't from Bun's pool. So are the bounds of the stack,
    // which the JSON parser asks for.
    Output::Source::configure_thread();
    let mini: *mut MiniEventLoop = mini_event_loop::init_global(None, None);
    let event_loop = EventLoopHandle::init_mini(mini);
    inbox.lock().event_loop = Some(LoopToWake(event_loop.loop_()));
    let mut children: Vec<*mut Child> = Vec::new();
    let mut is_stopping = false;
    loop {
        let commands = std::mem::take(&mut inbox.lock().commands);
        for command in commands {
            match command {
                Command::Start(program) => children.extend(Child::start(program, event_loop)),
                Command::Write { program, bytes } => {
                    if let Some(child) = child_of(&children, &program) {
                        // SAFETY: the children are live until the end of this function, and nothing borrows this one.
                        unsafe { Child::write(child, &bytes) };
                    }
                }
                Command::Kill(program) => {
                    if let Some(child) = child_of(&children, &program) {
                        // SAFETY: as above.
                        unsafe { Child::kill(child) };
                    }
                }
                Command::Stop => {
                    is_stopping = true;
                    for &child in &children {
                        // SAFETY: as above.
                        unsafe { Child::kill(child) };
                    }
                }
            }
        }
        // SAFETY: as above.
        if is_stopping && children.iter().all(|&it| unsafe { (*it).has_exited }) {
            break;
        }
        // Returns after an event, or after `wakeup`, even if that was called before this.
        // SAFETY: `mini` is this thread's loop, which is freed below.
        unsafe { (*mini).tick_once(core::ptr::null_mut()) };
    }
    inbox.lock().event_loop = None;
    for &child in &children {
        // The loop no longer watches the process.
        // SAFETY: as above.
        unsafe { (*child).process = None };
    }
    // The children outlive the loop, because on Windows a pipe's close callback runs when the loop is closed.
    // SAFETY: every process has exited, `on_process_exit` has closed its pipes, and no other thread has the loop.
    unsafe { mini_event_loop::free_global() };
    for child in children {
        // SAFETY: allocated in `Child::adopt`, and nothing refers to it anymore.
        unsafe { bun_core::heap::destroy(child) };
    }
}

/// A running program. Only the I/O thread uses it. The pipes and the process call back into it while one of its
/// functions runs, so all of them get a raw pointer and borrow one field at a time.
pub(crate) struct Child {
    program: Arc<Program>,
    event_loop: EventLoopHandle,
    process: Option<ProcessHandle>,
    stdin: StreamingWriter<Child>,
    stdout: BufferedReader,
    has_exited: bool,
}

#[cfg(not(windows))]
pub(crate) type Poll = StreamingWriter<Child>;

/// A pipe between this process and a new one.
fn pipe() -> Stdio {
    #[cfg(unix)]
    return Stdio::Buffer;
    #[cfg(windows)]
    return Stdio::Buffer(bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<
        uv::Pipe,
    >())));
}

impl Child {
    /// Starts `program`. If that fails, its connection ends with the reason, and there's no child.
    fn start(program: Arc<Program>, event_loop: EventLoopHandle) -> Option<*mut Child> {
        match Child::spawn(&program, event_loop) {
            Ok(spawned) => Some(Child::adopt(program, event_loop, spawned)),
            Err(detail) => {
                program.connection.end(CallError::NotStarted { detail });
                None
            }
        }
    }

    /// No shell is involved: the arguments are passed as they are declared. The program runs in its package's
    /// directory with this process's environment, and shares its standard error.
    fn spawn(
        program: &Program,
        event_loop: EventLoopHandle,
    ) -> Result<bun_spawn::SpawnProcessResult, Vec<u8>> {
        let directory = to_native(&program.directory);
        let name = program.argv.first().map_or(&b""[..], |it| &it[..]);
        let mut buffer = bun_paths::path_buffer_pool::get();
        let search_path = bun_core::env_var::PATH.get().unwrap_or_default();
        let found = bun_which::which_for_spawn(&mut buffer, search_path, directory, name);
        // A mapper that asks for `node` also runs where only Bun is installed.
        let found = match found {
            None if name == b"node" => bun_core::self_exe_path().ok(),
            found => found,
        };
        let Some(executable) = found else {
            if bun_core::strings::index_of_any(name, b"/\\").is_none() {
                let variable: &[u8] = if cfg!(windows) { b"%PATH%" } else { b"$PATH" };
                let not_found = b"\": executable file not found in ";
                return Err([b"exec: \"", name, not_found, variable].concat());
            }
            let path =
                bun_paths::resolve_path::join_abs::<bun_paths::platform::Auto>(directory, name);
            let why: &[u8] = match bun_sys::exists(path) {
                true => b": permission denied",
                false => b": no such file or directory",
            };
            return Err([b"fork/exec ", name, why].concat());
        };
        let has_nul = || [b"fork/exec ", name, b": invalid argument"].concat();
        let mut argv = vec![executable.as_cstr().to_owned()];
        for argument in program.argv.iter().skip(1) {
            argv.push(CString::new(&argument[..]).map_err(|_| has_nul())?);
        }
        let argv: Vec<&CStr> = argv.iter().map(CString::as_c_str).collect();
        #[cfg_attr(unix, expect(unused_mut))]
        let mut options = SpawnOptions {
            stdin: pipe(),
            stdout: pipe(),
            stderr: Stdio::Inherit,
            cwd: Box::from(directory),
            #[cfg(windows)]
            windows: bun_spawn::WindowsOptions {
                loop_: event_loop,
                ..Default::default()
            },
            // The kernel kills the program if this process ends without stopping it.
            #[cfg(any(target_os = "linux", target_os = "android"))]
            linux_pdeathsig: Some(bun_sys::SignalCode::SIGKILL.0),
            ..Default::default()
        };
        #[cfg(unix)]
        let _ = event_loop;
        let describe = |why: &[u8]| [b"fork/exec ", executable.as_bytes(), b": ", why].concat();
        match bun_spawn::spawn_process_cstr(&options, &argv, SpawnEnv::Inherit) {
            Ok(Ok(spawned)) => Ok(spawned),
            failed => {
                // The pipes are still this function's.
                #[cfg(windows)]
                options.deinit();
                Err(match failed {
                    Ok(Err(error)) => describe(error.name()),
                    Err(error) => describe(error.name().as_bytes()),
                    Ok(Ok(_)) => Vec::new(),
                })
            }
        }
    }

    /// Watches the new process and its pipes.
    #[cfg_attr(unix, expect(unused_mut))]
    fn adopt(
        program: Arc<Program>,
        event_loop: EventLoopHandle,
        mut spawned: bun_spawn::SpawnProcessResult,
    ) -> *mut Child {
        let this = bun_core::heap::into_raw(Box::new(Child {
            program,
            event_loop,
            process: None,
            stdin: StreamingWriter::default(),
            stdout: BufferedReader::init::<Child>(),
            has_exited: false,
        }));
        #[cfg(unix)]
        let (stdin, stdout) = (spawned.stdin, spawned.stdout);
        #[cfg(windows)]
        let (stdin, stdout) = (spawned.stdin.take(), spawned.stdout.take());
        let process = spawned.to_process_handle(event_loop);
        // SAFETY: `this` was allocated above, and is freed after the process has exited. Each statement borrows one
        // field, and none of these calls runs a callback that touches the same field.
        let started = unsafe {
            (*this).stdin.set_parent(this);
            (*this).stdout.set_parent(this.cast());
            let started = Child::start_pipes(this, stdin, stdout);
            process
                .process_mut()
                .set_exit_handler(bun_spawn::ProcessExit::new(
                    bun_spawn::ProcessExitKind::ContentMapper,
                    this,
                ));
            started
        };
        // The exit handler borrows the field, so use the allocation instead.
        let allocation = process.as_ptr();
        // SAFETY: as above. The field's handle keeps the process alive.
        let process = unsafe {
            (*this).process = Some(process);
            &mut *allocation
        };
        if let Err(error) = process.watch_or_reap()
            && !process.has_exited()
        {
            process.on_exit(Status::Err(error), &bun_core::ffi::zeroed::<Rusage>());
        }
        if let Err(error) = started {
            let detail = [b"pipe: ", error.name()].concat();
            // SAFETY: as above.
            unsafe {
                Child::connection(this).end(CallError::NotStarted { detail });
                Child::kill(this);
            }
        }
        this
    }

    /// # Safety
    /// `this` is live, and nothing borrows `stdin` or `stdout`.
    #[cfg(unix)]
    unsafe fn start_pipes(
        this: *mut Child,
        stdin: Option<bun_sys::Fd>,
        stdout: Option<bun_sys::Fd>,
    ) -> bun_sys::Result<()> {
        use bun_sys::FdExt as _;
        let (Some(stdin), Some(stdout)) = (stdin, stdout) else {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::EBADF,
                bun_sys::Tag::pipe,
            ));
        };
        let _ = bun_sys::set_nonblocking(stdin);
        let _ = bun_sys::set_nonblocking(stdout);
        // SAFETY: the caller's contract.
        let (writer, reader) = unsafe { (&mut (*this).stdin, &mut (*this).stdout) };
        if let Err(error) = writer.start(stdin, true) {
            // Neither took its descriptor.
            stdin.close();
            stdout.close();
            return Err(error);
        }
        if let Some(poll) = writer.handle.get_poll() {
            poll.set_flag(FilePollFlag::Socket);
        }
        reader
            .flags
            .insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
        reader.start(stdout, true)?;
        if let Some(poll) = reader.handle.get_poll() {
            poll.set_flag(FilePollFlag::Socket);
        }
        Ok(())
    }

    /// # Safety
    /// `this` is live, and nothing borrows `stdin` or `stdout`.
    #[cfg(windows)]
    unsafe fn start_pipes(
        this: *mut Child,
        stdin: bun_spawn::SpawnedStdio,
        stdout: bun_spawn::SpawnedStdio,
    ) -> bun_sys::Result<()> {
        use bun_spawn::SpawnedStdio::Buffer;
        let (Buffer(stdin), Buffer(stdout)) = (stdin, stdout) else {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::EBADF,
                bun_sys::Tag::pipe,
            ));
        };
        // SAFETY: the caller's contract. The writer owns the pipe from here on.
        unsafe {
            (*this).stdin.set_pipe(bun_core::heap::into_raw(stdin));
            (*this).stdout.set_source(bun_io::Source::Pipe(stdout));
            (*this).stdin.start_with_current_pipe()?;
            (*this).stdout.start_with_current_pipe()
        }
    }

    /// # Safety
    /// `this` is live for `'a`.
    unsafe fn connection<'a>(this: *mut Child) -> &'a Connection {
        // SAFETY: the caller's contract. Nothing ever borrows this field mutably.
        let program: &Arc<Program> = unsafe { &(*this).program };
        &program.connection
    }

    /// # Safety
    /// `this` is live, and nothing borrows `stdin`.
    unsafe fn write(this: *mut Child, bytes: &[u8]) {
        // What the pipe doesn't accept now is buffered, and written when the loop says the pipe has room.
        // SAFETY: the caller's contract.
        let result = unsafe { (*this).stdin.write(bytes) };
        if matches!(result, WriteResult::Err(_) | WriteResult::Done(_)) {
            // SAFETY: the caller's contract.
            unsafe { Child::kill(this) };
        }
    }

    /// Every failure ends here: the process is killed, and `on_process_exit` then ends the connection, which wakes
    /// every thread that's waiting for a response.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn kill(this: *mut Child) {
        // SAFETY: the caller's contract.
        if let Some(process) = unsafe { (*this).process.as_ref() }
            && !process.has_exited()
        {
            let _ = process.kill(bun_sys::SignalCode::SIGKILL.0);
        }
    }

    fn on_write(_: *mut Child, _: usize, _: WriteStatus) {}

    fn on_ready(_: *mut Child) {}

    fn on_close(_: *mut Child) {}

    /// The program closed its standard input, or exited.
    fn on_write_error(this: *mut Child, _: bun_sys::Error) {
        // SAFETY: the writer's parent is live.
        unsafe { Child::kill(this) };
    }

    /// Returns false to stop reading.
    fn on_read_chunk(this: *mut Child, chunk: &[u8], _: ReadState) -> bool {
        // SAFETY: the reader's parent is live.
        let connection = unsafe { Child::connection(this) };
        match receive_from_content_mapper(connection, chunk) {
            Ok(replies) if replies.is_empty() => true,
            Ok(replies) => {
                // SAFETY: as above. The reader runs this callback, so nothing borrows `stdin`.
                unsafe { Child::write(this, &replies) };
                true
            }
            // The program doesn't follow the protocol. The connection has ended.
            Err(_) => {
                // SAFETY: as above.
                unsafe { Child::kill(this) };
                false
            }
        }
    }

    /// The program closed its standard output, so it can't answer anymore.
    fn on_reader_done(this: *mut Child) {
        // SAFETY: the reader's parent is live.
        unsafe { Child::kill(this) };
    }

    /// # Safety
    /// `this` is live, and nothing borrows `stdin` or `stdout`.
    unsafe fn on_process_exit(this: *mut Child, status: &Status) {
        // SAFETY: the caller's contract.
        unsafe {
            (*this).has_exited = true;
            // Read the responses that the pipe still has. Then close it, because a process that the program started
            // may keep the other end open forever.
            let reader = &raw mut (*this).stdout;
            #[cfg(unix)]
            if !(*reader).is_done() && (*reader).get_fd() != bun_sys::Fd::INVALID {
                BufferedReader::read(reader);
            }
            if !(*reader).is_done() {
                (*reader).deinit();
            }
            (*this).stdin.end();
            // `ProcessState.ExitCode`
            let code = match status {
                Status::Exited(exited) => i32::from(exited.code),
                _ => -1,
            };
            Child::connection(this).end(CallError::Exited { code });
        }
    }
}

bun_spawn::link_impl_ProcessExit! {
    ContentMapper for Child => |this| {
        on_process_exit(_process, status, _rusage) => Child::on_process_exit(this, &status),
    }
}

bun_io::impl_buffered_reader_parent! {
    ContentMapper for Child;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| Child::on_read_chunk(this, &chunk, has_more);
    on_reader_done  = |this| Child::on_reader_done(this);
    on_reader_error = |this, _error| Child::on_reader_done(this);
    loop_           = |this| (*this).event_loop.native_loop();
    event_loop      = |this| (*this).event_loop.as_event_loop_ctx();
}

bun_io::impl_streaming_writer_parent! {
    Child;
    poll_tag   = bun_io::posix_event_loop::poll_tag::CONTENT_MAPPER_WRITER,
    borrow     = ptr,
    on_write   = on_write,
    on_error   = on_write_error,
    on_ready   = on_ready,
    on_close   = on_close,
    event_loop = |this| (*this).event_loop.as_event_loop_ctx(),
    uws_loop   = |this| (*this).event_loop.r#loop(),
    uv_loop    = |this| (*this).event_loop.uv_loop(),
    ref_       = |_this| (),
    deref      = |_this| (),
}
