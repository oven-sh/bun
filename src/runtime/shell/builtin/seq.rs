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
        // Render entirely into a local Vec, then either enqueue it or
        // write_no_io it; we buffer once for simplicity.
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
            // Rust `{}` for f32 prints the shortest decimal that round-trips
            // (no exponent, no trailing ".0").
            let _ = write!(&mut out, "{}", current);
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
            Self::state_mut(interp, cmd).buf = out;
            let safeguard = Builtin::of(interp, cmd).stdout.needs_io().unwrap();
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            // NOTE: reshaped for borrowck — clone the slice so the &mut
            // on stdout doesn't alias `buf`.
            let buf = Self::state_mut(interp, cmd).buf.clone();
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &buf, safeguard);
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
        if let Some(e) = e {
            e.deref();
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

/// Parse a positional `seq` argument as `f32`.
///
/// Grammar matches Zig's `std.fmt.parseFloat(f32, ...)` (the pre-Rust
/// implementation): decimal floats, C99 hex floats (`0x1p4`, `0x1.8`), and
/// `_` digit separators. `bun_core::fmt::parse_f32` is JS-number semantics
/// (`WTF::parseDouble`) and rejects the latter two; both macOS and GNU
/// coreutils `seq` accept hex.
fn parse_f32(bytes: &[u8]) -> Option<f32> {
    if bytes.is_empty() {
        return None;
    }
    let (neg, rest) = match bytes[0] {
        b'-' => (true, &bytes[1..]),
        b'+' => (false, &bytes[1..]),
        _ => (false, bytes),
    };
    if rest.is_empty() || matches!(rest[0], b'+' | b'-') {
        return None;
    }

    let hex = rest.len() >= 2 && rest[0] == b'0' && matches!(rest[1], b'x' | b'X');
    let is_digit = |b: u8| b.is_ascii_digit() || (hex && matches!(b, b'a'..=b'f' | b'A'..=b'F'));

    // Zig rule: every `_` must sit between two digits of the active base.
    let mut stripped: &[u8] = rest;
    let buf: Vec<u8>;
    if rest.contains(&b'_') {
        for (i, &b) in rest.iter().enumerate() {
            if b == b'_'
                && !(i > 0 && i + 1 < rest.len() && is_digit(rest[i - 1]) && is_digit(rest[i + 1]))
            {
                return None;
            }
        }
        buf = rest.iter().copied().filter(|&b| b != b'_').collect();
        stripped = &buf;
    }

    let mag = if hex {
        parse_hex_float(&stripped[2..])?
    } else {
        bun_core::fmt::parse_f64(stripped)?
    };
    Some(if neg { -mag } else { mag } as f32)
}

/// Parse the body of a C99 hex float (caller has already consumed `0x`).
/// Hex mantissa with at most one `.`, optional `p`/`P` binary exponent.
///
/// Bun.$ argv is in-process (no OS ARG_MAX), so input length is bounded only
/// by the address space. `frac_digits` and `dropped_int_bits` advance at most
/// 4 per input byte, so they cannot reach i64 saturation for any addressable
/// input and are exact when combined. `exp` is parsed from decimal and can
/// saturate at i64::MAX, but then dwarfs the other two terms so the combined
/// sign is preserved; the final clamp to i32 for powi yields inf (rejected by
/// the caller's `is_finite()`) or underflows to 0.
fn parse_hex_float(s: &[u8]) -> Option<f64> {
    let mut mantissa: u64 = 0;
    let mut frac_digits: i64 = 0;
    let mut dropped_int_bits: i64 = 0;
    let mut seen_dot = false;
    let mut seen_digit = false;
    let mut i = 0;
    while i < s.len() {
        let d = match s[i] {
            b @ b'0'..=b'9' => b - b'0',
            b @ b'a'..=b'f' => b - b'a' + 10,
            b @ b'A'..=b'F' => b - b'A' + 10,
            b'.' if !seen_dot => {
                seen_dot = true;
                i += 1;
                continue;
            }
            b'p' | b'P' => break,
            _ => return None,
        };
        seen_digit = true;
        if mantissa >> 60 == 0 {
            mantissa = (mantissa << 4) | d as u64;
            if seen_dot {
                frac_digits += 1;
            }
        } else if !seen_dot {
            dropped_int_bits += 4;
        }
        i += 1;
    }
    if !seen_digit {
        return None;
    }
    let mut exp: i64 = 0;
    if i < s.len() {
        let exp_bytes = &s[i + 1..];
        let (exp_neg, exp_digits) = match exp_bytes.first() {
            Some(b'-') => (true, &exp_bytes[1..]),
            Some(b'+') => (false, &exp_bytes[1..]),
            _ => (false, exp_bytes),
        };
        if exp_digits.is_empty() || !exp_digits.iter().all(u8::is_ascii_digit) {
            return None;
        }
        for &d in exp_digits {
            exp = exp.saturating_mul(10).saturating_add((d - b'0') as i64);
        }
        if exp_neg {
            exp = exp.saturating_neg();
        }
    }
    if mantissa == 0 {
        // Short-circuit so a huge exponent (`0x0p1024`) doesn't reach
        // `0.0 * inf = NaN` below.
        return Some(0.0);
    }
    let exp = exp
        .saturating_sub(frac_digits.saturating_mul(4))
        .saturating_add(dropped_int_bits)
        .clamp(i32::MIN as i64, i32::MAX as i64) as i32;
    // powi on 2.0 is exact (repeated squaring of exact powers of two).
    Some(mantissa as f64 * 2.0_f64.powi(exp))
}
