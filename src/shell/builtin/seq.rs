use core::ffi::{c_char, CStr};
use core::mem::offset_of;
use std::io::Write as _;

use bun_jsc::SystemError;

use crate::interpreter::Builtin;
// TODO(port): exact path for Builtin's nested `Impl` union — Zig: `Interpreter.Builtin.Impl`
use crate::interpreter::builtin::Impl as BuiltinImpl;
// TODO(port): exact path for Builtin's stdout/stderr selector enum — Zig: anon `.stdout` / `.stderr`
use crate::interpreter::builtin::OutKind;
use crate::Yield;

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
    _start: f32,
    _end: f32,
    increment: f32,
    // TODO(port): lifetime — BACKREF: borrows Builtin's argv (`[*:0]const u8` slices); argv outlives Seq
    separator: *const [u8],
    terminator: *const [u8],
    fixed_width: bool,
}

impl Default for Seq {
    fn default() -> Self {
        Self {
            state: State::Idle,
            buf: Vec::new(),
            _start: 1.0,
            _end: 1.0,
            increment: 1.0,
            separator: b"\n" as *const [u8],
            terminator: b"" as *const [u8],
            fixed_width: false,
        }
    }
}

impl Seq {
    pub fn start(&mut self) -> Yield {
        let args = self.bltn().args_slice();
        let mut iter = bun_core::SliceIterator::<*const c_char>::init(args);

        if args.is_empty() {
            return self.fail(Builtin::Kind::usage_string(Builtin::Kind::Seq));
        }
        while let Some(item) = iter.next() {
            // SAFETY: argv entries are NUL-terminated C strings
            let arg = unsafe { CStr::from_ptr(item) }.to_bytes();

            if arg == b"-s" || arg == b"--separator" {
                let Some(next) = iter.next() else {
                    return self.fail(b"seq: option requires an argument -- s\n");
                };
                // SAFETY: argv entries are NUL-terminated C strings
                self.separator = unsafe { CStr::from_ptr(next) }.to_bytes() as *const [u8];
                continue;
            }
            if arg.starts_with(b"-s") {
                self.separator = &arg[2..] as *const [u8];
                continue;
            }

            if arg == b"-t" || arg == b"--terminator" {
                let Some(next) = iter.next() else {
                    return self.fail(b"seq: option requires an argument -- t\n");
                };
                // SAFETY: argv entries are NUL-terminated C strings
                self.terminator = unsafe { CStr::from_ptr(next) }.to_bytes() as *const [u8];
                continue;
            }
            if arg.starts_with(b"-t") {
                self.terminator = &arg[2..] as *const [u8];
                continue;
            }

            if arg == b"-w" || arg == b"--fixed-width" {
                self.fixed_width = true;
                continue;
            }

            iter.index -= 1;
            break;
        }

        let Some(maybe1) = iter.next() else {
            return self.fail(Builtin::Kind::usage_string(Builtin::Kind::Seq));
        };
        // SAFETY: argv entries are NUL-terminated C strings
        let Ok(int1) = parse_f32(unsafe { CStr::from_ptr(maybe1) }.to_bytes()) else {
            return self.fail(b"seq: invalid argument\n");
        };
        if !int1.is_finite() {
            return self.fail(b"seq: invalid argument\n");
        }
        self._end = int1;
        if self._start > self._end {
            self.increment = -1.0;
        }

        let maybe2 = iter.next();
        if maybe2.is_none() {
            return self.r#do();
        }
        // SAFETY: argv entries are NUL-terminated C strings
        let Ok(int2) = parse_f32(unsafe { CStr::from_ptr(maybe2.unwrap()) }.to_bytes()) else {
            return self.fail(b"seq: invalid argument\n");
        };
        if !int2.is_finite() {
            return self.fail(b"seq: invalid argument\n");
        }
        self._start = int1;
        self._end = int2;
        if self._start < self._end {
            self.increment = 1.0;
        }
        if self._start > self._end {
            self.increment = -1.0;
        }

        let maybe3 = iter.next();
        if maybe3.is_none() {
            return self.r#do();
        }
        // SAFETY: argv entries are NUL-terminated C strings
        let Ok(int3) = parse_f32(unsafe { CStr::from_ptr(maybe3.unwrap()) }.to_bytes()) else {
            return self.fail(b"seq: invalid argument\n");
        };
        if !int3.is_finite() {
            return self.fail(b"seq: invalid argument\n");
        }
        self._start = int1;
        self.increment = int2;
        self._end = int3;

        if self.increment == 0.0 {
            return self.fail(b"seq: zero increment\n");
        }
        if self._start > self._end && self.increment > 0.0 {
            return self.fail(b"seq: needs negative decrement\n");
        }
        if self._start < self._end && self.increment < 0.0 {
            return self.fail(b"seq: needs positive increment\n");
        }

        self.r#do()
    }

