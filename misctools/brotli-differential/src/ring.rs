//! The encoder's ring buffer: inputs whose length, and pieces whose ends, are near the sizes that matter to it.
use crate::enc::{self, EncCase, Step};
use crate::r#gen;
use crate::rng::Rng;

/// Data with matches at distances near `near`.
fn data(rng: &mut Rng, corpus: &r#gen::Corpus, len: usize, near: &[usize]) -> Vec<u8> {
    let mut out = Vec::with_capacity(len);
    let kind = rng.below(8);
    if kind == 0 {
        return r#gen::data(rng, corpus, len);
    }
    if kind == 2 {
        return records(rng, len);
    }
    let base = *rng.pick(near);
    let period = match rng.below(4) {
        0 => base,
        1 => base.saturating_sub(rng.below(40)),
        2 => base + rng.below(40),
        _ => (base / 2).max(1) + rng.below(5),
    }
    .clamp(1, len.max(1));
    // What is repeated.
    let block = match rng.below(4) {
        0 => (0..period).map(|_| rng.next() as u8).collect::<Vec<u8>>(),
        1 => (0..period).map(|_| b'a' + rng.below(4) as u8).collect(),
        _ => r#gen::data(rng, corpus, period),
    };
    // How often a byte is changed, so that matches end.
    let noise = match rng.below(4) {
        0 => 0,
        1 => 4000,
        2 => 300,
        _ => 40,
    };
    while out.len() < len {
        let n = block.len().min(len - out.len());
        out.extend_from_slice(&block[..n]);
    }
    if noise != 0 {
        let mut i = rng.below(noise);
        while i < len {
            out[i] ^= 1 << rng.below(8);
            i += 1 + rng.below(2 * noise);
        }
    }
    if kind == 1 && len > 0 {
        // A long run.
        let start = rng.below(len);
        let n = rng.below(len - start + 1);
        let b = rng.next() as u8;
        out[start..start + n].fill(b);
    }
    out
}

/// The same few bytes over and over, each time followed by something else. That adds position after position to one
/// bucket of a hasher, whose counter has 16 bits. Runs and short periods do not: the encoder skips most of a long copy.
pub fn records(rng: &mut Rng, len: usize) -> Vec<u8> {
    let markers: Vec<Vec<u8>> = (0..rng.range(1, 3)).map(|_| (0..rng.range(4, 9)).map(|_| rng.next() as u8).collect()).collect();
    let (lo, hi) = *rng.pick(&[(1, 1), (1, 2), (1, 4), (2, 3), (3, 8)]);
    let alphabet = *rng.pick(&[256, 256, 16, 3]);
    let mut out = Vec::with_capacity(len + 32);
    while out.len() < len {
        out.extend_from_slice(if rng.chance(7, 8) { &markers[0] } else { rng.pick(&markers) });
        for _ in 0..rng.range(lo, hi) {
            out.push(rng.below(alphabet) as u8);
        }
    }
    out.truncate(len);
    out
}

fn near(rng: &mut Rng, base: usize) -> usize {
    let d = match rng.below(4) {
        0 => 0,
        1 | 2 => rng.below(10),
        _ => rng.below(300),
    };
    if rng.chance(1, 2) { base + d } else { base.saturating_sub(d) }
}

