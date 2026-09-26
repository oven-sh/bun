//! Child processes through `bun_spawn`: the program itself, started again in a mode for a child.
//!
//! The parent gives the child three pipes. It writes to the child's standard input
//! (`StaticPipeWriter`, as `Bun.spawn` does for `stdin: <bytes>`), reads what the child writes to its
//! output and to its error output to the end (`BufferedReader`), and is told how the child ended
//! (`Process`). A second child is killed while it waits.
//!
//! The pipes are what bun makes for the OS: socket pairs and a poll on POSIX, pipes of libuv on Windows.

use core::ffi::{c_char, c_void};

use bun_event_loop::EventLoopHandle;
use bun_io::BufferedReader;
use bun_ptr::{RefCount, RefPtr};
use bun_spawn::subprocess::{Source, StaticPipeWriter, StaticPipeWriterProcess, StdioKind};
use bun_spawn::{
    Process, ProcessExit, ProcessExitKind, ProcessHandle, Rusage, SpawnOptions,
    SpawnResultExt as _, Status, Stdio,
};
use bun_sys::{Fd, File};

use crate::Loop;
use crate::json::Report;

#[cfg(windows)]
use bun_sys::windows::libuv as uv;

const MESSAGE: &[u8] = b"written by the parent, read by the child\n";
const EXIT_CODE: u8 = 7;
const KILL: u8 = 9;

// ---- the child ----

pub(crate) fn main_of_the_child(mode: &[u8]) -> i32 {
    let (stdout, stderr) = (Fd::stdout(), Fd::stderr());
    let (stdout, stderr) = (File::borrow(&stdout), File::borrow(&stderr));
    match mode {
        // Reads its input to the end, answers on both outputs, and ends with a code of its own.
        b"answer" => {
            let mut input = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                match bun_sys::read(Fd::stdin(), &mut buffer) {
                    Ok(0) => break,
                    Ok(read) => input.extend_from_slice(&buffer[..read]),
                    Err(error) if error.is_retry() => continue,
                    Err(_) => return 3,
                }
            }
            let answer: Vec<u8> = input.iter().map(u8::to_ascii_uppercase).collect();
            if stdout.write_all(&answer).is_err() {
                return 4;
            }
            let mut note = Vec::new();
            {
                use std::io::Write as _;
                let _ = writeln!(note, "the child read {} bytes", input.len());
            }
            if stderr.write_all(&note).is_err() {
                return 5;
            }
            i32::from(EXIT_CODE)
        }
        // Says that it runs, and waits for an end that its parent brings.
        b"wait" => {
            if stdout.write_all(b"ready\n").is_err() {
                return 4;
            }
            loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
            }
        }
        _ => 2,
    }
}

// ---- the parent ----

/// A child of this program: the owner of its process, of the writer of its input and of the readers
/// of its outputs.
pub struct Child {
    event_loop: EventLoopHandle,
    process: Option<ProcessHandle>,
    stdin: Option<RefPtr<StaticPipeWriter<Child>>>,
    stdin_closed: bool,
    stdout: BufferedReader,
    stderr: BufferedReader,
    /// Readers that have not reached the end.
    reading: u32,
    reader_errors: u32,
    status: Option<Status>,
    /// The second child is killed once it has said this.
    kill_after: Option<&'static [u8]>,
    killed: bool,
}

// The variants of these interfaces are the owners that bun has. This program takes the place of one
// whose crate it is built without, the lifecycle scripts of `bun install`.
bun_io::impl_buffered_reader_parent! {
    LifecycleScript for Child;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, has_more| (*this).on_read_chunk(chunk, has_more);
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(&err);
    loop_           = |this| (*this).event_loop.native_loop();
    event_loop      = |this| (*this).event_loop.as_event_loop_ctx();
}

bun_spawn::link_impl_ProcessExit! {
    LifecycleScript for Child => |this| {
        on_process_exit(process, status, rusage) => (*this).on_process_exit(process, status, &*rusage),
    }
}

impl StaticPipeWriterProcess for Child {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::PollTag::StaticPipeWriter;