    fn fail(&mut self, msg: &[u8]) -> Yield {
        // TODO(port): borrowck — bltn() returns parent via @fieldParentPtr, then passes &mut self again
        if let Some(safeguard) = self.bltn().stderr.needs_io() {
            self.state = State::Err;
            return self.bltn().stderr.enqueue(self, msg, safeguard);
        }
        // TODO(port): exact enum path for Builtin output kind (Zig: `.stderr`)
        let _ = self.bltn().write_no_io(OutKind::Stderr, msg);
        self.bltn().done(1)
    }

    fn r#do(&mut self) -> Yield {
        let mut current = self._start;
        // PERF(port): was arena bulk-free (ArenaAllocator.reset(.retain_capacity) per iter) — profile in Phase B
        let mut scratch: Vec<u8> = Vec::new();

        // PORT NOTE: reshaped for borrowck — copied separator/terminator out of self before &mut self.print()
        // SAFETY: BACKREF — argv slices outlive Seq (owned by Builtin)
        let sep = unsafe { &*self.separator };
        let term = unsafe { &*self.terminator };

        while if self.increment > 0.0 { current <= self._end } else { current >= self._end } {
            scratch.clear();
            // TODO(port): verify Rust `{}` f32 formatting matches Zig `{d}` exactly
            write!(&mut scratch, "{}", current).expect("unreachable");
            let _ = self.print(&scratch);
            let _ = self.print(sep);
            current += self.increment;
        }
        let _ = self.print(term);

        self.state = State::Done;
        // TODO(port): borrowck — bltn() parent-ptr aliasing with &self.buf
        if let Some(safeguard) = self.bltn().stdout.needs_io() {
            return self.bltn().stdout.enqueue(self, self.buf.as_slice(), safeguard);
        }
        self.bltn().done(0)
    }

    fn print(&mut self, msg: &[u8]) {
        if self.bltn().stdout.needs_io().is_some() {
            self.buf.extend_from_slice(msg);
            return;
        }
        // TODO(port): exact enum path for Builtin output kind (Zig: `.stdout`)
        let _ = self.bltn().write_no_io(OutKind::Stdout, msg);
    }

    pub fn on_io_writer_chunk(&mut self, _: usize, maybe_e: Option<SystemError>) -> Yield {
        if let Some(_e) = maybe_e {
            // `defer e.deref()` → SystemError's Drop handles the deref
            self.state = State::Err;
            return self.bltn().done(1);
        }
        match self.state {
            State::Done => self.bltn().done(0),
            State::Err => self.bltn().done(1),
            State::Idle => crate::unreachable_state("Seq.onIOWriterChunk", "idle"),
        }
    }

    // Zig `deinit` only freed `self.buf` (Vec<u8> drops automatically) — no explicit Drop needed.

    #[inline]
    pub fn bltn(&mut self) -> &mut Builtin {
        // SAFETY: self is the `seq` field of Builtin::Impl, which is the `impl` field of Builtin
        unsafe {
            let impl_ptr = (self as *mut Self as *mut u8)
                .sub(offset_of!(BuiltinImpl, seq))
                .cast::<BuiltinImpl>();
            &mut *(impl_ptr as *mut u8)
                .sub(offset_of!(Builtin, r#impl))
                .cast::<Builtin>()
        }
    }
}

// TODO(port): std.fmt.parseFloat on &[u8] — Zig accepts arbitrary bytes; Rust f32::from_str needs &str
#[inline]
fn parse_f32(bytes: &[u8]) -> Result<f32, ()> {
    core::str::from_utf8(bytes)
        .ok()
        .and_then(|s| s.parse::<f32>().ok())
        .ok_or(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/seq.zig (148 lines)
//   confidence: medium
//   todos:      9
//   notes:      separator/terminator are raw *const [u8] BACKREF into Builtin's argv; bltn() @fieldParentPtr aliasing needs raw-ptr reshape; OutKind enum path is a guess
// ──────────────────────────────────────────────────────────────────────────
