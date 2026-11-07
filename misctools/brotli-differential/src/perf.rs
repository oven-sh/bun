//! Looks for inputs and ways of calling for which the Rust code is much slower than the reference.
use crate::ffi::{CDecoder, CEncoder};
use crate::r#gen;
use crate::rng::Rng;
use bun_brotli::{Decoder, Encoder, EncoderOperation, EncoderParameter};
use std::time::Instant;

/// Seconds for one call: the best of `reps` measurements, each of as many calls as take about 300 microseconds.
fn best(reps: usize, mut f: impl FnMut()) -> f64 {
    let t = Instant::now();
    f();
    let calls = (3e-4 / t.elapsed().as_secs_f64().max(1e-9)).clamp(1.0, 3000.0) as u32;
    (0..reps)
        .map(|_| {
            let t = Instant::now();
            for _ in 0..calls {
                f();
            }
            t.elapsed().as_secs_f64() / f64::from(calls)
        })
        .fold(f64::MAX, f64::min)
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
        assert!(e.set_parameter(EncoderParameter::from_raw(k as u32).unwrap(), v));
    }
    let mut out = Vec::new();
    let mut pieces = data.chunks(chunk.max(1)).peekable();
    loop {
        let mut piece = pieces.next().unwrap_or(&[]);
        let op = if pieces.peek().is_none() { EncoderOperation::Finish } else if flush { EncoderOperation::Flush } else { EncoderOperation::Process };
        loop {
            let cap = buf.len();
            let mut o: &mut [u8] = buf;
            e.compress_stream(op, &mut piece, &mut o).unwrap();
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
        let len = match rng.below(4) {
            0 => rng.range(1, 300),
            1 => rng.range(1, 8000),
            _ => r#gen::length(&mut rng, if q >= 10 { max_len.min(1 << 17) } else { max_len }).max(1),
        };
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
        // Below quality 5 the reference can read memory that it never wrote, which is not zeroed here.
        assert!(q < 5 || stream == r_encode(data, &params, chunk, flush, &mut buf), "seed {seed}");
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
    if std::env::var_os("ALL").is_some() {
        for r in &rows {
            println!("ROW\t{:.3}\t{:.3e}\t{}", r.0, r.1, r.2);
        }
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

/// (bytes held after the last flush, most bytes at a time, allocations)
type Memory = (usize, usize, usize);

fn c_memory(f: impl FnOnce(&mut dyn FnMut())) -> Memory {
    *crate::ffi::METER.lock().unwrap() = Some(Default::default());
    let mut idle = 0;
    f(&mut || idle = crate::ffi::METER.lock().unwrap().as_ref().unwrap().live);
    let m = crate::ffi::METER.lock().unwrap().take().unwrap();
    assert!(m.live == 0, "the reference leaks {}", m.live);
    (idle, m.peak, m.count)
}

/// How much memory the two need: the encoders for `data`, given in pieces of `chunk` bytes, and the decoders for the result.
fn memory(data: &[u8], params: &[(i32, u32)], chunk: usize, flush: bool) -> [(Memory, Memory); 2] {
    use crate::oom::{meter_read, meter_reset, metered};
    let mut buf = vec![0u8; 1 << 16];
    let mut stream = Vec::with_capacity(data.len() + data.len() / 2 + 4096);
    let c_enc = c_memory(|idle| {
        let mut e = CEncoder::new();
        for &(k, v) in params {
            e.set(k, v);
        }
        let mut pieces = data.chunks(chunk.max(1)).peekable();
        loop {
            let mut piece = pieces.next().unwrap_or(&[]);
            let op = if pieces.peek().is_none() { 2 } else { i32::from(flush) };
            if op == 2 {
                idle();
            }
            loop {
                let (ok, used, made) = e.stream(op, piece, &mut buf);
                assert!(ok);
                piece = &piece[used..];
                stream.extend_from_slice(&buf[..made]);
                if piece.is_empty() && !e.has_more_output() {
                    break;
                }
            }
            if op == 2 {
                break;
            }
        }
    });
    meter_reset();
    let mut idle = 0;
    {
        let mut e = metered(|| Box::new(Encoder::new()));
        for &(k, v) in params {
            assert!(metered(|| e.set_parameter(EncoderParameter::from_raw(k as u32).unwrap(), v)));
        }
        let mut pieces = data.chunks(chunk.max(1)).peekable();
        let mut pos = 0;
        loop {
            let mut piece = pieces.next().unwrap_or(&[]);
            let op = if pieces.peek().is_none() { EncoderOperation::Finish } else if flush { EncoderOperation::Flush } else { EncoderOperation::Process };
            if op == EncoderOperation::Finish {
                idle = meter_read().0;
            }
            loop {
                let cap = buf.len();
                let mut o: &mut [u8] = &mut buf;
                metered(|| e.compress_stream(op, &mut piece, &mut o)).unwrap();
                let made = cap - o.len();
                assert!(stream[pos..pos + made] == buf[..made]);
                pos += made;
                if piece.is_empty() && !e.has_more_output() {
                    break;
                }
            }
            if op == EncoderOperation::Finish {
                break;
            }
        }
        metered(|| drop(e));
    }
    let (live, peak, count) = meter_read();
    if live != 0 {
        println!("# kept for good after an encoder with {params:?} and {} bytes: {live} bytes", data.len());
    }
    let r_enc = (idle, peak, count);

    // The decoders get the stream in pieces of 4096 bytes. "Idle" is before the last of them.
    let last = stream.len().saturating_sub(1) / 4096 * 4096;
    let c_dec = c_memory(|idle| {
        let mut d = CDecoder::new();
        d.set(1, 1);
        let mut pos = 0;
        loop {
            if pos == last {
                idle();
            }
            let end = (pos / 4096 * 4096 + 4096).min(stream.len());
            let (r, used, _) = d.stream(&stream[pos..end], &mut buf);
            pos += used;
            if r == 1 {
                break;
            }
            assert!(r != 0);
        }
    });
    meter_reset();
    let mut idle = 0;
    {
        let mut d = metered(|| Box::new(Decoder::new()));
        d.set_parameter(bun_brotli::DecoderParameter::LargeWindow, 1);
        let mut pos = 0;
        loop {
            if pos == last {
                idle = meter_read().0;
            }
            let end = (pos / 4096 * 4096 + 4096).min(stream.len());
            let mut input = &stream[pos..end];
            let mut o: &mut [u8] = &mut buf;
            let r = metered(|| d.decompress_stream(&mut input, &mut o));
            pos = end - input.len();
            match r {
                bun_brotli::DecoderResult::Success => break,
                bun_brotli::DecoderResult::Error => panic!(),
                _ => {}
            }
        }
        metered(|| drop(d));
    }
    let (live, peak, count) = meter_read();
    if live != 0 {
        println!("# kept for good after a decoder: {live} bytes");
    }
    [(c_enc, r_enc), (c_dec, (idle, peak, count))]
}

/// A grid of qualities, windows, lengths, kinds of data and ways of calling.
pub fn run_memory(qualities: u64, max_len: usize, corpus: &r#gen::Corpus) {
    let qs = crate::args::qualities(qualities, 0..12);
    println!("kind\tquality\tlgwin\tlength\tdata\tchunk\tflush\tC peak\tRust peak\tratio\tC idle\tRust idle\tC allocations\tRust allocations");
    let mut worst = [(0f64, String::new()), (0f64, String::new())];
    for &q in &qs {
        for lgwin in [10u32, 16, 18, 22, 24, 27, 30] {
            for len in [0usize, 1, 100, 5_000, 70_000, 300_000, 1_500_000, 9_000_000, 40_000_000] {
                if len > max_len || (q >= 10 && len > 9_000_000) {
                    continue;
                }
                for kind in ["mixed", "records", "random", "zeros"] {
                    let mut rng = Rng(len as u64 + 1);
                    let data = match kind {
                        "mixed" => r#gen::data(&mut rng, corpus, len),
                        "records" => crate::ring::records(&mut rng, len),
                        "random" => (0..len).map(|_| rng.next() as u8).collect(),
                        _ => vec![0u8; len],
                    };
                    for (chunk, flush) in [(usize::MAX, false), (1 << 16, false), (1000, false), (1000, true)] {
                        if chunk == 1000 && len > 1_500_000 || chunk < len.max(1) && len < 5_000 {
                            continue;
                        }
                        let mut params = vec![(1, q), (2, lgwin)];
                        if lgwin > 24 {
                            params.insert(0, (6, 1));
                        }
                        for (i, (c, r)) in memory(&data, &params, chunk, flush).into_iter().enumerate() {
                            let ratio = r.1 as f64 / c.1 as f64;
                            let row = format!("{}\t{q}\t{lgwin}\t{len}\t{kind}\t{chunk}\t{flush}\t{}\t{}\t{ratio:.3}\t{}\t{}\t{}\t{}", ["ENC", "DEC"][i], c.1, r.1, c.0, r.0, c.2, r.2);
                            println!("{row}");
                            if ratio > worst[i].0 {
                                worst[i] = (ratio, row);
                            }
                        }
                    }
                }
            }
        }
    }
    println!("worst:\n{}\n{}", worst[0].1, worst[1].1);
}
