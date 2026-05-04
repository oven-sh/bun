use core::ffi::{c_char, CStr};
use core::mem::offset_of;
use std::sync::Arc;

use bstr::BStr;

use bun_jsc::SystemError;
use bun_shell::interpreter::{
    unsupported_flag, FlagParser, ParseError, ParseFlagResult, ShellSyscall,
};
use bun_shell::interpreter::builtin::{self, Builtin, BuiltinKind};
use bun_shell::{ExitCode, IOReader, Yield};
use bun_sys::O;

bun_output::declare_scope!(ShellCat, hidden);

#[derive(Default)]
pub struct Cat {
    opts: Opts,
    state: State,
}

#[derive(Default, strum::IntoStaticStr)]
enum State {
    #[default]
    Idle,
    ExecStdin(ExecStdin),
    ExecFilepathArgs(ExecFilepathArgs),
    WaitingWriteErr,
    Done,
}

#[derive(Default)]
struct ExecStdin {
    in_done: bool,
    chunks_queued: usize,
    chunks_done: usize,
    errno: ExitCode,
}

struct ExecFilepathArgs {
    // TODO(port): lifetime — borrowed from Builtin::args_slice(); raw fat ptr because
    // Cat is embedded in Builtin (BACKREF) and we cannot add a lifetime param in Phase A.
    args: *const [*const c_char],
    idx: usize,
    reader: Option<Arc<IOReader>>,
    chunks_queued: usize,
    chunks_done: usize,
    out_done: bool,
    in_done: bool,
}

impl State {
    #[inline]
    fn exec_stdin(&mut self) -> &mut ExecStdin {
        match self {
            State::ExecStdin(s) => s,
            _ => unreachable!(),
        }
    }
    #[inline]
    fn exec_filepath_args(&mut self) -> &mut ExecFilepathArgs {
        match self {
            State::ExecFilepathArgs(s) => s,
            _ => unreachable!(),
        }
    }
}

impl Cat {
    pub fn write_failing_error(&mut self, buf: &[u8], exit_code: ExitCode) -> Yield {
        let this_ptr = self as *mut Cat;
        // SAFETY: Cat is the `cat` field of Builtin::Impl which is the `impl` field of Builtin.
        // TODO(port): aliasing — `bltn` overlaps with `self`; accesses are to disjoint
        // fields (stderr/stdout/stdin), Phase B should verify or route via raw ptr.
        let bltn = unsafe { &mut *Self::bltn_raw(this_ptr) };

        if let Some(safeguard) = bltn.stderr.needs_io() {
            self.state = State::WaitingWriteErr;
            return bltn.stderr.enqueue(this_ptr, buf, safeguard);
        }

        let _ = bltn.write_no_io(builtin::Io::Stderr, buf);

        bltn.done(exit_code)
    }

    pub fn start(&mut self) -> Yield {
        let this_ptr = self as *mut Cat;
        // SAFETY: see write_failing_error.
        let bltn = unsafe { &mut *Self::bltn_raw(this_ptr) };

        let filepath_args = match self.opts.parse(bltn.args_slice()) {
            Ok(filepath_args) => filepath_args,
            Err(e) => {
                let buf: &[u8] = match e {
                    ParseError::IllegalOption(opt_str) => bltn.fmt_error_arena(
                        BuiltinKind::Cat,
                        format_args!("illegal option -- {}\n", BStr::new(opt_str)),
                    ),
                    ParseError::ShowUsage => BuiltinKind::Cat.usage_string(),
                    ParseError::Unsupported(unsupported) => bltn.fmt_error_arena(
                        BuiltinKind::Cat,
                        format_args!(
                            "unsupported option, please open a GitHub issue -- {}\n",
                            BStr::new(unsupported)
                        ),
                    ),
                };

                return self.write_failing_error(buf, 1);
            }
        };

        let should_read_from_stdin =
            filepath_args.is_none() || filepath_args.as_ref().unwrap().is_empty();

        if should_read_from_stdin {
            self.state = State::ExecStdin(ExecStdin::default());
        } else {
            self.state = State::ExecFilepathArgs(ExecFilepathArgs {
                args: filepath_args.unwrap() as *const [*const c_char],
                idx: 0,
                reader: None,
                chunks_queued: 0,
                chunks_done: 0,
                out_done: false,
                in_done: false,
            });
        }

        self.next()
    }

