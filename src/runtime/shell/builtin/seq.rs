use std::io::Write as _;

use crate::shell::builtin::{Builtin, BuiltinState, Kind};
use crate::shell::interpreter::{Interpreter, NodeId, OutputNeedsIOSafeGuard};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

/// Chunks are cut at the first value boundary at or past this size; about one is held at a time.
const CHUNK_SIZE: usize = 64 * 1024;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
enum State {
    #[default]
    Idle,
    /// A chunk is being written to stdout and more values follow it.
    Writing,
    Err,
    /// The chunk being written (if any) is the last one.
    Done,
}

pub struct Seq {
    state: State,
    start: f32,
    end: f32,
    increment: f32,
    /// Next value to render.
    current: f32,
    /// The chunk currently being written; reused for every chunk.
    buf: Vec<u8>,
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
            current: 1.0,
            buf: Vec::new(),
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
        {
            let me = Self::state_mut(interp, cmd);
            me.current = me.start;
        }
        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            return Self::enqueue_chunk(interp, cmd, safeguard);
        }
        loop {
            let (mut stdout, me) = Self::split_stdout_no_io(interp, cmd);
            let last = me.render_chunk();
            // Err: the `> ${buffer}` is full, so no later chunk would fit either.
            let written = stdout.write(&me.buf);
            if last || written.is_err() {
                break;
            }
        }
        Self::state_mut(interp, cmd).state = State::Done;
        Builtin::done(interp, cmd, 0)
    }

    /// Queues the next chunk; `on_io_writer_chunk` queues the one after it.
    fn enqueue_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        let (stdout, me) = Self::split_stdout(Builtin::of_mut(interp, cmd));
        me.state = if me.render_chunk() {
            State::Done
        } else {
            State::Writing
        };
        stdout.enqueue(child, &me.buf, safeguard)
    }

    fn has_next(&self) -> bool {
        if self.increment > 0.0 {
            self.current <= self.end
        } else {
            self.current >= self.end
        }
    }

    /// Refills `buf`; true once the sequence (and terminator) has been rendered into it.
    fn render_chunk(&mut self) -> bool {
        self.buf.clear();
        while self.has_next() {
            if self.buf.len() >= CHUNK_SIZE {
                return false;
            }
            // Rust `{}` for f32 prints the shortest decimal that round-trips
            // (no exponent, no trailing ".0").
            let _ = write!(&mut self.buf, "{}", self.current);
            self.buf.extend_from_slice(self.separator.slice());
            let next = self.current + self.increment;
            if next == self.current {
                // f32 rounding can make `current + incr` equal `current`
                // (e.g. `seq 1 99999999` saturates at 2^24, or a tiny
                // increment relative to `current`). Without this check the
                // sequence would never end.
                break;
            }
            self.current = next;
        }
        self.buf.extend_from_slice(self.terminator.slice());
        true
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
            State::Writing => {
                debug_assert!(Builtin::of(interp, cmd).stdout.needs_io().is_some());
                Self::enqueue_chunk(interp, cmd, OutputNeedsIOSafeGuard::OutputNeedsIo)
            }
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
