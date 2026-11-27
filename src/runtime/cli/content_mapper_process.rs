//! The programs that a type check runs with `--runExternalCode`: TypeScript's content mappers, which a project's
//! `tsconfig.json` lists and which turn files such as `.vue` files into TypeScript.
//!
//! One thread owns an event loop, and everything that touches a program or its pipes happens on that thread, without
//! blocking. The threads that load the project's files only queue a command for it and then wait in
//! `Connection::wait`. What a program writes is passed on as is. The checker decodes and validates it.
//!
//! The process may go on after the check, as it does for `Bun.build`. `Programs::close` cleans up everything: the
//! programs have exited, the pipes and the loop are closed, and the thread has ended.

use core::cell::Cell;
use core::time::Duration;
use std::ffi::CString;
use std::sync::Arc;

use bun_core::{Output, ZStr};
use bun_event_loop::EventLoopHandle;
use bun_event_loop::MiniEventLoop as mini_event_loop;
use bun_io::{
    BufferedReader, IoEvent, Owner, PollTag, ReadResult, StreamingWriter, WriteHandler,
    WriteResult, WriteStatus,
};
#[cfg(unix)]
use bun_io::{FilePollFlag, PosixFlags};
use bun_ptr::AliasableBox;
use bun_sema_driver::host::{
    Call, CallError, Connection, Json, Mapper, Transport, receive_from_content_mapper, to_native,
};
#[cfg(unix)]
use bun_spawn::SpawnResultExt as _;
use bun_spawn::{ProcessExit, ProcessExitKind, ProcessHandle, SpawnOptions, Status, Stdio};
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
struct LoopToWake(*const bun_uws::Loop);

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

/// Stops the programs of one `Programs`, from any thread and at any time. Before the `Programs` exists: it never starts
/// a program. While threads wait for responses: the programs are killed, and each call fails. Later: nothing happens.
#[derive(Clone, Default)]
pub(crate) struct KillSwitch(Arc<Guarded<Inbox>>);

impl KillSwitch {
    /// Doesn't wait for the programs to exit. `Programs::close` does.
    pub(crate) fn stop(&self) {
        self.send(Command::Stop);
    }

    /// Returns false if the I/O thread no longer accepts commands.
    fn send(&self, command: Command) -> bool {
        let mut inbox = self.0.lock();
        if inbox.is_closed {
            return false;
        }
        inbox.is_closed = matches!(command, Command::Stop);
        inbox.commands.push(command);
        if let Some(event_loop) = &inbox.event_loop {
            // SAFETY: see `LoopToWake`.
            unsafe { bun_uws::us_wakeup_loop(event_loop.0) };
        }
        true
    }
}

/// Starts the programs and passes messages between them and the checker.
pub(crate) struct Programs {
    inbox: KillSwitch,
    programs: Guarded<Vec<Arc<Program>>>,
    io_thread: Guarded<Option<std::thread::JoinHandle<()>>>,
}

impl Programs {
    pub(crate) fn stopped_by(switch: KillSwitch) -> Programs {
        Programs {
            inbox: switch,
            programs: Guarded::default(),
            io_thread: Guarded::default(),
        }
    }

    fn send(&self, command: Command) -> bool {
        self.inbox.send(command)
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
        if io_thread.is_some() || self.inbox.0.lock().is_closed {
            return Ok(());
        }
        let inbox = Arc::clone(&self.inbox.0);
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

/// Returns the process of `program`, unless it couldn't be started.
fn child_of<'a>(children: &'a [AliasableBox<Child>], program: &Arc<Program>) -> Option<&'a Child> {
    let is_of_program = |it: &&AliasableBox<Child>| Arc::ptr_eq(&it.program, program);
    children.iter().find(is_of_program).map(|it| &**it)
}

fn run_io_thread(inbox: &Guarded<Inbox>) {
    // `Output`'s writers are per-thread state, and this thread isn't from Bun's pool. So are the bounds of the stack,
    // which the JSON parser asks for.
    Output::Source::configure_thread();
    let mini = mini_event_loop::init_global(None);
    let event_loop = EventLoopHandle::init_mini(mini);
    inbox.lock().event_loop = Some(LoopToWake(core::ptr::from_ref(event_loop.loop_())));
    let mut children: Vec<AliasableBox<Child>> = Vec::new();
    let mut is_stopping = false;
    loop {
        let commands = std::mem::take(&mut inbox.lock().commands);
        for command in commands {
            match command {
                Command::Start(program) => children.extend(Child::start(program, event_loop)),
                Command::Write { program, bytes } => {
                    if let Some(child) = child_of(&children, &program) {
                        child.write(&bytes);
                    }
                }
                Command::Kill(program) => {
                    if let Some(child) = child_of(&children, &program) {
                        child.kill();
                    }
                }
                Command::Stop => {
                    is_stopping = true;
                    for child in &children {
                        child.kill();
                    }
                }
            }
        }
        if is_stopping && children.iter().all(|it| it.has_exited.get()) {
            break;
        }
        // Returns after an event, or after `wakeup`, even if that was called before this.
        mini.tick_once(core::ptr::null_mut());
    }
    inbox.lock().event_loop = None;
    for child in &children {
        // The loop no longer watches the process.
        // SAFETY: nothing borrows the child now, and this writes to no other field of it.
        unsafe { (*child.as_ptr()).process = None };
    }
    // The children outlive the loop, because on Windows a write's callback runs when the loop is closed.
    // SAFETY: every process has exited, `on_process_exit` has closed its pipes, and no other thread has the loop.
    // Neither `mini` nor `event_loop` is used from here on.
    unsafe { mini_event_loop::free_global() };
    drop(children);
}