    unsafe fn on_close_io(this: *mut Self, _kind: StdioKind) {
        // SAFETY: `this` is the child that made the writer, which it outlives.
        let child = unsafe { &mut *this };
        if let Some(writer) = child.stdin.take() {
            // SAFETY: `writer` holds the reference of the field.
            unsafe { (*writer.as_ptr()).source.detach() };
        }
        child.stdin_closed = true;
    }
}

impl Child {
    fn on_read_chunk(&mut self, _chunk: bun_io::Chunk<'_>, _has_more: bun_io::ReadState) -> bool {
        if let Some(word) = self.kill_after {
            if !self.killed
                && self
                    .stdout
                    .buffer()
                    .windows(word.len())
                    .any(|part| part == word)
            {
                self.killed = true;
                if let Some(process) = &self.process {
                    let _ = process.kill(KILL);
                }
            }
        }
        true
    }

    fn on_reader_done(&mut self) {
        self.reading -= 1;
    }

    fn on_reader_error(&mut self, _error: &bun_sys::Error) {
        self.reading -= 1;
        self.reader_errors += 1;
    }

    fn on_process_exit(&mut self, _process: &mut Process, status: Status, _rusage: &Rusage) {
        self.status = Some(status);
    }

    fn is_done(&self) -> bool {
        self.status.is_some() && self.reading == 0 && (self.stdin.is_none() || self.stdin_closed)
    }

    /// Starts the program again as `child <mode>`, with `input` for its standard input.
    ///
    /// # Safety
    /// `this` is a `Child` that is not moved or dropped before it `is_done`.
    unsafe fn spawn(
        this: *mut Child,
        command: &[Vec<u8>],
        input: Option<&[u8]>,
    ) -> bun_sys::Result<()> {
        // SAFETY: the contract of the function, for every use of `this` below.
        unsafe {
            let event_loop = (*this).event_loop;
            let mut argv: Vec<*const c_char> = command
                .iter()
                .map(|argument| argument.as_ptr().cast::<c_char>())
                .collect();
            argv.push(core::ptr::null());
            let envp: [*const c_char; 1] = [core::ptr::null()];

            #[cfg(unix)]
            let buffer = || Stdio::Buffer;
            #[cfg(windows)]
            let buffer = || {
                Stdio::Buffer(Box::into_raw(Box::new(bun_core::ffi::zeroed::<uv::Pipe>()))
                    as bun_spawn::windows::UvPipePtr)
            };

            let options = SpawnOptions {
                stdin: if input.is_some() {
                    buffer()
                } else {
                    Stdio::Ignore
                },
                stdout: buffer(),
                stderr: buffer(),
                #[cfg(windows)]
                windows: bun_spawn::WindowsOptions {
                    loop_: event_loop,
                    ..Default::default()
                },
                stream: false,
                ..Default::default()
            };
            let spawned =
                match bun_spawn::spawn_process(&options, argv.as_mut_ptr().cast(), envp.as_ptr()) {
                    Ok(Ok(spawned)) => spawned,
                    other => {
                        #[cfg(windows)]
                        {
                            let mut options = options;
                            options.stdin.deinit();
                            options.stdout.deinit();
                            options.stderr.deinit();
                        }
                        return match other {
                            Ok(Err(error)) => Err(error),
                            _ => Err(bun_sys::Error::from_code(
                                bun_sys::E::EINVAL,
                                bun_sys::Tag::posix_spawn,
                            )),
                        };
                    }
                };
            #[cfg(windows)]
            let mut spawned = spawned;

            #[cfg(unix)]
            {
                for (reader, fd) in [
                    (&raw mut (*this).stdout, spawned.stdout),
                    (&raw mut (*this).stderr, spawned.stderr),
                ] {
                    let Some(fd) = fd else { continue };
                    (*reader).set_parent(this.cast::<c_void>());
                    let _ = bun_sys::set_nonblocking(fd);
                    (*reader)
                        .flags
                        .insert(bun_io::PosixFlags::NONBLOCKING | bun_io::PosixFlags::SOCKET);
                    (*this).reading += 1;
                    (*reader).start(fd, true)?;
                    if let Some(poll) = (*reader).handle.get_poll() {
                        poll.set_flag(bun_io::FilePollFlag::Socket);
                    }
                }
            }
            #[cfg(windows)]
            {
                if let bun_spawn::SpawnedStdio::Buffer(pipe) = spawned.stdout.take() {
                    (*this).stdout.set_source(bun_io::Source::Pipe(pipe));
                    (*this).stdout.set_parent(this.cast::<c_void>());
                    (*this).reading += 1;
                    (*this).stdout.start_with_current_pipe()?;
                }
                if let bun_spawn::SpawnedStdio::Buffer(pipe) = spawned.stderr.take() {
                    (*this).stderr.set_source(bun_io::Source::Pipe(pipe));
                    (*this).stderr.set_parent(this.cast::<c_void>());
                    (*this).reading += 1;
                    (*this).stderr.start_with_current_pipe()?;
                }
            }

            #[cfg(unix)]
            let stdin = spawned.stdin;
            #[cfg(windows)]
            let stdin = spawned.stdin.take();

            let process = (*this)
                .process
                .insert(spawned.to_process_handle(event_loop))
                .as_ptr();
            (*process).set_exit_handler(ProcessExit::new(ProcessExitKind::LifecycleScript, this));

            if let Some(input) = input {
                #[cfg(unix)]
                let has_pipe = stdin.is_some();
                #[cfg(windows)]
                let has_pipe = matches!(stdin, bun_spawn::SpawnedStdio::Buffer(_));
                if has_pipe {
                    let writer = StaticPipeWriter::create(
                        event_loop,
                        this,
                        stdin,
                        Source::from_owned_bytes(Box::from(input)),
                    );
                    let local = writer.clone();
                    (*this).stdin = Some(writer);
                    let pointer = local.as_ptr();
                    if let Err(error) = (*pointer).start() {
                        if let Some(writer) = (*this).stdin.take() {
                            (*writer.as_ptr()).source.detach();
                        }
                        return Err(error);
                    }
                    // The field owns the writer, not the reference that `start` took.
                    RefCount::<StaticPipeWriter<Child>>::deref(pointer);
                    (*pointer).started = false;
                    drop(local);
                }
            }

            if let Err(error) = (*process).watch_or_reap() {
                if !(*process).has_exited() {
                    (*process).on_exit(Status::Err(error), &bun_core::ffi::zeroed::<Rusage>());
                }
            }
            Ok(())
        }
    }
}