pub fn run(seed0: u64, iters: u64, max_len: usize, qualities: u64, corpus: &r#gen::Corpus) {
    let qs: Vec<u32> = (2..12).filter(|q| qualities >> q & 1 != 0).collect();
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let max_len = if q >= 10 { max_len.min(3 << 19) } else { max_len };
        // The ring buffer has to be small enough to be filled.
        let (lgwin, lgblock, size, tail) = loop {
            let lgwin = if rng.chance(3, 4) { rng.range(10, 18) } else { rng.range(10, 24) };
            let lgblock = match rng.below(4) {
                0 | 1 => 0,
                2 => rng.range(16, 18),
                _ => rng.range(16, 24),
            };
            let effective = if q < 4 {
                14
            } else if lgblock == 0 {
                if q >= 9 && lgwin > 16 { lgwin.min(18) } else { 16 }
            } else {
                lgblock
            };
            let size = 2usize << lgwin.max(effective);
            if size + 400 <= max_len || rng.chance(1, 16) {
                break (lgwin, lgblock, size, 1usize << effective);
            }
        };
        let window = (1usize << lgwin) - 16;
        let marks = [size, size - tail, size + tail, tail, 2 * tail, 2 * size, 3 * size, 2 * size + tail, window, window + tail, size - 7];
        let len = loop {
            let mark = *rng.pick(&marks);
            let len = near(&mut rng, mark);
            if len <= max_len {
                break len;
            }
        };
        let data = data(&mut rng, corpus, len, &[window, window + 16, size, tail, size - tail, 65536 + 300]);
        let mut params = vec![(1, q), (2, lgwin as u32)];
        if lgblock != 0 {
            params.push((3, lgblock as u32));
        }
        if rng.chance(1, 6) {
            params.push((0, rng.below(3) as u32));
        }
        if rng.chance(1, 4) {
            params.push((5, if rng.chance(1, 2) { len as u32 } else { rng.below(1 << 22) as u32 }));
        }
        let offset = rng.chance(1, 8);
        if offset {
            params.push((9, match rng.below(4) { 0 => rng.range(1, 100), 1 => near(&mut rng, window).max(1), 2 => near(&mut rng, size).max(1), _ => 1 << 30 } as u32));
        }
        let mut dicts = Vec::new();
        if rng.chance(1, 10) {
            for _ in 0..rng.range(1, 3) {
                let n = rng.range(1, 5000).min(len.max(1));
                dicts.push(if len > n && rng.chance(2, 3) { let o = rng.below(len - n); data[o..o + n].to_vec() } else { r#gen::data(&mut rng, corpus, n) });
            }
        }
        for k in 0..3 {
            // Where the pieces end.
            let mut steps = Vec::new();
            let mut pos = 0usize;
            let first = match rng.below(8) {
                0 => rng.range(1, 9),
                1 => tail - 1,
                2 => tail,
                3 => tail + 1,
                4 => rng.range(1, tail),
                5 => near(&mut rng, tail / 2).max(1),
                6 => len,
                _ => rng.range(1, 64),
            };
            let style = rng.below(5);
            let flushes = match rng.below(3) { 0 => 0, 1 => 24, _ => 4 };
            let mut n = first;
            while pos < len && steps.len() < 20000 {
                let n_now = n.min(len - pos).max(1);
                let op = if flushes != 0 && rng.chance(1, flushes) { 1 } else { 0 };
                steps.push(Step { op, n: n_now });
                pos += n_now;
                // The next mark, in this lap of the ring buffer.
                let lap = pos / size * size;
                let next_mark = [size - tail, size - 7 - 8, size, size + tail].iter().map(|m| lap + m).find(|&m| m > pos + 16).unwrap_or(pos + tail);
                let to_mark = next_mark - pos;
                n = match style {
                    0 => tail,
                    1 => rng.range(1, 2 * tail),
                    // In large steps to just before a mark, and in small ones past it.
                    2 => if to_mark > 40 { (to_mark - rng.range(8, 24)).min(if rng.chance(1, 2) { tail } else { usize::MAX }) } else { rng.range(1, 5) },
                    3 => if rng.chance(1, 2) { rng.range(1, 32) } else { rng.range(tail / 2, tail + 2) },
                    _ => near(&mut rng, tail).max(1),
                };
            }
            let case = EncCase { data: data.clone(), params: params.clone(), dicts: dicts.clone(), schedule: if k == 0 { 0 } else { rng.next() | 1 }, misuse: false };
            let fail = |e: String| -> ! {
                let path = format!("{}/brotli-ringfail-{seed}.bin", std::env::temp_dir().display());
                std::fs::write(&path, &data).unwrap();
                let head: Vec<_> = steps.iter().take(12).map(|s| (s.op, s.n)).collect();
                panic!("seed {seed} k={k} schedule {}: {e}\nlen {len} ring {size} tail {tail} params {:?} dicts {:?} steps {} {head:?}\ndata saved to {path}", case.schedule, case.params, case.dicts.iter().map(Vec::len).collect::<Vec<_>>(), steps.len());
            };
            match enc::compare_steps(&case, &steps) {
                Ok(out) => {
                    total_in += len;
                    total_out += out.len();
                    if !offset {
                        if let Err(e) = enc::round_trip(&out, &data, &dicts, false, if k == 0 { 0 } else { rng.next() | 1 }) {
                            fail(e);
                        }
                    }
                }
                Err(e) => fail(e),
            }
        }
        if it % 200 == 199 {
            eprintln!("{} iterations, {total_in} -> {total_out}", it + 1);
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}

/// The hashers of qualities 5 to 9: more than 65536 positions in one bucket.
pub fn run_hash(seed0: u64, iters: u64, max_len: usize, qualities: u64, corpus: &r#gen::Corpus) {
    let qs: Vec<u32> = (2..12).filter(|q| qualities >> q & 1 != 0).collect();
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let len = match rng.below(4) {
            0 => rng.range(300_000, 700_000),
            1 | 2 => rng.range(500_000, 1_500_000),
            _ => rng.range(1_000_000, 4_000_000),
        }
        .min(max_len);
        let mut data = records(&mut rng, len);
        if rng.chance(1, 4) {
            // Something else in between.
            let at = rng.below(len);
            let n = rng.below((len - at).min(100_000) + 1);
            let other = r#gen::data(&mut rng, corpus, n);
            data[at..at + n].copy_from_slice(&other);
        }
        let large = rng.chance(1, 8);
        let lgwin = if large { rng.range(25, 27) } else if rng.chance(1, 6) { rng.range(10, 16) } else { rng.range(17, 24) };
        let mut params = vec![(1, q), (2, lgwin as u32)];
        if large {
            params.insert(0, (6, 1));
        }
        if rng.chance(1, 3) {
            params.push((5, *rng.pick(&[len as u32, 1 << 20, (1 << 20) - 1, 1000, 1 << 24])));
        }
        if rng.chance(1, 6) {
            params.push((3, rng.range(16, 22) as u32));
        }
        let mut dicts = Vec::new();
        if rng.chance(1, 10) {
            let n = rng.range(1, 3000);
            dicts.push(data[..n].to_vec());
        }
        for k in 0..2 {
            let case = EncCase { data: data.clone(), params: params.clone(), dicts: dicts.clone(), schedule: if k == 0 { 0 } else { rng.next() | 1 }, misuse: false };
            let r = enc::compare(&case).and_then(|out| enc::round_trip(&out, &data, &dicts, large, 0).map(|()| out));
            match r {
                Ok(out) => {
                    total_in += len;
                    total_out += out.len();
                }
                Err(e) => {
                    let path = format!("{}/brotli-hashfail-{seed}.bin", std::env::temp_dir().display());
                    std::fs::write(&path, &data).unwrap();
                    panic!("seed {seed} k={k} schedule {}: {e}\nlen {len} params {:?} dicts {:?}\ndata saved to {path}", case.schedule, case.params, case.dicts.iter().map(Vec::len).collect::<Vec<_>>());
                }
            }
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}