/// A running program. Only the I/O thread uses it. The pipes and the process call back into it while one of its
/// functions runs, so it's only ever borrowed shared.
pub(crate) struct Child {
    program: Arc<Program>,
    event_loop: EventLoopHandle,
    /// `None` once the loop no longer watches the process.
    process: Option<ProcessHandle>,
    stdin: StreamingWriter,
    stdout: BufferedReader,
    has_exited: Cell<bool>,
}

impl Child {
    /// Starts `program`. If that fails, its connection ends with the reason, and there's no child.
    fn start(program: Arc<Program>, event_loop: EventLoopHandle) -> Option<AliasableBox<Child>> {
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
        let search_path = bun_core::env_var::PATH.get().unwrap_or_default();
        let found = bun_which::which_for_spawn(search_path, directory, name);
        // A mapper that asks for `node` also runs where only Bun is installed.
        let found = match found.as_deref() {
            None if name == b"node" => bun_core::self_exe_path().ok(),
            found => found,
        };
        let Some(executable) = found else {
            if bun_core::strings::index_of_any(name, b"/\\").is_none() {
                let variable: &[u8] = if cfg!(windows) { b"%PATH%" } else { b"$PATH" };
                let not_found = b"\": executable file not found in ";
                return Err([b"exec: \"", name, not_found, variable].concat());
            }
            let path = bun_paths::Path::resolve(&[directory, name]);
            let why: &[u8] = match bun_sys::exists(&path) {
                true => b": permission denied",
                false => b": no such file or directory",
            };
            return Err([b"fork/exec ", name, why].concat());
        };
        let has_nul = || [b"fork/exec ", name, b": invalid argument"].concat();
        let mut arguments = Vec::new();
        for argument in program.argv.iter().skip(1) {
            arguments.push(CString::new(&argument[..]).map_err(|_| has_nul())?);
        }
        let arguments = arguments.iter().map(|it| ZStr::from_cstr(it));
        let argv: Vec<&ZStr> = core::iter::once(executable).chain(arguments).collect();
        let options = SpawnOptions {
            stdin: Stdio::Buffer,
            stdout: Stdio::Buffer,
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
        match bun_spawn::spawn_process_z(&options, &argv, None) {
            Ok(Ok(spawned)) => Ok(spawned),
            Ok(Err(error)) => Err(describe(error.name())),
            Err(error) => Err(describe(error.name().as_bytes())),
        }
    }

    /// Watches the new process and its pipes.
    fn adopt(
        program: Arc<Program>,
        event_loop: EventLoopHandle,
        mut spawned: bun_spawn::SpawnProcessResult,
    ) -> AliasableBox<Child> {
        let (stdin, stdout) = (spawned.stdin.take(), spawned.stdout.take());
        let process = spawned.to_process_handle(event_loop);
        let child = AliasableBox::new(Child {
            program,
            event_loop,
            process: Some(process),
            stdin: StreamingWriter::default(),
            stdout: BufferedReader::init(),
            has_exited: Cell::new(false),
        });
        let this = child.as_ptr();
        // SAFETY: `this` is the allocation that holds the writer and the reader. It stays where it is, and is only
        // borrowed shared, until it's freed, which is after the process has exited and the loop is closed.
        unsafe {
            let writer = Owner::new(PollTag::ContentMapperWriter, this.cast());
            child.stdin.set_owner(writer);
            let reader = Owner::new(PollTag::ContentMapperReader, this.cast());
            child.stdout.set_owner(reader);
        }
        let started = child.start_pipes(stdin, stdout);
        let process = child.process.as_ref().expect("set above");
        // SAFETY: as above. The child's handle on the process is dropped before the child is.
        process.set_exit_handler(unsafe { ProcessExit::new(ProcessExitKind::ContentMapper, this) });
        let mut rusage = bun_core::ffi::zeroed();
        if let Some(exit) = process.watch_or_exit(&mut rusage) {
            exit.dispatch(&rusage);
        }
        if let Err(error) = started {
            let detail = [b"pipe: ", error.name()].concat();
            child.connection().end(CallError::NotStarted { detail });
            child.kill();
        }
        child
    }

    #[cfg(unix)]
    fn start_pipes(
        &self,
        stdin: Option<bun_sys::File>,
        stdout: Option<bun_sys::File>,
    ) -> bun_sys::Result<()> {
        let (Some(stdin), Some(stdout)) = (stdin, stdout) else {
            return Err(bun_sys::Error::from_code(
                bun_sys::E::EBADF,
                bun_sys::Tag::pipe,
            ));
        };
        let _ = bun_sys::set_nonblocking(stdin.fd());
        let _ = bun_sys::set_nonblocking(stdout.fd());
        let event_loop = self.event_loop.as_event_loop_ctx();
        self.stdin.start(self, event_loop, stdin, true)?;
        self.stdin.set_poll_flag(FilePollFlag::Socket);
        self.stdout
            .update_flags(|flags| flags.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET));
        match self.stdout.start(event_loop, stdout.into(), true)? {
            ReadResult::Err(error) => Err(error),
            ReadResult::Pending | ReadResult::Done => Ok(()),
        }
    }

