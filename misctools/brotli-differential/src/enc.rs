//! Lock-step comparison of the C encoder and the Rust encoder.
use crate::ffi::CEncoder;
use crate::rng::Rng;
use bun_brotli::{Encoder, EncoderOperation, EncoderParameter, PreparedDictionary};

#[derive(Clone, Debug)]
pub struct EncCase {
    pub data: Vec<u8>,
    pub params: Vec<(i32, u32)>,
    pub dicts: Vec<Vec<u8>>,
    /// 0: everything in one Finish call with a big buffer. Otherwise the seed of the schedule.
    pub schedule: u64,
    /// Whether to also make calls that are out of order.
    pub misuse: bool,
}

fn op_of(op: i32) -> EncoderOperation {
    EncoderOperation::from_raw(op as u32).unwrap()
}

pub struct Pair {
    c: CEncoder,
    r: Encoder,
    pub out: Vec<u8>,
    cbuf: Vec<u8>,
    rbuf: Vec<u8>,
    pub calls: usize,
}

impl Pair {
    pub fn new(case: &EncCase) -> Result<Self, String> {
        let mut c = CEncoder::new();
        let mut r = Encoder::new();
        for &(k, v) in &case.params {
            let a = c.set(k, v);
            let b = match EncoderParameter::from_raw(k as u32) {
                Some(p) => r.set_parameter(p, v),
                None => false,
            };
            if a != b {
                return Err(format!("set_parameter({k}, {v}): C {a}, Rust {b}"));
            }
        }
        for d in &case.dicts {
            let a = c.attach(d.clone());
            let b = match PreparedDictionary::new(d.clone().into_boxed_slice()) {
                Some(p) => r.attach_prepared_dictionary(p),
                None => false,
            };
            if a != b {
                return Err(format!("attach dictionary of {} bytes: C {a}, Rust {b}", d.len()));
            }
        }
        Ok(Self { c, r, out: Vec::new(), cbuf: Vec::new(), rbuf: Vec::new(), calls: 0 })
    }

    /// One call on both. Returns (ok, consumed).
    pub fn step(&mut self, op: i32, input: &[u8], cap: usize) -> Result<(bool, usize), String> {
        self.calls += 1;
        // What neither writes differs. Only what was written is filled again, at the end.
        if self.cbuf.len() < cap {
            self.cbuf.resize(cap, 0x55);
            self.rbuf.resize(cap, 0xAA);
        }
        let (c_ok, c_used, c_made) = self.c.stream(op, input, &mut self.cbuf[..cap]);
        let mut rin = input;
        let mut rout: &mut [u8] = &mut self.rbuf[..cap];
        let r_ok = self.r.compress_stream(op_of(op), &mut rin, &mut rout).is_ok();
        let r_made = cap - rout.len();
        let r_used = input.len() - rin.len();
        let at = format!("call {} (op {op}, in {}, cap {cap}, total out {})", self.calls, input.len(), self.out.len());
        if std::env::var_os("TRACE").is_some() {
            eprintln!("{at}: ok {c_ok}/{r_ok} used {c_used}/{r_used} made {c_made}/{r_made}");
        }
        if c_ok != r_ok {
            return Err(format!("{at}: ok C {c_ok} Rust {r_ok}"));
        }
        if c_used != r_used || c_made != r_made {
            return Err(format!("{at}: consumed C {c_used} Rust {r_used}; produced C {c_made} Rust {r_made}"));
        }
        if self.cbuf[..c_made] != self.rbuf[..r_made] {
            let i = self.cbuf[..c_made].iter().zip(&self.rbuf[..r_made]).position(|(a, b)| a != b).unwrap();
            return Err(format!(
                "{at}: output differs at byte {} of the stream (byte {i} of {c_made} in this call): C {:02x} Rust {:02x}",
                self.out.len() + i,
                self.cbuf[i],
                self.rbuf[i]
            ));
        }
        let (cm, rm) = (self.c.has_more_output(), self.r.has_more_output());
        let (cf, rf) = (self.c.is_finished(), self.r.is_finished());
        if cm != rm || cf != rf {
            return Err(format!("{at}: has_more_output C {cm} Rust {rm}; is_finished C {cf} Rust {rf}"));
        }
        self.out.extend_from_slice(&self.cbuf[..c_made]);
        self.cbuf[..c_made].fill(0x55);
        self.rbuf[..r_made].fill(0xAA);
        Ok((c_ok, c_used))
    }

