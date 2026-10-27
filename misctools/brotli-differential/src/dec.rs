//! Lock-step comparison of the two decoders.
use crate::ffi::CDecoder;
use crate::rng::Rng;
use bun_brotli::{Decoder, DecoderParameter};

#[derive(Clone, Debug)]
pub struct DecCase {
    pub stream: Vec<u8>,
    pub large_window: bool,
    pub no_realloc: bool,
    pub dicts: Vec<Vec<u8>>,
    /// Seed for the chunk schedule; 0 = all at once with a large output buffer.
    pub schedule: u64,
    pub max_output: usize,
}

pub struct Outcome {
    pub result: i32,
    pub error: i32,
    pub output_len: usize,
    pub calls: usize,
}

/// Runs both decoders with the same calls. Err describes the first difference.
pub fn compare(case: &DecCase, expect: Option<&[u8]>) -> Result<Outcome, String> {
    let mut c = CDecoder::new();
    let mut r = Decoder::new();
    if case.large_window {
        let a = c.set(1, 1);
        let b = r.set_parameter(DecoderParameter::LargeWindow, 1);
        if a != b {
            return Err("set large_window differs".into());
        }
    }
    if case.no_realloc {
        let a = c.set(0, 1);
        let b = r.set_parameter(DecoderParameter::DisableRingBufferReallocation, 1);
        if a != b {
            return Err("set no_realloc differs".into());
        }
    }
    for d in &case.dicts {
        let a = c.attach(d.clone());
        let b = r.attach_dictionary(d.clone().into_boxed_slice());
        if a != b {
            return Err(format!("attach differs c={a} r={b}"));
        }
    }
    let mut rng = Rng(case.schedule);
    let style_in = rng.below(5);
    let style_out = rng.below(5);
    let mut pos = 0usize; // consumed
    let mut total_out = 0usize;
    let mut cbuf = vec![0u8; 1 << 16];
    let mut rbuf = vec![0u8; 1 << 16];
    let mut all_out: Vec<u8> = Vec::new();
    let mut calls = 0usize;
    let mut stalled = 0;
    loop {
        calls += 1;
        let remaining = case.stream.len() - pos;
        let (n_in, n_out) = if case.schedule == 0 {
            (remaining, cbuf.len())
        } else {
            let n_in = match style_in {
                0 => 1,
                1 => rng.range(0, 3),
                2 => rng.range(0, 40),
                3 => rng.range(0, 4096),
                _ => remaining,
            }
            .min(remaining);
            let n_out = match style_out {
                0 => 1,
                1 => rng.range(0, 3),
                2 => rng.range(0, 100),
                3 => rng.range(0, 1 << 16),
                _ => 1 << 16,
            };
            (n_in, n_out)
        };
        let input = &case.stream[pos..pos + n_in];
        let (cr, cused, cmade) = c.stream(input, &mut cbuf[..n_out]);
        let mut rin: &[u8] = input;
        let mut rout: &mut [u8] = &mut rbuf[..n_out];
        let rr = r.decompress_stream(&mut rin, &mut rout) as i32;
        let rmade = n_out - rout.len();
        let rused = n_in - rin.len();
        let ctx = || format!("call {calls} pos {pos} n_in {n_in} n_out {n_out} total_out {total_out}");
        if cr != rr {
            return Err(format!("result differs c={cr} (err {}) r={rr} (err {:?}) at {}", c.error_code(), r.error_code(), ctx()));
        }
        if c.error_code() != r.error_code() as i32 {
            return Err(format!("error code differs c={} r={:?} at {}", c.error_code(), r.error_code(), ctx()));
        }
        if cmade != rmade || cbuf[..cmade] != rbuf[..rmade] {
            return Err(format!("output differs c={cmade} r={rmade} at {}", ctx()));
        }
        // After an error the amount consumed is unspecified, but keep it comparable anyway.
        if cused != rused {
            return Err(format!("consumed differs c={cused} r={rused} result {cr} at {}", ctx()));
        }
        if c.has_more_output() != r.has_more_output() {
            return Err(format!("has_more_output differs c={} at {}", c.has_more_output(), ctx()));
        }
        if c.is_used() != r.is_used() || c.is_finished() != r.is_finished() {
            return Err(format!("is_used/is_finished differs at {}", ctx()));
        }
        pos += cused;
        total_out += cmade;
        if expect.is_some() {
            all_out.extend_from_slice(&cbuf[..cmade]);
        }
        let done = match cr {
            0 | 1 => true,
            2 => pos == case.stream.len() && n_in == remaining,
            _ => false,
        };
        if cused == 0 && cmade == 0 {
            stalled += 1;
        } else {
            stalled = 0;
        }
        if done || total_out > case.max_output || stalled > 64 {
            if let Some(e) = expect {
                if cr == 1 && all_out != e {
                    return Err("decoded data is not the original".into());
                }
            }
            return Ok(Outcome { result: cr, error: c.error_code(), output_len: total_out, calls });
        }
    }
}

/// Damages a stream.
pub fn mutate(rng: &mut Rng, s: &mut Vec<u8>) {
    let n = match rng.below(4) {
        0 => 1,
        1 => rng.range(1, 3),
        2 => rng.range(1, 10),
        _ => rng.range(1, 40),
    };
    for _ in 0..n {
        if s.is_empty() {
            s.push(rng.next() as u8);
            continue;
        }
        // Headers are at the front, so aim there more often.
        let i = if rng.chance(1, 2) { rng.below(s.len().min(64)) } else { rng.below(s.len()) };
        match rng.below(8) {
            0 | 1 | 2 => s[i] ^= 1 << rng.below(8),
            3 => s[i] = rng.next() as u8,
            4 => {
                s.truncate(i);
            }
            5 => s.insert(i, rng.next() as u8),
            6 => {
                s.remove(i);
            }
            _ => {
                let j = rng.below(s.len());
                let len = rng.range(1, 16).min(s.len() - i.max(j));
                for k in 0..len {
                    s[i + k] = s[j + k];
                }
            }
        }
    }
}
