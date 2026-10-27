//! `bun_brotli::StreamingDecoder` against what it replaced: the same loop around the C decoder.
use crate::ffi::CDecoder;
use crate::rng::Rng;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum State {
    Uninitialized,
    Inflating,
    End,
    Error,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Failure {
    Decompression,
    OutOfMemory,
    ShortRead,
}

/// `StreamingDecoder` as it was before the C library was replaced (src/brotli/lib.rs at 92e819d8).
pub struct Old {
    c: CDecoder,
    state: State,
}

impl Old {
    pub fn new() -> Self {
        let mut c = CDecoder::new();
        c.set(1, 1);
        Self { c, state: State::Uninitialized }
    }
    pub fn is_inflating(&self) -> bool {
        self.state == State::Inflating
    }
    pub fn decompress(&mut self, input: &[u8], out: &mut Vec<u8>, max_output: usize, is_done: bool) -> Result<usize, Failure> {
        if matches!(self.state, State::End | State::Error) {
            return Ok(input.len());
        }
        let mut total_in = 0usize;
        loop {
            if out.len() >= max_output {
                return Ok(total_in);
            }
            out.reserve(4096);
            let budget = max_output - out.len();
            let out_len = (out.capacity() - out.len()).min(budget);
            let start = out.len();
            // The C decoder wants initialized memory from safe code.
            out.resize(start + out_len, 0);
            let (result, used, made) = self.c.stream(&input[total_in..], &mut out[start..]);
            out.truncate(start + made);
            total_in += used;
            match result {
                1 => {
                    self.state = State::End;
                    return Ok(input.len());
                }
                0 => {
                    self.state = State::Error;
                    return Err(if (-30..=-21).contains(&self.c.error_code()) { Failure::OutOfMemory } else { Failure::Decompression });
                }
                2 => {
                    self.state = State::Inflating;
                    if made > 0 && self.c.has_more_output() {
                        continue;
                    }
                    if is_done {
                        self.state = State::Error;
                        return Err(Failure::Decompression);
                    }
                    return Err(Failure::ShortRead);
                }
                _ => self.state = State::Inflating,
            }
        }
    }
}

fn convert(r: bun_brotli::Result<usize>) -> Result<usize, Failure> {
    r.map_err(|e| match e {
        bun_brotli::Error::BrotliDecompressionError => Failure::Decompression,
        bun_brotli::Error::OutOfMemory => Failure::OutOfMemory,
        bun_brotli::Error::ShortRead => Failure::ShortRead,
    })
}

/// Feeds `stream` to both in the pieces that `schedule` gives. Stops after about `limit` bytes of output.
pub fn compare(stream: &[u8], schedule: u64, limit: usize) -> Result<(), String> {
    let mut rng = Rng(schedule);
    let mut old = Old::new();
    let mut new = bun_brotli::StreamingDecoder::new();
    let (mut a, mut b) = (Vec::new(), Vec::new());
    if rng.chance(1, 4) {
        // It appends.
        a.extend_from_slice(b"before");
        b.extend_from_slice(b"before");
    }
    let style = rng.below(5);
    let cap_style = rng.below(4);
    let mut pos = 0usize;
    let mut after_end = 0;
    let mut calls = 0;
    loop {
        calls += 1;
        let left = stream.len() - pos;
        let n = match style {
            0 => left,
            1 => 1,
            2 => rng.range(0, 7),
            3 => rng.range(0, 300),
            _ => rng.range(0, 1 << 14),
        }
        .min(left);
        let is_done = n == left && (style == 0 || rng.chance(3, 4));
        let max_output = match cap_style {
            0 => usize::MAX,
            1 => a.len() + rng.range(0, 5),
            2 => a.len() + rng.range(0, 5000),
            _ => if rng.chance(1, 2) { usize::MAX } else { a.len().saturating_sub(rng.below(3)) + rng.below(70000) },
        };
        let input = &stream[pos..pos + n];
        let before = a.len();
        let x = old.decompress(input, &mut a, max_output, is_done);
        let y = convert(new.decompress(input, &mut b, max_output, is_done));
        let at = || format!("call {calls}: pos {pos} n {n} max_output {max_output} is_done {is_done}");
        if x != y {
            return Err(format!("StreamingDecoder: old {x:?} new {y:?} at {}", at()));
        }
        if a.len() != b.len() || a[before..] != b[before..] {
            return Err(format!("StreamingDecoder: output differs, {} and {} bytes, at {}", a.len(), b.len(), at()));
        }
        if old.is_inflating() != new.is_inflating() {
            return Err(format!("StreamingDecoder: is_inflating old {} new {} at {}", old.is_inflating(), new.is_inflating(), at()));
        }
        if a.capacity() != b.capacity() {
            return Err(format!("StreamingDecoder: capacity old {} new {} at {}", a.capacity(), b.capacity(), at()));
        }
        match x {
            Ok(used) => pos += used,
            Err(Failure::ShortRead) => pos += n,
            Err(_) => {}
        }
        let ended = matches!(old.state, State::End | State::Error);
        if ended {
            after_end += 1;
        }
        if after_end > 2 || a.len() > limit || calls > 20_000 || (pos == stream.len() && is_done && !ended && x.is_err()) {
            return Ok(());
        }
    }
}