    /// At any time.
    pub fn set(&mut self, k: i32, v: u32) -> Result<bool, String> {
        let a = self.c.set(k, v);
        let b = EncoderParameter::from_raw(k as u32).is_some_and(|p| self.r.set_parameter(p, v));
        if a != b {
            return Err(format!("set_parameter({k}, {v}) after {} calls: C {a}, Rust {b}", self.calls));
        }
        Ok(a)
    }

    /// At any time.
    pub fn attach(&mut self, d: &[u8]) -> Result<bool, String> {
        let a = self.c.attach(d.to_vec());
        let b = PreparedDictionary::new(d.into()).is_some_and(|p| self.r.attach_prepared_dictionary(p));
        if a != b {
            return Err(format!("attach dictionary of {} bytes after {} calls: C {a}, Rust {b}", d.len(), self.calls));
        }
        Ok(a)
    }

    pub fn has_more_output(&mut self) -> bool {
        self.c.has_more_output()
    }
    pub fn is_finished(&mut self) -> bool {
        self.c.is_finished()
    }
}

fn cap_for(rng: &mut Rng) -> usize {
    match rng.below(8) {
        0 => 0,
        1 => 1,
        2 => rng.range(1, 16),
        3 => rng.range(1, 600),
        4 | 5 => rng.range(1, 1 << 16),
        _ => 1 << 22,
    }
}

/// Runs `op` to completion with `input`.
pub fn run_op(p: &mut Pair, rng: &mut Rng, op: i32, mut input: &[u8], big: bool) -> Result<bool, String> {
    let mut idle = 0;
    loop {
        let cap = if big { (input.len() * 2 + 1024).max(1 << 16) } else { cap_for(rng) };
        let before = p.out.len();
        let (ok, used) = p.step(op, input, cap)?;
        if !ok {
            return Ok(false);
        }
        input = &input[used..];
        if input.is_empty() && !p.has_more_output() {
            return Ok(true);
        }
        if used == 0 && p.out.len() == before {
            idle += 1;
            if idle > 64 && cap > 0 {
                return Err(format!("no progress (op {op}, {} bytes of input left)", input.len()));
            }
        } else {
            idle = 0;
        }
    }
}

/// Returns the stream.
pub fn compare(case: &EncCase) -> Result<Vec<u8>, String> {
    let mut p = Pair::new(case)?;
    if case.schedule == 0 {
        run_op(&mut p, &mut Rng(0), 2, &case.data, true)?;
        return Ok(p.out);
    }
    let mut rng = Rng(case.schedule);
    let style = rng.below(4);
    let mut rest: &[u8] = &case.data;
    while !rest.is_empty() {
        let n = match style {
            0 => rng.range(1, 64),
            1 => rng.range(1, 1 << 12),
            2 => rng.range(1, 1 << 17),
            _ => match rng.below(4) {
                0 => rng.range(1, 8),
                1 => rng.range(1, 1 << 10),
                2 => rng.range(1, 1 << 16),
                _ => rng.range(1, 1 << 21),
            },
        }
        .min(rest.len());
        let (chunk, tail) = rest.split_at(n);
        let op = match rng.below(24) {
            0 | 1 => 1,
            _ => 0,
        };
        if !run_op(&mut p, &mut rng, op, chunk, false)? {
            return Ok(p.out);
        }
        rest = tail;
        if rng.chance(1, 40) {
            let n = match rng.below(4) {
                0 => 0,
                1 => rng.range(1, 16),
                2 => rng.range(1, 40),
                _ => rng.range(1, 70000),
            };
            let meta: Vec<u8> = (0..n).map(|_| rng.next() as u8).collect();
            if !run_op(&mut p, &mut rng, 3, &meta, false)? {
                return Ok(p.out);
            }
        }
        if rng.chance(1, 60) {
            // A flush without input.
            if !run_op(&mut p, &mut rng, 1, &[], false)? {
                return Ok(p.out);
            }
        }
        if case.misuse && rng.chance(1, 30) {
            // Calls that do not wait for the previous operation to complete.
            for _ in 0..rng.range(1, 6) {
                let op = rng.below(4) as i32;
                let n = rng.below(40).min(rest.len());
                let cap = cap_for(&mut rng);
                let (_, used) = p.step(op, &rest[..n], cap)?;
                rest = &rest[used..];
            }
        }
    }
    run_op(&mut p, &mut rng, 2, &[], false)?;
    if case.misuse {
        for _ in 0..3 {
            let op = rng.below(4) as i32;
            let n = rng.below(3);
            let cap = cap_for(&mut rng);
            p.step(op, &[1, 2, 3][..n], cap)?;
        }
    }
    Ok(p.out)
}

