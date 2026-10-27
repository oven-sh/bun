//! Inputs of shapes that random data and files do not have.
use crate::enc::{self, EncCase};
use crate::r#gen;
use crate::rng::Rng;

fn check(name: &str, seed: u64, rng: &mut Rng, data: &[u8], params: &[(i32, u32)], dicts: &[Vec<u8>], totals: &mut (usize, usize)) {
    let large = params.iter().any(|&(k, v)| k == 6 && v == 1);
    for k in 0..2 {
        let case = EncCase { data: data.to_vec(), params: params.to_vec(), dicts: dicts.to_vec(), schedule: if k == 0 { 0 } else { rng.next() | 1 }, misuse: false };
        match enc::compare(&case).and_then(|out| enc::round_trip(&out, data, dicts, large, rng.next()).map(|()| out)) {
            Ok(out) => {
                totals.0 += data.len();
                totals.1 += out.len();
            }
            Err(e) => {
                let path = format!("{}/brotli-{name}fail-{seed}.bin", std::env::temp_dir().display());
                std::fs::write(&path, data).unwrap();
                panic!("seed {seed} k={k} schedule {}: {e}\nlen {} params {params:?} dicts {:?}\ndata saved to {path}", case.schedule, data.len(), dicts.iter().map(Vec::len).collect::<Vec<_>>());
            }
        }
    }
}

/// Compound dictionaries: copies from them that are long, that go from one dictionary on into the next, and that are cut
/// by the end of a block of input, so that the encoder has to take them up again.
pub fn run_dict(seed0: u64, iters: u64, max_len: usize, qualities: u64, corpus: &r#gen::Corpus) {
    let qs: Vec<u32> = crate::args::qualities(qualities, 0..12);
    let mut totals = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let large = rng.chance(1, 8);
        let lgwin = if large { rng.range(25, 27) } else { rng.range(10, 24) };
        let lgblock = if rng.chance(1, 4) { rng.range(16, 18) } else { 0 };
        let block = 1usize << if q < 4 { 14 } else if lgblock != 0 { lgblock } else if q >= 9 && lgwin > 16 { lgwin.min(18) } else { 16 };
        let most = if rng.chance(1, 2) { 3 * block } else { max_len }.min(if q >= 10 { 400_000 } else { max_len });
        let len = rng.range(1, most);
        let mut dicts: Vec<Vec<u8>> = Vec::new();
        for _ in 0..*rng.pick(&[1, 1, 2, 3, 15]) {
            let n = match rng.below(4) {
                0 => rng.range(1, 40),
                1 | 2 => rng.range(1, 3000),
                _ => rng.range(1000, 200_000),
            };
            dicts.push(match rng.below(3) {
                0 => (0..n).map(|_| rng.next() as u8).collect(),
                1 => crate::ring::records(&mut rng, n),
                _ => r#gen::data(&mut rng, corpus, n),
            });
        }
        // A ladder: the start of one string, cut off a little later each time. A search that wants all matches finds one
        // after the other, each longer than the last, until it has no room for more.
        let mut ladder: Vec<u8> = Vec::new();
        if rng.chance(1, 8) {
            ladder = (0..1300).map(|_| rng.next() as u8).collect();
            let up = rng.chance(3, 4);
            let mut n = 3;
            dicts = (0..rng.range(2, 15))
                .map(|_| {
                    let mut lengths: Vec<usize> = (0..rng.range(8, 40)).map(|_| { n += rng.range(1, 2); n }).collect();
                    if !up {
                        lengths.reverse();
                    }
                    lengths.iter().flat_map(|&n| ladder[..n].iter().copied().chain([!ladder[n]])).collect()
                })
                .collect();
            if rng.chance(1, 4) {
                dicts.reverse();
            }
        }
        let all = dicts.concat();
        // Where one dictionary ends and the next one starts.
        let seams: Vec<usize> = dicts.iter().scan(0, |at, d| { *at += d.len(); Some(*at) }).collect();
        let mut data: Vec<u8> = Vec::with_capacity(len + 64);
        while data.len() < len {
            let to_end = block - data.len() % block;
            let straddle = rng.chance(1, 3) && to_end < 30_000;
            let literals = if straddle {
                // Up to shortly before the end of the block.
                to_end.saturating_sub(rng.range(1, 300))
            } else {
                match rng.below(4) {
                    0 => 0,
                    1 | 2 => rng.below(12),
                    _ => rng.below(2000),
                }
            };
            data.extend((0..literals).map(|_| rng.next() as u8));
            if !ladder.is_empty() && rng.chance(1, 2) {
                data.extend_from_slice(&ladder[..rng.range(4, ladder.len())]);
                continue;
            }
            if !straddle && rng.chance(1, 5) && !data.is_empty() {
                let distance = rng.range(1, data.len());
                for _ in 0..rng.range(4, 300) {
                    data.push(data[data.len() - distance]);
                }
                continue;
            }
            let start = match rng.below(5) {
                0 => 0,
                1 => rng.pick(&seams).saturating_sub(rng.range(1, 40)),
                2 => all.len().saturating_sub(rng.range(1, 700)),
                _ => rng.below(all.len()),
            };
            let n = match rng.below(4) {
                0 => rng.range(4, 30),
                1 => rng.range(4, 700),
                _ => all.len(),
            }
            .min(all.len() - start);
            data.extend_from_slice(&all[start..start + n]);
        }
        data.truncate(len);
        let mut params = vec![(1, q), (2, lgwin as u32)];
        if large {
            params.insert(0, (6, 1));
        }
        if lgblock != 0 {
            params.push((3, lgblock as u32));
        }
        // The hasher depends on it.
        if rng.chance(1, 2) {
            params.push((5, *rng.pick(&[len as u32, 1 << 20, (1 << 20) - 1, 1 << 24, 100])));
        }
        if rng.chance(1, 8) {
            params.push((0, rng.below(3) as u32));
        }
        check("dict", seed, &mut rng, &data, &params, &dicts, &mut totals);
    }
    println!("ok: {iters} iterations, {} -> {}", totals.0, totals.1);
}

