use core::ffi::CStr;
use std::io::Write as _;

use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum State {
    #[default]
    Idle,
    Err,
    Done,
}

pub struct Seq {
    state: State,
    buf: Vec<u8>,
    start: f32,
    end: f32,
    increment: f32,
    /// Borrowed from argv (NUL-terminated arena strings) or `'static` literals;
    /// argv outlives the builtin — `RawSlice` invariant.
    separator: bun_ptr::RawSlice<u8>,
    terminator: bun_ptr::RawSlice<u8>,
    fixed_width: bool,
}

impl Default for Seq {
    fn default() -> Self {
        Self {
            state: State::Idle,
            buf: Vec::new(),
            start: 1.0,
            end: 1.0,
            increment: 1.0,
            separator: bun_ptr::RawSlice::new(b"\n"),
            terminator: bun_ptr::RawSlice::EMPTY,
            fixed_width: false,
        }
    }
}

impl Seq {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();
        if argc == 0 {
            return Self::fail(interp, cmd, Kind::Seq.usage_string());
        }

        let mut idx = 0usize;
        // Flag parsing — operates on raw argv pointers so we can stash
        // borrowed slices into separator/terminator.
        while idx < argc {
            let arg = Builtin::of(interp, cmd).arg_bytes(idx);

            if arg == b"-s" || arg == b"--separator" {
                idx += 1;
                if idx >= argc {
                    return Self::fail(interp, cmd, b"seq: option requires an argument -- s\n");
                }
                let bytes = Builtin::of(interp, cmd).arg_bytes(idx);
                Self::state_mut(interp, cmd).separator = bun_ptr::RawSlice::new(bytes);
                idx += 1;
                continue;
            }
            if arg.starts_with(b"-s") && arg.len() > 2 {
                Self::state_mut(interp, cmd).separator = bun_ptr::RawSlice::new(&arg[2..]);
                idx += 1;
                continue;
            }
            if arg == b"-t" || arg == b"--terminator" {
                idx += 1;
                if idx >= argc {
                    return Self::fail(interp, cmd, b"seq: option requires an argument -- t\n");
                }
                let bytes = Builtin::of(interp, cmd).arg_bytes(idx);
                Self::state_mut(interp, cmd).terminator = bun_ptr::RawSlice::new(bytes);
                idx += 1;
                continue;
            }
            if arg.starts_with(b"-t") && arg.len() > 2 {
                Self::state_mut(interp, cmd).terminator = bun_ptr::RawSlice::new(&arg[2..]);
                idx += 1;
                continue;
            }
            if arg == b"-w" || arg == b"--fixed-width" {
                Self::state_mut(interp, cmd).fixed_width = true;
                idx += 1;
                continue;
            }
            break;
        }

        // Positional args.
        macro_rules! parse_num {
            ($i:expr) => {{
                let s = Builtin::of(interp, cmd).arg_bytes($i);
                match parse_f32(s) {
                    Some(n) if n.is_finite() => n,
                    _ => return Self::fail(interp, cmd, b"seq: invalid argument\n"),
                }
            }};
        }

        if idx >= argc {
            return Self::fail(interp, cmd, Kind::Seq.usage_string());
        }
        let int1 = parse_num!(idx);
        idx += 1;
        {
            let me = Self::state_mut(interp, cmd);
            me.end = int1;
            if me.start > me.end {
                me.increment = -1.0;
            }
        }

        if idx < argc {
            let int2 = parse_num!(idx);
            idx += 1;
            {
                let me = Self::state_mut(interp, cmd);
                me.start = int1;
                me.end = int2;
                me.increment = if me.start < me.end {
                    1.0
                } else if me.start > me.end {
                    -1.0
                } else {
                    me.increment
                };
            }
            if idx < argc {
                let int3 = parse_num!(idx);
                {
                    let me = Self::state_mut(interp, cmd);
                    me.start = int1;
                    me.increment = int2;
                    me.end = int3;
                }
                let me = Self::state_mut(interp, cmd);
                if me.increment == 0.0 {
                    return Self::fail(interp, cmd, b"seq: zero increment\n");
                }
                if me.start > me.end && me.increment > 0.0 {
                    return Self::fail(interp, cmd, b"seq: needs negative decrement\n");
                }
                if me.start < me.end && me.increment < 0.0 {
                    return Self::fail(interp, cmd, b"seq: needs positive increment\n");
                }
            }
        }

        Self::do_(interp, cmd)
    }

    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        Self::state_mut(interp, cmd).state = State::Err;
        Builtin::write_failing_error(interp, cmd, msg, 1)
    }

    fn do_(interp: &Interpreter, cmd: NodeId) -> Yield {
        let needs_io = Builtin::of(interp, cmd).stdout.needs_io().is_some();
        // PORT NOTE: reshaped for borrowck — render entirely into a local
        // Vec, then either enqueue it or write_no_io it. Zig wrote each
        // number directly when !needs_io; we buffer once for simplicity.
        let (start, end, incr, sep, term) = {
            let me = Self::state_mut(interp, cmd);
            (me.start, me.end, me.increment, me.separator, me.terminator)
        };
        let mut out = Vec::new();
        let mut current = start;
        while if incr > 0.0 {
            current <= end
        } else {
            current >= end
        } {
            // TODO(port): verify Rust `{}` f32 formatting matches Zig `{d}`.
            let _ = write!(&mut out, "{}", current);
            out.extend_from_slice(sep.slice());
            current += incr;
        }
        out.extend_from_slice(term.slice());

        Self::state_mut(interp, cmd).state = State::Done;
        if needs_io {
            Self::state_mut(interp, cmd).buf = out;
            let safeguard = Builtin::of(interp, cmd).stdout.needs_io().unwrap();
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            // PORT NOTE: reshaped for borrowck — clone the slice so the &mut
            // on stdout doesn't alias `buf`.
            let buf = Self::state_mut(interp, cmd).buf.clone();
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &out);
        Builtin::done(interp, cmd, 0)
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if e.is_some() {
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        match Self::state_mut(interp, cmd).state {
            State::Done => Builtin::done(interp, cmd, 0),
            State::Err => Builtin::done(interp, cmd, 1),
            State::Idle => {
                crate::shell::interpreter::unreachable_state("Seq.onIOWriterChunk", "idle")
            }
        }
    }
}

#[inline]
fn parse_f32(bytes: &[u8]) -> Option<f32> {
    bun_core::fmt::parse_f32(bytes)
}

// ported from: src/shell/builtin/seq.zig