/// The one-shot API.
pub fn compare_one_shot(quality: i32, lgwin: i32, mode: i32, data: &[u8], cap: usize) -> Result<(), String> {
    let mut cbuf = vec![0u8; cap];
    let mut rbuf = vec![0u8; cap];
    let mut n = cap;
    let ok = unsafe { crate::ffi::BrotliEncoderCompress(quality, lgwin, mode, data.len(), data.as_ptr(), &mut n, cbuf.as_mut_ptr()) } != 0;
    let m = bun_brotli::EncoderMode::from_raw(mode as u32).unwrap();
    let r = bun_brotli::compress(quality, lgwin, m, data, &mut rbuf);
    let c = ok.then_some(n);
    if c != r {
        return Err(format!("one-shot q{quality} w{lgwin} m{mode} len {} cap {cap}: C {c:?} Rust {r:?}", data.len()));
    }
    if let Some(n) = c {
        if cbuf[..n] != rbuf[..n] {
            return Err(format!("one-shot q{quality} w{lgwin} m{mode} len {} cap {cap}: bytes differ", data.len()));
        }
    }
    let mut v = Vec::with_capacity(cap + 3);
    v.extend_from_slice(b"abc");
    // The capacity may be larger than asked for, so only compare when it is exact.
    if v.capacity() == cap + 3 {
        let r2 = bun_brotli::compress_append(quality, lgwin, m, data, &mut v);
        if r2 != c || (c.is_some() && v[3..] != cbuf[..n]) || &v[..3] != b"abc" {
            return Err(format!("compress_append q{quality} w{lgwin} m{mode} len {} cap {cap}: C {c:?} Rust {r2:?}", data.len()));
        }
    }
    let (a, b) = (unsafe { crate::ffi::BrotliEncoderMaxCompressedSize(data.len()) }, bun_brotli::max_compressed_size(data.len()).unwrap_or(0));
    if a != b {
        return Err(format!("max_compressed_size({}): C {a} Rust {b}", data.len()));
    }
    Ok(())
}

/// One piece of the input and what to do with it.
#[derive(Clone, Copy, Debug)]
pub struct Step {
    pub op: i32,
    pub n: usize,
}

/// Like [`compare`], with the input cut as `steps` says. What is left after them goes into the final Finish.
pub fn compare_steps(case: &EncCase, steps: &[Step]) -> Result<Vec<u8>, String> {
    let mut p = Pair::new(case)?;
    let mut rng = Rng(case.schedule);
    let big = case.schedule == 0;
    let mut rest: &[u8] = &case.data;
    for s in steps {
        let (chunk, tail) = rest.split_at(s.n.min(rest.len()));
        if !run_op(&mut p, &mut rng, s.op, chunk, big)? {
            return Ok(p.out);
        }
        rest = tail;
    }
    run_op(&mut p, &mut rng, 2, rest, big)?;
    Ok(p.out)
}

/// Decodes `stream` with both decoders, in lock step, and expects `data`.
pub fn round_trip(stream: &[u8], data: &[u8], dicts: &[Vec<u8>], large_window: bool, schedule: u64) -> Result<(), String> {
    let case = crate::dec::DecCase {
        stream: stream.to_vec(),
        large_window,
        no_realloc: false,
        dicts: dicts.to_vec(),
        schedule,
        max_output: usize::MAX,
    };
    let o = crate::dec::compare(&case, Some(data)).map_err(|e| format!("round trip: {e}"))?;
    if o.result != 1 {
        return Err(format!("round trip: result {} error {}", o.result, o.error));
    }
    Ok(())
}
