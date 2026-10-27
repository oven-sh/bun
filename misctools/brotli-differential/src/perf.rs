//! Looks for inputs and ways of calling for which the Rust code is much slower than the reference.
use crate::ffi::{CDecoder, CEncoder};
use crate::r#gen;
use crate::rng::Rng;
use bun_brotli::{Decoder, Encoder, EncoderOperation, EncoderParameter};
use std::time::Instant;

fn best(reps: usize, mut f: impl FnMut()) -> f64 {
    (0..reps).map(|_| { let t = Instant::now(); f(); t.elapsed().as_secs_f64() }).fold(f64::MAX, f64::min)
}

fn c_encode(data: &[u8], params: &[(i32, u32)], chunk: usize, flush: bool, buf: &mut [u8]) -> Vec<u8> {
    let mut e = CEncoder::new();
    for &(k, v) in params {
        e.set(k, v);
    }
    let mut out = Vec::new();
    let mut pieces = data.chunks(chunk.max(1)).peekable();
    loop {
        let mut piece = pieces.next().unwrap_or(&[]);
        let op = if pieces.peek().is_none() { 2 } else { i32::from(flush) };
        loop {
            let (ok, used, made) = e.stream(op, piece, buf);
            assert!(ok);
            piece = &piece[used..];
            out.extend_from_slice(&buf[..made]);
            if piece.is_empty() && !e.has_more_output() {
                break;
            }
        }
        if op == 2 {
            return out;
        }
    }
}

fn r_encode(data: &[u8], params: &[(i32, u32)], chunk: usize, flush: bool, buf: &mut [u8]) -> Vec<u8> {
    let mut e = Encoder::new();
    for &(k, v) in params {
        e.set_parameter(EncoderParameter::from_raw(k as u32).unwrap(), v);
    }
    let mut out = Vec::new();
    let mut pieces = data.chunks(chunk.max(1)).peekable();
    loop {
        let mut piece = pieces.next().unwrap_or(&[]);
        let op = if pieces.peek().is_none() { EncoderOperation::Finish } else if flush { EncoderOperation::Flush } else { EncoderOperation::Process };
        loop {
            let cap = buf.len();
            let mut o: &mut [u8] = buf;
            assert!(e.compress_stream(op, &mut piece, &mut o));
            let made = cap - o.len();
            out.extend_from_slice(&buf[..made]);
            if piece.is_empty() && !e.has_more_output() {
                break;
            }
        }
        if op == EncoderOperation::Finish {
            return out;
        }
    }
}

fn c_decode(stream: &[u8], n_in: usize, buf: &mut [u8]) -> usize {
    let mut d = CDecoder::new();
    d.set(1, 1);
    let (mut pos, mut total) = (0usize, 0usize);
    loop {
        let end = pos.saturating_add(n_in).min(stream.len());
        let (r, used, made) = d.stream(&stream[pos..end], buf);
        pos += used;
        total += made;
        if r == 1 {
            return total;
        }
        assert!(r != 0);
    }
}

fn r_decode(stream: &[u8], n_in: usize, buf: &mut [u8]) -> usize {
    let mut d = Decoder::new();
    d.set_parameter(bun_brotli::DecoderParameter::LargeWindow, 1);
    let (mut pos, mut total) = (0usize, 0usize);
    loop {
        let end = pos.saturating_add(n_in).min(stream.len());
        let mut input = &stream[pos..end];
        let cap = buf.len();
        let mut o: &mut [u8] = buf;
        let r = d.decompress_stream(&mut input, &mut o);
        pos = end - input.len();
        total += cap - o.len();
        match r {
            bun_brotli::DecoderResult::Success => return total,
            bun_brotli::DecoderResult::Error => panic!(),
            _ => {}
        }
    }
}

pub fn run(seed0: u64, iters: u64, max_len: usize, corpus: &r#gen::Corpus) {
    // (Rust time / C time, C seconds, what)
    let mut rows: Vec<(f64, f64, String)> = Vec::new();
    for it in 0..iters {
        let seed = seed0 + it;
        let mut rng = Rng(seed);
        let q = rng.below(12) as u32;
        let len = r#gen::length(&mut rng, if q >= 10 { max_len.min(1 << 17) } else { max_len }).max(1);
        let data = match rng.below(4) {
            0 => crate::ring::records(&mut rng, len),
            _ => r#gen::data(&mut rng, corpus, len),
        };
        let mut params = vec![(1, q)];
        if rng.chance(1, 2) {
            params.push((2, rng.range(10, 24) as u32));
        }
        if rng.chance(1, 8) {
            params.push((6, 1));
            params.push((2, rng.range(25, 30) as u32));
        }
        let chunk = *rng.pick(&[usize::MAX, usize::MAX, 1 << 16, 4096, 100, 7, 1]);
        let flush = chunk != usize::MAX && rng.chance(1, 3);
        // Many small pieces of a long input take too long.
        let data = if chunk < 4096 { &data[..len.min(if flush { 20_000 } else { 200_000 })] } else { &data[..] };
        let cap = *rng.pick(&[1 << 20, 1 << 16, 1 << 12, 64]);
        let mut buf = vec![0u8; cap];
        let stream = c_encode(data, &params, chunk, flush, &mut buf);
        assert!(stream == r_encode(data, &params, chunk, flush, &mut buf), "seed {seed}");
        let c = best(3, || { c_encode(data, &params, chunk, flush, &mut buf); });
        let r = best(3, || { r_encode(data, &params, chunk, flush, &mut buf); });
        rows.push((r / c, c, format!("seed {seed} ENC len {} params {params:?} chunk {chunk} flush {flush} cap {cap}", data.len())));
        let n_in = *rng.pick(&[usize::MAX, usize::MAX, 4096, 64, 1]);
        let dcap = *rng.pick(&[1 << 20, 1 << 16, 4096, 64, 1]);
        if (dcap < 64 || n_in < 64) && data.len() > 300_000 {
            continue;
        }
        let mut buf = vec![0u8; dcap];
        assert!(r_decode(&stream, n_in, &mut buf) == data.len());
        let c = best(3, || { c_decode(&stream, n_in, &mut buf); });
        let r = best(3, || { r_decode(&stream, n_in, &mut buf); });
        rows.push((r / c, c, format!("seed {seed} DEC len {} stream {} q{q} n_in {n_in} cap {dcap}", data.len(), stream.len())));
    }
    for kind in ["ENC", "DEC"] {
        let mut v: Vec<&(f64, f64, String)> = rows.iter().filter(|r| r.2.contains(kind)).collect();
        v.sort_by(|a, b| b.0.total_cmp(&a.0));
        let median = v[v.len() / 2].0;
        println!("{kind}: {} cases, Rust time / C time: median {median:.2}, 90th percentile {:.2}, worst:", v.len(), v[v.len() / 10].0);
        for r in v.iter().take(12) {
            println!("  {:.2}x  (C {:.3} ms)  {}", r.0, r.1 * 1e3, r.2);
        }
    }
}
