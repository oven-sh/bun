//! The encoder's ring buffer: inputs whose length, and pieces whose ends, are near the sizes that matter to it.
use crate::args;
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
    let qs = args::qualities(qualities, 2..12);
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
        // All the marks can be past `max_len`.
        let mut len = None;
        for _ in 0..50 {
            let mark = *rng.pick(&marks);
            let n = near(&mut rng, mark);
            if n <= max_len {
                len = Some(n);
                break;
            }
        }
        let len = len.unwrap_or_else(|| rng.below(max_len + 1));
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
    let qs = args::qualities(qualities, 2..12);
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

/// The byte after the end of the input. Below quality 5, when a match runs to the end of what is there, the search at the
/// next position looks at it. If a block that started before the end of the ring buffer ends after it, that byte is in
/// the tail: 241, or zero, or a copy of the first lap, depending on how long the first write was.
pub fn run_tail(seed0: u64, iters: u64, qualities: u64, corpus: &r#gen::Corpus) {
    let qs = args::qualities(qualities, 2..12);
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let lgwin = rng.range(10, 16);
        let lgblock = if q >= 4 && rng.chance(1, 4) { rng.range(16, 17) } else { 0 };
        let effective = if q < 4 { 14 } else if lgblock == 0 { 16 } else { lgblock };
        let size = 2usize << lgwin.max(effective);
        let tail = 1usize << effective;
        let first = match rng.below(4) {
            0 => rng.range(1, 40),
            1 => rng.range(1, 3000),
            2 => tail - rng.range(1, 40),
            _ => rng.range(1, tail - 1),
        };
        // How far into the second lap the block ends.
        let over = match rng.below(8) {
            0 => 0,
            1 => rng.range(0, 3),
            2 | 3 => near(&mut rng, first),
            4 => rng.below(first + 1),
            _ => rng.below(tail / 2),
        }
        .min(tail - 2);
        // The block starts after a flush at a place that is not a multiple of the block size.
        let most = if rng.chance(1, 2) { 600 } else { tail };
        let before = rng.range(1, (tail - over - 1).min(most));
        let start = size - before;
        let len = size + over + if rng.chance(1, 2) { 0 } else { rng.below(3000) };
        // Matches have to run to the end of the block.
        let mut data = match rng.below(4) {
            0 => vec![0u8; len],
            1 => {
                let period = rng.range(1, 300);
                let pat = r#gen::data(&mut rng, corpus, period);
                (0..len).map(|i| pat[i % period]).collect()
            }
            2 => {
                let period = rng.range(4, 40);
                let pat: Vec<u8> = (0..period).map(|_| rng.below(3) as u8).collect();
                (0..len).map(|i| pat[i % period]).collect()
            }
            _ => {
                let b = rng.next() as u8;
                vec![b; len]
            }
        };
        let noise = *rng.pick(&[0, 40, 300, 3000]);
        if noise != 0 {
            let mut i = rng.below(noise);
            while i < len {
                // Not in the last part of the block.
                if i + rng.range(8, 400) < size + over || i >= size + over {
                    data[i] = rng.next() as u8;
                }
                i += 1 + rng.below(2 * noise);
            }
        }
        let mut params = vec![(1, q), (2, lgwin as u32)];
        if lgblock != 0 {
            params.push((3, lgblock as u32));
        }
        let mut dicts = Vec::new();
        if rng.chance(1, 6) {
            let n = rng.range(1, 300).min(len);
            dicts.push(data[..n].to_vec());
        }
        let mut steps = vec![Step { op: 0, n: first.min(start) }];
        let mut pos = first.min(start);
        while pos < start {
            let n = rng.range(1, tail).min(start - pos);
            pos += n;
            steps.push(Step { op: i32::from(pos == start || rng.chance(1, 10)), n });
        }
        // The block, in one piece or in several.
        let end = size + over;
        while pos < end {
            let n = if rng.chance(1, 2) { end - pos } else { rng.range(1, end - pos) };
            pos += n;
            steps.push(Step { op: if pos == end { 1 } else { 0 }, n });
        }
        let case = EncCase { data: data.clone(), params, dicts: dicts.clone(), schedule: if rng.chance(1, 2) { 0 } else { rng.next() | 1 }, misuse: false };
        match enc::compare_steps(&case, &steps).and_then(|out| enc::round_trip(&out, &data, &dicts, false, 0).map(|()| out)) {
            Ok(out) => {
                total_in += len;
                total_out += out.len();
            }
            Err(e) => {
                let path = format!("{}/brotli-tailfail-{seed}.bin", std::env::temp_dir().display());
                std::fs::write(&path, &data).unwrap();
                panic!("seed {seed} schedule {}: {e}\nlen {len} ring {size} tail {tail} first {first} block {start}..{end} params {:?} dicts {:?}\ndata saved to {path}", case.schedule, case.params, case.dicts.iter().map(Vec::len).collect::<Vec<_>>());
            }
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}

/// Input lengths, ends of pieces and flushes near the given positions, for thresholds inside the encoder (like the
/// amount of input after which a hasher changes its storage).
pub fn run_marks(seed0: u64, iters: u64, qualities: u64, marks: &[usize], corpus: &r#gen::Corpus) {
    let qs = args::qualities(qualities, 0..12);
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let mark = *rng.pick(marks);
        let len = match rng.below(6) {
            0 => near(&mut rng, mark),
            1 => mark + rng.below(2000),
            2 => near(&mut rng, 2 * mark),
            3 => mark + rng.below(mark + 1),
            4 => rng.range(mark / 2, 4 * mark),
            _ => near(&mut rng, mark + 65536),
        };
        let data = match rng.below(5) {
            0 => records(&mut rng, len),
            1 => data(&mut rng, corpus, len, &[mark, mark / 2, mark / 4, 1000]),
            _ => r#gen::data(&mut rng, corpus, len),
        };
        let mut params = vec![(1, q)];
        if rng.chance(2, 3) {
            params.push((2, if rng.chance(3, 4) { rng.range(17, 24) } else { rng.range(10, 16) } as u32));
        }
        if rng.chance(1, 4) {
            params.push((5, *rng.pick(&[len as u32, mark as u32, 1 << 20, (1 << 20) - 1, 100])));
        }
        if rng.chance(1, 8) {
            params.push((3, rng.range(16, 20) as u32));
        }
        if rng.chance(1, 10) {
            params.push((6, 1));
            params.push((2, rng.range(17, 27) as u32));
        }
        let large = params.iter().any(|&(k, _)| k == 6);
        let offset = rng.chance(1, 10);
        if offset {
            params.push((9, *rng.pick(&[1, 77, mark as u32 - 1, mark as u32, mark as u32 + 1, 1 << 30])));
        }
        let mut dicts = Vec::new();
        if rng.chance(1, 6) {
            for _ in 0..rng.range(1, 2) {
                let n = rng.range(1, 4000).min(len.max(1));
                dicts.push(if len > n && rng.chance(2, 3) { let o = rng.below(len - n); data[o..o + n].to_vec() } else { r#gen::data(&mut rng, corpus, n) });
            }
        }
        for k in 0..3 {
            let mut steps = Vec::new();
            let mut pos = 0usize;
            let style = if k == 0 { 0 } else { rng.range(1, 6) };
            while pos < len && style != 0 && steps.len() < 30000 {
                let next = marks.iter().copied().filter(|&m| m + 12 > pos).min().unwrap_or(usize::MAX);
                let to_mark = next.saturating_sub(pos);
                let close = to_mark < 40 || pos.abs_diff(next) < 12;
                let n = match style {
                    1 => if close { rng.range(1, 4) } else { (to_mark - rng.range(1, 30)).min(rng.range(1, 1 << 16)) },
                    2 => rng.range(1, 300),
                    3 => if to_mark > 0 && to_mark != usize::MAX && rng.chance(2, 3) { to_mark } else { rng.range(1, 70000) },
                    4 => rng.range(1, 9000),
                    // The pieces themselves are about as long as a mark: qualities 0 and 1 compress each on its own.
                    6 => {
                        let m = *rng.pick(marks);
                        near(&mut rng, m).max(1)
                    }
                    _ => if close { 1 } else { rng.range(1, to_mark.min(1 << 15).max(2)) },
                }
                .min(len - pos)
                .max(1);
                pos += n;
                let flush = if pos.abs_diff(next) < 12 { rng.chance(1, 3) } else { rng.chance(1, 40) };
                steps.push(Step { op: i32::from(flush), n });
            }
            let case = EncCase { data: data.clone(), params: params.clone(), dicts: dicts.clone(), schedule: if k == 0 || rng.chance(1, 2) { 0 } else { rng.next() | 1 }, misuse: false };
            match enc::compare_steps(&case, &steps).and_then(|out| if offset { Ok(out) } else { enc::round_trip(&out, &data, &dicts, large, 0).map(|()| out) }) {
                Ok(out) => {
                    total_in += len;
                    total_out += out.len();
                }
                Err(e) => {
                    let path = format!("{}/brotli-marksfail-{seed}.bin", std::env::temp_dir().display());
                    std::fs::write(&path, &data).unwrap();
                    let head: Vec<_> = steps.iter().take(12).map(|s| (s.op, s.n)).collect();
                    panic!("seed {seed} k={k} schedule {}: {e}\nlen {len} mark {mark} params {:?} dicts {:?} steps {} {head:?}\ndata saved to {path}", case.schedule, case.params, case.dicts.iter().map(Vec::len).collect::<Vec<_>>(), steps.len());
                }
            }
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}

/// Words of the static dictionary, each the way one of the 121 transforms changes it: what the encoder's search in the
/// dictionary is for.
pub fn words(rng: &mut Rng, len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len + 128);
    // Few words and transforms make for repetitions, many for first occurrences.
    let few = rng.chance(1, 3);
    let only: Option<usize> = rng.chance(1, 4).then(|| rng.below(121));
    let glue = rng.below(4);
    while out.len() < len {
        let n = rng.range(4, 24);
        let bits = crate::grammar::size_bits(n);
        let index = if few { rng.below(8) } else { rng.below(1 << bits) };
        let transform = only.unwrap_or_else(|| if rng.chance(1, 4) { 0 } else { rng.below(121) });
        let mut word = crate::grammar::dictionary_word(n, index, transform);
        match rng.below(16) {
            // Not quite the word.
            0 if !word.is_empty() => {
                let i = rng.below(word.len());
                word[i] ^= 1 << rng.below(8);
            }
            1 => word.truncate(rng.below(word.len() + 1)),
            _ => {}
        }
        out.extend_from_slice(&word);
        match glue {
            0 => {}
            1 => out.push(rng.next() as u8),
            2 => out.extend_from_slice(*rng.pick(&[&b" "[..], b"", b"\n", b"=\"", b"='", b"(", b". ", b", ", b"\xc2\xa0", b">", b"\"", b"'"])),
            _ => {
                if rng.chance(1, 4) {
                    for _ in 0..rng.range(1, 6) {
                        out.push(rng.next() as u8);
                    }
                }
            }
        }
    }
    out.truncate(len);
    out
}

pub fn run_words(seed0: u64, iters: u64, max_len: usize, qualities: u64) {
    let qs = args::qualities(qualities, 0..12);
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let len = match rng.below(4) {
            0 => rng.below(200),
            1 | 2 => rng.below(5000),
            _ => rng.below(max_len),
        };
        let data = words(&mut rng, len);
        let mut params = vec![(1, q)];
        if rng.chance(1, 2) {
            params.push((2, rng.range(10, 24) as u32));
        }
        if rng.chance(1, 3) {
            params.push((0, rng.below(3) as u32));
        }
        if rng.chance(1, 4) {
            params.push((5, len as u32));
        }
        let mut dicts = Vec::new();
        if rng.chance(1, 10) {
            let n = rng.range(1, 400);
            dicts.push(words(&mut rng, n));
        }
        for k in 0..2 {
            let case = EncCase { data: data.clone(), params: params.clone(), dicts: dicts.clone(), schedule: if k == 0 { 0 } else { rng.next() | 1 }, misuse: false };
            match enc::compare(&case).and_then(|out| enc::round_trip(&out, &data, &dicts, false, rng.next()).map(|()| out)) {
                Ok(out) => {
                    total_in += len;
                    total_out += out.len();
                }
                Err(e) => {
                    let path = format!("{}/brotli-wordsfail-{seed}.bin", std::env::temp_dir().display());
                    std::fs::write(&path, &data).unwrap();
                    panic!("seed {seed} k={k} schedule {}: {e}\nlen {len} params {:?} dicts {:?}\ndata saved to {path}", case.schedule, case.params, case.dicts.iter().map(Vec::len).collect::<Vec<_>>());
                }
            }
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}

/// Commands of a chosen shape: so many bytes never seen before, then a copy of a chosen length from a chosen distance,
/// with the lengths and distances at the edges of the ranges that the codes for them cover.
pub fn run_lengths(seed0: u64, iters: u64, max_len: usize, qualities: u64) {
    const INSERT: [usize; 23] = [0, 1, 5, 6, 8, 10, 14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114, 6210, 22594, 64, 512];
    const COPY: [usize; 24] = [4, 5, 8, 9, 10, 12, 14, 18, 22, 30, 38, 54, 70, 72, 102, 134, 136, 198, 326, 582, 1094, 2118, 2120, 16384];
    let qs = args::qualities(qualities, 0..12);
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let len = rng.range(1000, if q >= 10 { max_len.min(200_000) } else { max_len });
        let lgwin = rng.range(10, 24);
        let window = (1usize << lgwin) - 16;
        let edge = |rng: &mut Rng, v: usize| match rng.below(4) {
            0 => v.saturating_sub(1),
            1 => v + 1,
            _ => v,
        };
        // Long runs of literals use up the input, so they are not always in the mix.
        let longest = *rng.pick(&[130, 2200, 7000, 23000]);
        let coarse = rng.chance(1, 2);
        let mut data: Vec<u8> = (0..rng.range(8, 3000)).map(|_| rng.next() as u8).collect();
        let mut last = 0usize;
        while data.len() < len {
            let v = *rng.pick(&INSERT);
            let mut insert = edge(&mut rng, v).min(longest);
            let v = *rng.pick(&COPY);
            let mut copy = edge(&mut rng, v).max(2);
            if q <= 1 && coarse {
                // After many literals qualities 0 and 1 look for a match only every so many bytes, so where they find
                // the copy varies. Some of these land on the edge.
                let (edge, spread) = *rng.pick(&[(22594, 800), (6210, 250), (2114, 90)]);
                insert = edge - rng.below(spread);
                copy = rng.range(spread, 4 * spread);
            }
            data.extend((0..insert).map(|_| rng.next() as u8));
            let cur = data.len();
            let distance = match rng.below(8) {
                0 if last != 0 => last,
                1 if last > 3 => last + rng.below(7) - 3,
                2 => near(&mut rng, window),
                3 => rng.range(1, 130),
                4 | 5 => {
                    // Where the number of extra bits of the distance code changes, for some NPOSTFIX and NDIRECT.
                    let k = rng.range(2, 24);
                    ((1usize << k) + (rng.below(4) << rng.below(k)) + rng.below(140)).saturating_sub(rng.below(8))
                }
                _ => rng.range(1, cur),
            }
            .clamp(1, cur);
            for _ in 0..copy {
                data.push(data[data.len() - distance]);
            }
            last = distance;
        }
        data.truncate(len);
        let mut params = vec![(1, q), (2, lgwin as u32)];
        if rng.chance(1, 2) {
            let npostfix = rng.below(4) as u32;
            params.push((7, npostfix));
            params.push((8, (rng.below(16) as u32) << npostfix));
        }
        if rng.chance(1, 6) {
            params.push((0, rng.below(3) as u32));
        }
        if rng.chance(1, 6) {
            params.push((3, rng.range(16, 20) as u32));
        }
        for k in 0..2 {
            let case = EncCase { data: data.clone(), params: params.clone(), dicts: Vec::new(), schedule: if k == 0 { 0 } else { rng.next() | 1 }, misuse: false };
            match enc::compare(&case).and_then(|out| enc::round_trip(&out, &data, &[], false, rng.next()).map(|()| out)) {
                Ok(out) => {
                    total_in += len;
                    total_out += out.len();
                }
                Err(e) => {
                    let path = format!("{}/brotli-lengthsfail-{seed}.bin", std::env::temp_dir().display());
                    std::fs::write(&path, &data).unwrap();
                    panic!("seed {seed} k={k} schedule {}: {e}\nlen {len} params {:?}\ndata saved to {path}", case.schedule, case.params);
                }
            }
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}
