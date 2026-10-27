//! One very long stream: the position wraps (3 GiB, then every 2 GiB), the ring buffer's counter wraps (2 GiB), and the
//! decoders put out more than 4 GiB. Nothing is kept in memory.
use crate::enc::{EncCase, Pair};
use crate::ffi::CDecoder;
use crate::r#gen;
use crate::rng::Rng;
use bun_brotli::{Decoder, DecoderParameter};

fn mix(h: u64, bytes: &[u8]) -> u64 {
    let mut h = h;
    let mut chunks = bytes.chunks_exact(8);
    for c in &mut chunks {
        h = (h ^ u64::from_le_bytes(c.try_into().unwrap())).wrapping_mul(0x9E3779B97F4A7C15).rotate_left(29);
    }
    for &b in chunks.remainder() {
        h = (h ^ u64::from(b)).wrapping_mul(0x100000001B3);
    }
    h
}

/// A hash that does not depend on how the bytes are cut into pieces.
struct Digest {
    h: u64,
    pending: Vec<u8>,
    n: u64,
}
impl Digest {
    fn new() -> Self {
        Self { h: 0, pending: Vec::new(), n: 0 }
    }
    fn add(&mut self, bytes: &[u8]) {
        self.n += bytes.len() as u64;
        self.pending.extend_from_slice(bytes);
        let whole = self.pending.len() & !7;
        self.h = mix(self.h, &self.pending[..whole]);
        self.pending.drain(..whole);
    }
    fn get(&self) -> (u64, u64) {
        (mix(self.h, &self.pending), self.n)
    }
}

