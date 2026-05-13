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
        if let Some(e) = e {
            // Spec: seq.zig `onIOWriterChunk` does `defer e.deref()` — release
            // the SystemError's owned BunString fields (no `Drop` impl on
            // `bun_sys::SystemError`).
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

#[inline]
fn parse_f32(bytes: &[u8]) -> Option<f32> {
    if let Some(n) = bun_core::fmt::parse_f32(bytes) {
        return Some(n);
    }
    // PORT NOTE: Zig's `seq` parses operands with `std.fmt.parseFloat(f32, ...)`,
    // which accepts forms the JS/WTF double parser (`bun_core::fmt::parse_f32`)
    // rejects: `_` digit separators (`1_000`) and hexadecimal floats (`0x1p4`,
    // `0x1.8`, `0x10`). Handle those here so `seq` matches the Zig builtin.
    parse_float_zig_compat(std::str::from_utf8(bytes).ok()?)
}

/// Best-effort port of the `std.fmt.parseFloat` grammar covering the cases the
/// WTF double parser does not accept: underscore digit separators and
/// hexadecimal floats. Returns `None` for anything else (the WTF parser has
/// already had a shot at the plain-decimal grammar).
fn parse_float_zig_compat(s: &str) -> Option<f32> {
    if s.is_empty() {
        return None;
    }
    let bytes = s.as_bytes();
    // Optional leading sign (Zig strips this before `parseNumber`).
    let (negative, after_sign) = match bytes[0] {
        b'-' => (true, &s[1..]),
        b'+' => (false, &s[1..]),
        _ => (false, s),
    };
    let ab = after_sign.as_bytes();
    if ab.is_empty() {
        return None;
    }

    let (is_hex, body) = if ab.len() >= 2 && ab[0] == b'0' && (ab[1] | 0x20) == b'x' {
        (true, &after_sign[2..])
    } else {
        (false, after_sign)
    };

    let has_underscore = body.as_bytes().contains(&b'_');
    if !has_underscore && !is_hex {
        // Nothing here the WTF parser hasn't already rejected.
        return None;
    }
    // Zig validates the post-sign slice (and, for hex, the post-`0x` slice) with
    // `validUnderscores`: each `_` must sit between two digits of the base.
    if has_underscore && !valid_underscores(body.as_bytes(), if is_hex { 16 } else { 10 }) {
        return None;
    }
    let cleaned: String = if has_underscore {
        body.chars().filter(|&c| c != '_').collect()
    } else {
        body.to_string()
    };

    let value = if is_hex {
        parse_hex_float_body(&cleaned)?
    } else {
        // Underscore-only decimal: stripping `_` yields a plain decimal float
        // whose grammar matches what Rust's `f32::from_str` accepts.
        cleaned.parse::<f32>().ok()?
    };
    Some(if negative { -value } else { value })
}

fn is_base_digit(c: u8, base: u32) -> bool {
    match base {
        16 => c.is_ascii_hexdigit(),
        _ => c.is_ascii_digit(),
    }
}

/// Mirror of Zig's `std.fmt.parse_float.parse.validUnderscores`.
fn valid_underscores(s: &[u8], base: u32) -> bool {
    let mut i = 0usize;
    while i < s.len() {
        if s[i] == b'_' {
            if i == 0 || i + 1 == s.len() {
                return false;
            }
            if !is_base_digit(s[i - 1], base) || !is_base_digit(s[i + 1], base) {
                return false;
            }
        }
        i += 1;
    }
    true
}

/// Parse a hexadecimal float body — everything after the `0x`/`0X` prefix, with
/// underscores already removed: `hexdigits? ('.' hexdigits?)? (('p'|'P') sign?
/// decdigits+)?` with at least one mantissa digit. Returns `None` if `s` is not
/// a complete, well-formed hex float.
fn parse_hex_float_body(s: &str) -> Option<f32> {
    let (mantissa_str, exp_str) = match s.bytes().position(|c| c == b'p' || c == b'P') {
        Some(p) => (&s[..p], Some(&s[p + 1..])),
        None => (s, None),
    };
    let (int_str, frac_str) = match mantissa_str.bytes().position(|c| c == b'.') {
        Some(d) => (&mantissa_str[..d], &mantissa_str[d + 1..]),
        None => (mantissa_str, ""),
    };
    if int_str.is_empty() && frac_str.is_empty() {
        return None; // need at least one mantissa digit
    }

    let mut mantissa: f64 = 0.0;
    for c in int_str.chars() {
        mantissa = mantissa * 16.0 + f64::from(c.to_digit(16)?);
    }
    let mut scale: f64 = 1.0;
    for c in frac_str.chars() {
        scale /= 16.0;
        mantissa += f64::from(c.to_digit(16)?) * scale;
    }

    let mut bin_exp: i32 = 0;
    if let Some(exp_str) = exp_str {
        let eb = exp_str.as_bytes();
        if eb.is_empty() {
            return None;
        }
        let (eneg, edigits) = match eb[0] {
            b'-' => (true, &exp_str[1..]),
            b'+' => (false, &exp_str[1..]),
            _ => (false, exp_str),
        };
        if edigits.is_empty() {
            return None;
        }
        let mut val: i64 = 0;
        for c in edigits.chars() {
            let d = i64::from(c.to_digit(10)?);
            // Saturate well before overflow (Zig clamps the same way).
            if val < 0x1000_0000 {
                val = val * 10 + d;
            }
        }
        if eneg {
            val = -val;
        }
        bin_exp = val.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
    }

    if mantissa == 0.0 {
        // Avoid `0.0 * inf == NaN` for absurd exponents; Zig yields zero here.
        return Some(0.0);
    }
    Some((mantissa * 2.0f64.powi(bin_exp)) as f32)
}

// ported from: src/shell/builtin/seq.zig