    #[cfg(windows)]
    fn start_pipes(
        &self,
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
        self.stdin.start_with_pipe(self, stdin);
        self.stdout.start_with_pipe(stdout)
    }

    fn connection(&self) -> &Connection {
        &self.program.connection
    }

    fn write(&self, bytes: &[u8]) {
        // What the pipe doesn't accept now is buffered, and written when the loop says the pipe has room.
        let result = self.stdin.write(self, bytes);
        if matches!(result, WriteResult::Err(_) | WriteResult::Done(_)) {
            self.kill();
        }
    }

    /// Every failure ends here: the process is killed, and `on_process_exit` then ends the connection, which wakes
    /// every thread that's waiting for a response.
    fn kill(&self) {
        if let Some(process) = &self.process
            && !process.has_exited()
        {
            let _ = process.kill(bun_sys::SignalCode::SIGKILL.0);
        }
    }

    pub(crate) fn on_writer_io(&self, event: IoEvent) {
        self.stdin.on_io(self, event);
    }

    pub(crate) fn on_io(&self, event: IoEvent) {
        self.read(Some(event));
    }

    fn read(&self, event: Option<IoEvent>) {
        let event_loop = self.event_loop.as_event_loop_ctx();
        let reader = &self.stdout;
        match reader.read_chunks(event_loop, event, |chunk, _| self.on_read_chunk(&chunk)) {
            ReadResult::Pending => {}
            // The program closed its standard output, so it can't answer anymore.
            ReadResult::Done | ReadResult::Err(_) => self.kill(),
        }
    }

    /// Returns false to stop reading.
    fn on_read_chunk(&self, chunk: &[u8]) -> bool {
        match receive_from_content_mapper(self.connection(), chunk) {
            Ok(replies) if replies.is_empty() => true,
            Ok(replies) => {
                self.write(&replies);
                true
            }
            // The program doesn't follow the protocol. The connection has ended.
            Err(_) => {
                self.kill();
                false
            }
        }
    }

    fn on_process_exit(&self, status: &Status) {
        self.has_exited.set(true);
        // Read the responses that the pipe still has. Then close it, because a process that the program started
        // may keep the other end open forever.
        #[cfg(unix)]
        if !self.stdout.is_done() && self.stdout.get_fd() != bun_sys::Fd::INVALID {
            self.read(None);
        }
        if !self.stdout.is_done() {
            self.stdout.deinit();
        }
        self.stdin.end(self);
        // `ProcessState.ExitCode`
        let code = match status {
            Status::Exited(exited) => i32::from(exited.code),
            _ => -1,
        };
        self.connection().end(CallError::Exited { code });
    }
}

impl WriteHandler for Child {
    fn on_write(&self, _: usize, _: WriteStatus) {}

    /// The program closed its standard input, or exited.
    fn on_error(&self, _: bun_sys::Error) {
        self.kill();
    }

    fn on_close(&self) {}

    /// The child outlives the loop, and so every write.
    #[cfg(windows)]
    fn set_has_inflight_write(&self, _: bool) {}
}

// The exit of a process that only the type checker starts. Without the mark every executable keeps what reads a
// mapper's reply.
bun_spawn::link_impl_ProcessExit! {
    ContentMapper for Child => |this| {
        on_process_exit(status, _rusage) => bun_removable_features::removable_body_behind_value!(Check, {
            (*this).on_process_exit(&status)
        }),
    }
}