pub fn run(seed: u64, total: u64, params: Vec<(i32, u32)>, corpus: &r#gen::Corpus) {
    let mut rng = Rng(seed);
    let large = params.iter().any(|&(k, v)| k == 6 && v != 0);
    // What the input is made of.
    let mut pool: Vec<Vec<u8>> = (0..48)
        .map(|i| {
            let n = rng.range(1 << 10, 1 << 20);
            if i % 6 == 0 { crate::ring::records(&mut rng, n) } else { r#gen::data(&mut rng, corpus, n) }
        })
        .collect();
    let case = EncCase { data: Vec::new(), params: params.clone(), dicts: Vec::new(), schedule: 0, misuse: false };
    let mut p = Pair::new(&case).unwrap();
    let mut cd = CDecoder::new();
    let mut rd = Decoder::new();
    if large {
        cd.set(1, 1);
        rd.set_parameter(DecoderParameter::LargeWindow, 1);
    }
    let (mut din, mut dout) = (Digest::new(), Digest::new());
    let mut cbuf = vec![0u8; 1 << 20];
    let mut rbuf = vec![0u8; 1 << 20];
    let mut compressed = 0u64;
    let mut finished = false;
    let mut next_report = 1u64 << 30;
    let start = std::time::Instant::now();
    let fail = |at: u64, e: String| -> ! { panic!("seed {seed} params {params:?}, after {at} bytes of input: {e}") };
    while !finished {
        let left = total - din.n;
        // Near the places where something wraps the pieces are small.
        let gib = 1u64 << 30;
        let to_mark = gib - (din.n % gib);
        let close = to_mark < 300_000 || to_mark > gib - 300_000;
        let i = rng.below(pool.len());
        if rng.chance(1, 8) {
            let at = rng.below(pool[i].len());
            pool[i][at] = rng.next() as u8;
        }
        let block = &pool[i];
        let off = rng.below(block.len());
        let max = if close { rng.range(1, 5000) } else { block.len() };
        let n = (block.len() - off).min(max).min(left as usize);
        let chunk = &block[off..off + n];
        let op = if left == n as u64 { 2 } else if rng.chance(1, if close { 50 } else { 400 }) { 1 } else { 0 };
        din.add(chunk);
        let mut input = chunk;
        loop {
            let (ok, used) = p.step(op, input, 1 << 21).unwrap_or_else(|e| fail(din.n, e));
            if !ok {
                fail(din.n, "the encoders failed".into());
            }
            input = &input[used..];
            // Through the decoders.
            compressed += p.out.len() as u64;
            let mut stream: &[u8] = &p.out;
            loop {
                let (cr, cused, cmade) = cd.stream(stream, &mut cbuf);
                let mut rin = stream;
                let mut rout: &mut [u8] = &mut rbuf;
                let rr = rd.decompress_stream(&mut rin, &mut rout) as i32;
                let rmade = (1 << 20) - rout.len();
                let rused = stream.len() - rin.len();
                if cr != rr || cused != rused || cmade != rmade || cbuf[..cmade] != rbuf[..rmade] || cd.has_more_output() != rd.has_more_output() {
                    fail(din.n, format!("decoders differ after {} bytes of output: result {cr}/{rr} (error {} / {:?}) used {cused}/{rused} made {cmade}/{rmade}", dout.n, cd.error_code(), rd.error_code()));
                }
                dout.add(&cbuf[..cmade]);
                stream = &stream[cused..];
                match cr {
                    0 => fail(din.n, format!("the decoders report error {}", cd.error_code())),
                    1 => {
                        finished = true;
                        break;
                    }
                    // That is the result even with output left in the ring buffer.
                    2 if !cd.has_more_output() => break,
                    _ => {}
                }
            }
            p.out.clear();
            if input.is_empty() && !p.has_more_output() {
                break;
            }
        }
        if op == 1 && din.get() != dout.get() {
            fail(din.n, format!("after a flush the output is not the input: {:?} {:?}", din.get(), dout.get()));
        }
        if din.n >= next_report {
            eprintln!("{} GiB in, {compressed} out, {:.0} s", din.n >> 30, start.elapsed().as_secs_f64());
            next_report += 1 << 30;
        }
    }
    if din.get() != dout.get() {
        fail(din.n, format!("the output is not the input: {:?} {:?}", din.get(), dout.get()));
    }
    println!("ok: seed {seed} params {params:?}: {} -> {compressed} in {:.0} s", din.n, start.elapsed().as_secs_f64());
}

/// Random data that repeats after exactly 2 GiB, which is also how far apart two positions are that the encoder gives
/// the same number once it has wrapped them (at 3 GiB). The rolling hasher of windows over 24 bits never forgets, so it
/// finds each position of the second lap in its table, put there by the first. The C encoder takes that for a match at
/// distance 0 (`__builtin_clz(0)`, then a stream that does not decode), so the two are not compared: each stream goes
/// through a decoder, and only Rust's has to come out right.
pub fn run_lap(seed: u64, total: u64, params: Vec<(i32, u32)>) {
    const PIECE: usize = 1 << 20;
    const PERIOD: u64 = 2 << 30;
    let piece = |at: u64, buffer: &mut Vec<u8>| {
        let mut rng = Rng(seed ^ ((at % PERIOD) / PIECE as u64).wrapping_mul(0x2545F4914F6CDD1D));
        buffer.clear();
        buffer.extend((0..PIECE / 8).flat_map(|_| rng.next().to_le_bytes()));
    };
    let mut out = vec![0u8; 2 << 20];
    let mut plain = vec![0u8; 1 << 20];
    let mut input = Vec::new();
    for rust in [true, false] {
        let name = if rust { "Rust" } else { "C" };
        let start = std::time::Instant::now();
        let mut c = crate::ffi::CEncoder::new();
        let mut r = bun_brotli::Encoder::new();
        for &(k, v) in &params {
            assert!(c.set(k, v) && r.set_parameter(bun_brotli::EncoderParameter::from_raw(k as u32).unwrap(), v));
        }
        let mut d = Decoder::new();
        assert!(d.set_parameter(DecoderParameter::LargeWindow, 1));
        let (mut din, mut dout) = (Digest::new(), Digest::new());
        let mut verdict = None;
        'stream: while verdict.is_none() {
            piece(din.n, &mut input);
            input.truncate((total - din.n).min(PIECE as u64) as usize);
            din.add(&input);
            let op = if din.n == total { 2 } else { 0 };
            let mut rest: &[u8] = &input;
            loop {
                let made = if rust {
                    let mut o: &mut [u8] = &mut out;
                    r.compress_stream(bun_brotli::EncoderOperation::from_raw(op as u32).unwrap(), &mut rest, &mut o).unwrap();
                    (2 << 20) - o.len()
                } else {
                    let (ok, used, made) = c.stream(op, rest, &mut out);
                    assert!(ok);
                    rest = &rest[used..];
                    made
                };
                let mut stream = &out[..made];
                loop {
                    let mut o: &mut [u8] = &mut plain;
                    let result = d.decompress_stream(&mut stream, &mut o);
                    let n = (1 << 20) - o.len();
                    dout.add(&plain[..n]);
                    match result {
                        bun_brotli::DecoderResult::Error => {
                            verdict = Some(format!("does not decode: {:?} after {} bytes", d.error_code(), dout.n));
                            break 'stream;
                        }
                        bun_brotli::DecoderResult::Success => break,
                        bun_brotli::DecoderResult::NeedsMoreInput if !d.has_more_output() => break,
                        _ => {}
                    }
                }
                let more = if rust { r.has_more_output() } else { c.has_more_output() };
                if rest.is_empty() && !more {
                    break;
                }
            }
            if op == 2 {
                verdict = Some(if din.get() == dout.get() { "ok".into() } else { "decodes to something else".into() });
            }
        }
        let verdict = verdict.unwrap();
        println!("{name}: {verdict} ({:.0} s)", start.elapsed().as_secs_f64());
        assert!(!rust || verdict == "ok");
    }
}