    pub fn next(&mut self) -> Yield {
        let this_ptr = self as *mut Cat;
        // SAFETY: see write_failing_error.
        let bltn = unsafe { &mut *Self::bltn_raw(this_ptr) };

        match &mut self.state {
            State::Idle => panic!("Invalid state"),
            State::ExecStdin(st) => {
                if !bltn.stdin.needs_io() {
                    st.in_done = true;
                    let buf = bltn.read_stdin_no_io();
                    if let Some(safeguard) = bltn.stdout.needs_io() {
                        return bltn.stdout.enqueue(this_ptr, buf, safeguard);
                    }
                    let _ = bltn.write_no_io(builtin::Io::Stdout, buf);
                    return bltn.done(0);
                }
                bltn.stdin.fd.add_reader(this_ptr);
                bltn.stdin.fd.start()
            }
            State::ExecFilepathArgs(exec) => {
                // PORT NOTE: reshaped for borrowck — capture what we need from `exec`,
                // then re-acquire after calls that need `&mut self`.
                // SAFETY: args points into Builtin's argv which outlives Cat.
                let args = unsafe { &*exec.args };
                if exec.idx >= args.len() {
                    exec.reader = None; // Arc::drop == r.deref()
                    return bltn.done(0);
                }

                // drop previous reader (r.deref())
                exec.reader = None;

                // SAFETY: argv entries are NUL-terminated.
                let arg = unsafe { CStr::from_ptr(args[exec.idx]) }.to_bytes();
                exec.idx += 1;
                let dir = bltn.parent_cmd().base.shell.cwd_fd;
                let fd = match ShellSyscall::openat(dir, arg, O::RDONLY, 0) {
                    bun_sys::Result::Ok(fd) => fd,
                    bun_sys::Result::Err(e) => {
                        let buf = bltn.task_error_to_string(BuiltinKind::Cat, e);
                        // PORT NOTE: Zig had `defer exec.deinit()` here; in Rust the old
                        // State variant is dropped automatically when write_failing_error
                        // assigns `State::WaitingWriteErr`, which drops the Arc.
                        exec.reader = None;
                        return self.write_failing_error(buf, 1);
                    }
                };

                let reader = IOReader::init(fd, bltn.event_loop());
                let exec = self.state.exec_filepath_args();
                exec.chunks_done = 0;
                exec.chunks_queued = 0;
                exec.in_done = false;
                exec.out_done = false;
                exec.reader = Some(reader);
                let r = exec.reader.as_ref().unwrap();
                r.add_reader(this_ptr);
                r.start()
            }
            State::WaitingWriteErr => Yield::Failed,
            State::Done => bltn.done(0),
        }
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, err: Option<SystemError>) -> Yield {
        bun_output::scoped_log!(
            ShellCat,
            "onIOWriterChunk(0x{:x}, {}, had_err={})",
            self as *mut _ as usize,
            <&'static str>::from(&self.state),
            err.is_some()
        );

        let this_ptr = self as *mut Cat;
        // SAFETY: see write_failing_error.
        let bltn = unsafe { &mut *Self::bltn_raw(this_ptr) };

        // Writing to stdout errored, cancel everything and write error
        if let Some(e) = err {
            // PORT NOTE: `defer e.deref()` — SystemError::drop handles refcount.
            let errno: ExitCode = ExitCode::try_from(e.get_errno() as i32).unwrap();
            match &mut self.state {
                State::ExecStdin(st) => {
                    st.errno = errno;
                    // Cancel reader if needed
                    if !st.in_done {
                        if bltn.stdin.needs_io() {
                            bltn.stdin.fd.remove_reader(this_ptr);
                        }
                        st.in_done = true;
                    }
                    return bltn.done(e.get_errno());
                }
                State::ExecFilepathArgs(exec) => {
                    if let Some(r) = &exec.reader {
                        r.remove_reader(this_ptr);
                    }
                    exec.reader = None;
                    return bltn.done(e.get_errno());
                }
                State::WaitingWriteErr => return bltn.done(e.get_errno()),
                _ => panic!("Invalid state"),
            }
        }

        match &mut self.state {
            State::ExecStdin(st) => {
                st.chunks_done += 1;
                if st.in_done && (st.chunks_done >= st.chunks_queued) {
                    return bltn.done(0);
                }
                // Need to wait for more chunks to be written
                Yield::Suspended
            }
            State::ExecFilepathArgs(st) => {
                st.chunks_done += 1;
                if st.chunks_done >= st.chunks_queued {
                    st.out_done = true;
                }
                if st.in_done && st.out_done {
                    return self.next();
                }
                // Wait for reader to be done
                Yield::Suspended
            }
            State::WaitingWriteErr => bltn.done(1),
            _ => panic!("Invalid state"),
        }
    }

    pub fn on_io_reader_chunk(&mut self, chunk: &[u8], remove: &mut bool) -> Yield {
        bun_output::scoped_log!(
            ShellCat,
            "onIOReaderChunk(0x{:x}, {}, chunk_len={})",
            self as *mut _ as usize,
            <&'static str>::from(&self.state),
            chunk.len()
        );
        *remove = false;

        let this_ptr = self as *mut Cat;
        // SAFETY: see write_failing_error.
        let bltn = unsafe { &mut *Self::bltn_raw(this_ptr) };

        match &mut self.state {
            State::ExecStdin(st) => {
                if let Some(safeguard) = bltn.stdout.needs_io() {
                    st.chunks_queued += 1;
                    return bltn.stdout.enqueue(this_ptr, chunk, safeguard);
                }
                let _ = bltn.write_no_io(builtin::Io::Stdout, chunk);
                Yield::Done
            }
            State::ExecFilepathArgs(st) => {
                if let Some(safeguard) = bltn.stdout.needs_io() {
                    st.chunks_queued += 1;
                    return bltn.stdout.enqueue(this_ptr, chunk, safeguard);
                }
                let _ = bltn.write_no_io(builtin::Io::Stdout, chunk);
                Yield::Done
            }
            _ => panic!("Invalid state"),
        }
        // PORT NOTE: trailing `return .done;` in Zig was unreachable.
    }