/// The command that starts this program again: the program itself when the kernel runs it, the host and
/// the image when a host runs the image.
fn command_of_the_child(program: &'static [u8], mode: &[u8]) -> Option<Vec<Vec<u8>>> {
    let z = |bytes: &[u8]| {
        let mut owned = bytes.to_vec();
        owned.push(0);
        owned
    };
    let mut command = Vec::new();
    #[cfg(windows)]
    {
        // The process is the host: on Windows nothing else runs the image.
        let mut wide = [0u16; 4096];
        let host = bun_sys::windows::get_module_name_w(core::ptr::null_mut(), &mut wide)?;
        command.push(z(&bun_core::strings::to_utf8_alloc(host)));
        command.push(z(program));
    }
    #[cfg(not(windows))]
    {
        let executable = bun_core::self_exe_path().ok()?.as_bytes();
        let mut buffer = bun_paths::path_buffer_pool::get();
        let program_z = z(program);
        let image = bun_sys::realpath(
            bun_core::ZStr::from_buf(&program_z, program.len()),
            &mut buffer,
        )
        .ok()?;
        command.push(z(executable));
        if image != executable {
            command.push(z(image));
        }
    }
    command.push(z(b"child"));
    command.push(z(mode));
    Some(command)
}

fn new_child(event_loop: &Loop, kill_after: Option<&'static [u8]>) -> Box<Child> {
    Box::new(Child {
        event_loop: event_loop.handle(),
        process: None,
        stdin: None,
        stdin_closed: false,
        stdout: BufferedReader::init::<Child>(),
        stderr: BufferedReader::init::<Child>(),
        reading: 0,
        reader_errors: 0,
        status: None,
        kill_after,
        killed: false,
    })
}