/// Stretches of many different kinds, one after the other: many blocks, many block types, many histograms to cluster.
pub fn run_blocks(seed0: u64, iters: u64, max_len: usize, qualities: u64) {
    let qs: Vec<u32> = crate::args::qualities(qualities, 0..12);
    let mut totals = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        // Thousands of short blocks of a few kinds. When the blocks are clustered, the queue of pairs that are worth
        // merging only fills up if there are more than 8000 of them.
        let short = rng.chance(1, 6);
        let len = if short { max_len } else { rng.range(1000, max_len) };
        // What a kind of stretch is made of: its bytes, and how long and how far back its copies are.
        struct Kind {
            bytes: Vec<u8>,
            insert: usize,
            copy: usize,
            distance: usize,
        }
        let copies = if short { 0 } else { rng.below(3) };
        let kinds: Vec<Kind> = (0..if short { rng.range(2, 20) } else { *rng.pick(&[2, 5, 20, 60, 100, 150, 300, 400]) })
            .map(|_| Kind {
                bytes: (0..if short { rng.range(10, 40) } else { *rng.pick(&[1, 2, 3, 6, 12, 40]) }).map(|_| rng.next() as u8).collect(),
                insert: *rng.pick(&[1, 2, 5, 9, 20, 70, 300]),
                copy: *rng.pick(&[2, 4, 5, 8, 11, 20, 60, 200, 1000]),
                distance: 1 << rng.below(20),
            })
            .collect();
        let (lo, hi) = if short { *rng.pick(&[(30, 60), (40, 70), (40, 90)]) } else { *rng.pick(&[(20, 100), (100, 400), (300, 900), (500, 700), (500, 3000), (2000, 9000)]) };
        let order = rng.below(if short { 2 } else { 3 });
        // Longer and longer stretches: the pairs that are most worth merging come when the queue is full.
        let growing = short && rng.chance(1, 2);
        let mut data: Vec<u8> = Vec::with_capacity(len + 10_000);
        let mut turn = 0usize;
        while data.len() < len {
            let kind = match order {
                0 => &kinds[turn % kinds.len()],
                1 => rng.pick(&kinds),
                // Mostly a few of them.
                _ => if rng.chance(3, 4) { &kinds[rng.below(kinds.len().min(3))] } else { rng.pick(&kinds) },
            };
            turn += 1;
            let end = data.len() + rng.range(lo, hi) * if growing { 1 + 2 * data.len() / len } else { 1 };
            while data.len() < end {
                let n = if copies == 0 { end - data.len() } else { rng.range(kind.insert, kind.insert + kind.insert / 4) };
                data.extend((0..n).map(|_| *rng.pick(&kind.bytes)));
                if copies != 0 {
                    let distance = (kind.distance + if copies == 1 { 0 } else { rng.below(kind.distance) }).min(data.len());
                    for _ in 0..kind.copy {
                        data.push(data[data.len() - distance]);
                    }
                }
            }
        }
        data.truncate(len);
        // A meta-block has at most an eighth of the ring buffer's size in literals.
        let mut params = vec![(1, q), (2, if short { 24 } else if rng.chance(3, 4) { rng.range(20, 24) } else { rng.range(10, 24) } as u32)];
        if rng.chance(1, 4) {
            params.push((3, rng.range(16, 24) as u32));
        }
        if rng.chance(1, 4) {
            params.push((0, rng.below(3) as u32));
        }
        if rng.chance(1, 8) {
            params.push((4, 1));
        }
        if rng.chance(1, 4) {
            params.push((5, len as u32));
        }
        check("blocks", seed, &mut rng, &data, &params, &[], &mut totals);
    }
    println!("ok: {iters} iterations, {} -> {}", totals.0, totals.1);
}

/// Every quality with every window size and with size hints on both sides of 1 MiB: all that decides which hasher is used.
pub fn run_select(seed: u64, len: usize, corpus: &r#gen::Corpus) {
    let mut rng = Rng(seed);
    let mut totals = (0usize, 0usize);
    let mut cases = 0;
    let inputs = [r#gen::data(&mut rng, corpus, len), crate::ring::records(&mut rng, len), crate::ring::words(&mut rng, len)];
    for q in 0..12u32 {
        for lgwin in 10..=30u32 {
            // A window of 2^30 takes a hasher with 2^31 entries at qualities 10 and 11.
            if q >= 10 && lgwin > 26 {
                continue;
            }
            for hint in [0u32, 1, (1 << 20) - 1, 1 << 20, u32::MAX] {
                let mut params = vec![(1, q), (6, u32::from(lgwin > 24)), (2, lgwin)];
                if hint != 0 {
                    params.push((5, hint));
                }
                for data in &inputs {
                    let data = &data[..if q >= 10 { len.min(60_000) } else { len }];
                    let case = EncCase { data: data.to_vec(), params: params.clone(), dicts: Vec::new(), schedule: 0, misuse: false };
                    match enc::compare(&case) {
                        Ok(out) => {
                            totals.0 += data.len();
                            totals.1 += out.len();
                            cases += 1;
                        }
                        Err(e) => panic!("seed {seed}: {e}\nlen {} params {params:?}", data.len()),
                    }
                }
            }
        }
    }
    println!("ok: {cases} cases, {} -> {}", totals.0, totals.1);
}