    pub fn on_io_reader_done(&mut self, err: Option<SystemError>) -> Yield {
        let errno: ExitCode = if let Some(e) = err {
            // PORT NOTE: `defer e.deref()` — SystemError::drop handles refcount.
            ExitCode::try_from(e.get_errno() as i32).unwrap()
        } else {
            0
        };
        bun_output::scoped_log!(
            ShellCat,
            "onIOReaderDone(0x{:x}, {}, errno={})",
            self as *mut _ as usize,
            <&'static str>::from(&self.state),
            errno
        );

        let this_ptr = self as *mut Cat;
        // SAFETY: see write_failing_error.
        let bltn = unsafe { &mut *Self::bltn_raw(this_ptr) };

        match &mut self.state {
            State::ExecStdin(st) => {
                st.errno = errno;
                st.in_done = true;
                if errno != 0 {
                    if (st.chunks_done >= st.chunks_queued) || bltn.stdout.needs_io().is_none() {
                        return bltn.done(errno);
                    }
                    bltn.stdout.fd.writer.cancel_chunks(this_ptr);
                    return Yield::Suspended;
                }
                if (st.chunks_done >= st.chunks_queued) || bltn.stdout.needs_io().is_none() {
                    return bltn.done(0);
                }
            }
            State::ExecFilepathArgs(st) => {
                st.in_done = true;
                if errno != 0 {
                    if st.out_done || bltn.stdout.needs_io().is_none() {
                        st.reader = None;
                        return bltn.done(errno);
                    }
                    bltn.stdout.fd.writer.cancel_chunks(this_ptr);
                    return Yield::Suspended;
                }
                if st.out_done
                    || (st.chunks_done >= st.chunks_queued)
                    || bltn.stdout.needs_io().is_none()
                {
                    return self.next();
                }
            }
            State::Done | State::WaitingWriteErr | State::Idle => {}
        }

        Yield::Suspended
    }

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self points to Builtin.impl.cat; Cat is always embedded in a Builtin.
        unsafe { &mut *Self::bltn_raw(self as *mut Cat) }
    }

    #[inline]
    fn bltn_raw(this: *mut Cat) -> *mut Builtin {
        // SAFETY: `this` points to the `cat` field of `Builtin::Impl`, which is the
        // `impl_` field of `Builtin`. (`offset_of!` stable since 1.77.)
        // TODO(port): verify Rust field names `cat` / `impl_` once Builtin is ported.
        unsafe {
            let impl_ptr = (this as *mut u8)
                .sub(offset_of!(builtin::Impl, cat))
                .cast::<builtin::Impl>();
            (impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, impl_))
                .cast::<Builtin>()
        }
    }
}

// PORT NOTE: Zig `pub fn deinit(_: *Cat) void {}` is empty; State's Drop (via
// Option<Arc<IOReader>>) handles cleanup automatically. No explicit Drop impl needed.

#[derive(Default)]
struct Opts {
    /// -b
    ///
    /// Number the non-blank output lines, starting at 1.
    number_nonblank: bool,

    /// -e
    ///
    /// Display non-printing characters and display a dollar sign ($) at the end of each line.
    show_ends: bool,

    /// -n
    ///
    /// Number the output lines, starting at 1.
    number_all: bool,

    /// -s
    ///
    /// Squeeze multiple adjacent empty lines, causing the output to be single spaced.
    squeeze_blank: bool,

    /// -t
    ///
    /// Display non-printing characters and display tab characters as ^I at the end of each line.
    show_tabs: bool,

    /// -u
    ///
    /// Disable output buffering.
    disable_output_buffering: bool,

    /// -v
    ///
    /// Displays non-printing characters so they are visible.
    show_nonprinting: bool,
}

type Parse = FlagParser<Opts>;

impl Opts {
    pub fn parse<'a>(
        &mut self,
        args: &'a [*const c_char],
    ) -> Result<Option<&'a [*const c_char]>, ParseError> {
        Parse::parse_flags(self, args)
    }

    pub fn parse_long(&mut self, _flag: &[u8]) -> Option<ParseFlagResult> {
        None
    }

    pub fn parse_short(
        &mut self,
        char: u8,
        smallflags: &[u8],
        i: usize,
    ) -> Option<ParseFlagResult> {
        match char {
            b'b' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-b"))),
            b'e' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-e"))),
            b'n' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-n"))),
            b's' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-s"))),
            b't' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-t"))),
            b'u' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-u"))),
            b'v' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-v"))),
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..])),
        }
        // PORT NOTE: trailing `return null;` in Zig was unreachable.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/cat.zig (357 lines)
//   confidence: medium
//   todos:      3
//   notes:      bltn() is intrusive @fieldParentPtr — raw-ptr laundered &mut Builtin aliases &mut self; Phase B must verify disjoint access or restructure. args slice stored as raw fat ptr (BACKREF into Builtin argv).
// ──────────────────────────────────────────────────────────────────────────