fn status_fields(report: &mut Report, status: &Option<Status>) {
    match status {
        Some(Status::Exited(exited)) => {
            report.string("ended", b"exited");
            report.number("exit_code", i64::from(exited.code));
            report.number("signal", i64::from(exited.signal));
        }
        Some(Status::Signaled(signal)) => {
            report.string("ended", b"signaled");
            report.number("signal", i64::from(*signal));
        }
        Some(Status::Err(error)) => {
            report.string("ended", b"error");
            report.string("error", error.name());
        }
        Some(Status::Running) | None => report.string("ended", b"not at all"),
    }
}

fn run(
    report: &mut Report,
    event_loop: &Loop,
    step: &str,
    program: &'static [u8],
    mode: &'static [u8],
    input: Option<&[u8]>,
    kill_after: Option<&'static [u8]>,
) -> Box<Child> {
    let mut child = new_child(event_loop, kill_after);
    let pointer: *mut Child = &raw mut *child;
    let started = match command_of_the_child(program, mode) {
        // SAFETY: the child is in a `Box` that lives until the end of this function's caller.
        Some(command) => unsafe { Child::spawn(pointer, &command, input) },
        None => Err(bun_sys::Error::from_code(
            bun_sys::E::ENOENT,
            bun_sys::Tag::realpath,
        )),
    };
    report.begin(step);
    match started {
        Ok(()) => {
            // SAFETY: the callbacks that write the child run inside of `run_until`, on this thread.
            event_loop.run_until(|| unsafe { (*pointer).is_done() });
            report.boolean("started", true);
        }
        Err(error) => {
            report.boolean("started", false);
            report.string("error", error.name());
            report.string("syscall", <&'static str>::from(error.syscall).as_bytes());
        }
    }
    child
}

pub(crate) fn steps(report: &mut Report, event_loop: &Loop, program: &'static [u8]) -> bool {
    let mut answered = run(
        report,
        event_loop,
        "child with three pipes",
        program,
        b"answer",
        Some(MESSAGE),
        None,
    );
    let expected: Vec<u8> = MESSAGE.iter().map(u8::to_ascii_uppercase).collect();
    let stdout = answered.stdout.final_buffer().clone();
    let stderr = answered.stderr.final_buffer().clone();
    let mut expected_note = Vec::new();
    {
        use std::io::Write as _;
        let _ = writeln!(expected_note, "the child read {} bytes", MESSAGE.len());
    }
    let first = stdout == expected
        && stderr == expected_note
        && answered.reader_errors == 0
        && matches!(&answered.status, Some(Status::Exited(exited)) if exited.code == EXIT_CODE);
    report.boolean(
        "input_written",
        answered.stdin.is_none() && answered.stdin_closed,
    );
    report.string("stdout", &stdout);
    report.string("stderr", &stderr);
    status_fields(report, &answered.status);
    report.boolean("ok", first);
    report.end_line();

    let mut waiting = run(
        report,
        event_loop,
        "child that is killed",
        program,
        b"wait",
        None,
        Some(b"ready\n"),
    );
    let stdout = waiting.stdout.final_buffer().clone();
    let second = waiting.killed
        && stdout == b"ready\n"
        && waiting.reader_errors == 0
        && killed_as_expected(&waiting.status);
    report.boolean("killed", waiting.killed);
    report.string("stdout", &stdout);
    status_fields(report, &waiting.status);
    report.boolean("ok", second);
    report.end_line();
    first && second
}

/// A child that was killed ended by the signal. Windows has no signals: libuv ends the process with the
/// exit code 1 and says which signal it was asked to send.
fn killed_as_expected(status: &Option<Status>) -> bool {
    match status {
        Some(Status::Signaled(signal)) => *signal == KILL,
        Some(Status::Exited(exited)) => cfg!(windows) && exited.signal == KILL,
        _ => false,
    }
}
