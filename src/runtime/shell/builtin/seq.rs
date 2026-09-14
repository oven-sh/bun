use std::io::Write as _;

use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId, ParseError, unsupported_flag};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum State {
    #[default]
    Idle,
    Err,
    Done,
}

/// `core::fmt` panics on a precision or width above `u16::MAX`, which an
/// operand like `1e-70000` would request; no float has more than 1074
/// fractional digits (the smallest f64 is 2^-1074), so the rest would be zeros.
const MAX_FIXED_WIDTH_DECIMALS: u32 = 1074;

pub struct Seq {
    state: State,
    start: f32,
    end: f32,
    increment: f32,
    /// Most decimal places any positional argument was written with
    /// (`seq 0 0.25 1` → 2); `-w` prints every value with this many.
    decimals: u32,
    /// `-w` / `--fixed-width`: zero-pad every value to the same width.
    fixed_width: bool,
    /// Borrowed from argv (NUL-terminated arena strings) or `'static` literals;
    /// argv outlives the builtin — `RawSlice` invariant.
    separator: bun_ptr::RawSlice<u8>,
    terminator: bun_ptr::RawSlice<u8>,
}

impl Default for Seq {
    fn default() -> Self {
        Self {
            state: State::Idle,
            start: 1.0,
            end: 1.0,
            increment: 1.0,
            decimals: 0,
            fixed_width: false,
            separator: bun_ptr::RawSlice::new(b"\n"),
            terminator: bun_ptr::RawSlice::EMPTY,
        }
    }
}

impl Seq {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
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
            if arg.starts_with(b"-f") || arg == b"--format" {
                let flag: &'static [u8] = if arg == b"--format" {
                    b"--format"
                } else {
                    b"-f"
                };
                return Builtin::fail_parse(
                    interp,
                    cmd,
                    Kind::Seq,
                    &ParseError::Unsupported(unsupported_flag(flag)),
                    || Self::state_mut(interp, cmd).state = State::Err,
                );
            }
            break;
        }

        // Positional args.
        macro_rules! parse_num {
            ($i:expr) => {{
                let s = Builtin::of(interp, cmd).arg_bytes($i);
                let n = match parse_f32(s) {
                    Some(n) if n.is_finite() => n,
                    _ => return Self::fail(interp, cmd, b"seq: invalid argument\n"),
                };
                let decimals = decimal_places(s);
                let me = Self::state_mut(interp, cmd);
                me.decimals = me.decimals.max(decimals);
                n
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
        // Render entirely into a local Vec, then either enqueue it or
        // write_no_io it; we buffer once for simplicity.
        let (start, end, incr, sep, term, fixed_width) = {
            let me = Self::state_mut(interp, cmd);
            let fixed_width = me
                .fixed_width
                .then(|| FixedWidth::new(me.start, me.end, me.decimals));
            (
                me.start,
                me.end,
                me.increment,
                me.separator,
                me.terminator,
                fixed_width,
            )
        };
        let mut out = Vec::new();
        let mut current = start;
        while if incr > 0.0 {
            current <= end
        } else {
            current >= end
        } {
            let _ = match fixed_width {
                Some(FixedWidth { width, decimals }) => {
                    write!(&mut out, "{current:0width$.decimals$}")
                }
                // Rust `{}` for f32 prints the shortest decimal that round-trips
                // (no exponent, no trailing ".0").
                None => write!(&mut out, "{}", current),
            };
            out.extend_from_slice(sep.slice());
            let next = current + incr;
            if next == current {
                // f32 rounding can make `current + incr` equal `current`
                // (e.g. `seq 1 99999999` saturates at 2^24, or a tiny
                // increment relative to `current`). Without this check the
                // loop never terminates and `out` grows without bound.
                break;
            }
            current = next;
        }
        out.extend_from_slice(term.slice());

        Self::state_mut(interp, cmd).state = State::Done;
        if needs_io {
            let safeguard = Builtin::of(interp, cmd).stdout.needs_io().unwrap();
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &out, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &out);
        Builtin::done(interp, cmd, 0)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(_err) = e {
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

/// `-w` layout: `decimals` fraction digits, zero-padded after the sign
/// (`-05`) to `width`, as in BSD and GNU seq.
#[derive(Clone, Copy)]
struct FixedWidth {
    width: usize,
    decimals: usize,
}

impl FixedWidth {
    /// Every value lies between `start` and `end`, and at a fixed number of
    /// decimals it prints no wider than the bound on its side of zero.
    fn new(start: f32, end: f32, decimals: u32) -> Self {
        let decimals = decimals.min(MAX_FIXED_WIDTH_DECIMALS) as usize;
        let len = |n: f32| bun_core::fmt::count(format_args!("{n:.decimals$}"));
        Self {
            width: len(start).max(len(end)),
            decimals,
        }
    }
}

#[inline]
fn parse_f32(bytes: &[u8]) -> Option<f32> {
    bun_core::fmt::parse_f32(bytes)
}

/// Decimal places a positional argument was written with: `0.25` → 2,
/// `1e-3` → 3, `2.50e1` → 1. `arg` has already been accepted by `parse_f32`,
/// so it has the shape `[sign]digits[.digits][e[sign]digits]`.
fn decimal_places(arg: &[u8]) -> u32 {
    let (mantissa, exponent) = match bun_core::strings::index_of_any(arg, b"eE") {
        Some(e) => {
            // An exponent outside i32 either overflowed to inf (rejected by
            // the caller) or underflowed to 0, which needs no decimal places.
            let exponent = bun_core::fmt::parse_decimal::<i32>(&arg[e + 1..]).unwrap_or(0);
            (&arg[..e], i64::from(exponent))
        }
        None => (arg, 0),
    };
    let fraction = match bun_core::strings::index_of_char_usize(mantissa, b'.') {
        Some(dot) => (mantissa.len() - dot - 1) as i64,
        None => 0,
    };
    (fraction - exponent).clamp(0, i64::from(u32::MAX)) as u32
}
