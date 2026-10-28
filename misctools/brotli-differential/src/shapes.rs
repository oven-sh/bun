//! Inputs of shapes that random data and files do not have.
use crate::enc::{self, EncCase, Step};
use crate::r#gen;
use crate::rng::Rng;
use bun_brotli::{Decoder, DecoderResult, Encoder, EncoderOperation, EncoderParameter, PreparedDictionary};

/// Without the reference.
fn rust_stream(data: &[u8], params: &[(i32, u32)], dicts: &[Vec<u8>], op: EncoderOperation) -> Result<Vec<u8>, String> {
    let mut e = Encoder::new();
    for &(k, v) in params {
        if !e.set_parameter(EncoderParameter::from_raw(k as u32).unwrap(), v) {
            return Err(format!("set_parameter({k}, {v})"));
        }
    }
    for d in dicts {
        if !PreparedDictionary::new(d.clone().into_boxed_slice()).is_some_and(|p| e.attach_prepared_dictionary(p)) {
            return Err(format!("attach dictionary of {} bytes", d.len()));
        }
    }
    let (mut out, mut buf, mut input) = (Vec::new(), vec![0u8; 1 << 16], data);
    loop {
        let mut room: &mut [u8] = &mut buf;
        e.compress_stream(op, &mut input, &mut room).map_err(|e| format!("Rust: {e}"))?;
        let made = (1 << 16) - room.len();
        out.extend_from_slice(&buf[..made]);
        if input.is_empty() && !e.has_more_output() {
            return Ok(out);
        }
    }
}

fn check(name: &str, seed: u64, rng: &mut Rng, data: &[u8], params: &[(i32, u32)], dicts: &[Vec<u8>], totals: &mut (usize, usize)) {
    let large = params.iter().any(|&(k, v)| k == 6 && v == 1);
    for k in 0..2 {
        let case = EncCase { data: data.to_vec(), params: params.to_vec(), dicts: dicts.to_vec(), schedule: if k == 0 { 0 } else { rng.next() | 1 }, misuse: false };
        // When a copy goes on into an empty dictionary, the reference reads past its end.
        let stream = if dicts.iter().any(Vec::is_empty) { rust_stream(data, params, dicts, EncoderOperation::Finish) } else { enc::compare(&case) };
        match stream.and_then(|out| enc::round_trip(&out, data, dicts, large, rng.next()).map(|()| out)) {
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
        if rng.chance(1, 10) {
            for _ in 0..rng.range(1, 3).min(15 - dicts.len()) {
                dicts.insert(rng.below(dicts.len() + 1), Vec::new());
            }
        }
        let all = dicts.concat();
        // Where one dictionary ends and the next one starts.
        let seams: Vec<usize> = dicts.iter().scan(0, |at, d| { *at += d.len(); Some(*at) }).collect();
        let mut data: Vec<u8> = Vec::with_capacity(len + 64);
        while data.len() < len {
            let to_end = block - data.len() % block;
            let straddle = rng.chance(1, 3) && to_end < 30_000;
            let before_end = rng.range(1, 300).min(to_end);
            let literals = if straddle {
                // Up to shortly before the end of the block.
                to_end - before_end
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
                // The block ends first, then the dictionary.
                _ if straddle && rng.chance(1, 2) => rng.pick(&seams).saturating_sub(before_end + rng.range(1, 200)),
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

/// A copy from a dictionary when the window is full, so that its distance is larger than the window but not larger than
/// the position. Then the bytes that are that far back in the input, which the ring buffer still has.
pub fn run_far_dict(seed: u64, qualities: u64) {
    const LGWIN: u32 = 25;
    let limit = (1usize << LGWIN) - 16;
    let mut rng = Rng(seed);
    // It compresses, and has no matches to speak of.
    let mut text = |n: usize| -> Vec<u8> { (0..n).map(|_| b'0' + (rng.next() & 63) as u8).collect() };
    let dictionary = text(4096);
    let mut data = text(36 << 20);
    let (address, length) = (1000, 1000);
    let distance = limit + dictionary.len() - address;
    for k in 0..4 {
        let at = limit + (1 << 20) + k * 100_003;
        data[at..at + length].copy_from_slice(&dictionary[address..address + length]);
        // After so many literals the encoder does not look for a match at every position, and the later it finds the copy,
        // the shorter is the distance into the dictionary. With a run, that does not matter.
        data[at + length - distance..][..128].fill(b'A' + k as u8);
        data[at + length..][..64].fill(b'A' + k as u8);
    }
    let dicts = vec![dictionary];
    for q in crate::args::qualities(qualities, 2..12) {
        let params = vec![(6, 1), (1, q), (2, LGWIN), (5, data.len() as u32)];
        let case = EncCase { data: data.clone(), params, dicts: dicts.clone(), schedule: 0, misuse: false };
        let out = enc::compare(&case).and_then(|out| enc::round_trip(&out, &data, &dicts, true, 0).map(|()| out)).unwrap_or_else(|e| panic!("seed {seed} quality {q}: {e}"));
        println!("quality {q}: {} -> {}", data.len(), out.len());
    }
}

/// Calls in any order, with any amount of input and of room for output, whether or not the call before was completed or
/// refused. What matters here is the state of the stream, so the inputs are short and the calls are many.
pub fn run_states(seed0: u64, iters: u64, qualities: u64) {
    const SIZES: [usize; 25] = [0, 0, 0, 1, 1, 2, 3, 5, 15, 16, 17, 18, 100, 255, 256, 257, 1000, 5000, 16384, 65535, 65536, 65537, 200_000, 1 << 24, (1 << 24) + 1];
    const ROOM: [usize; 12] = [0, 0, 1, 1, 2, 3, 5, 16, 600, 5000, 1 << 16, 1 << 22];
    let qs: Vec<u32> = crate::args::qualities(qualities, 0..12);
    let mut pool = crate::ring::words(&mut Rng(1), 1 << 20);
    pool.resize((1 << 24) + 1, b'x');
    let (mut calls, mut refused, mut decoded) = (0usize, 0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let mut params = vec![(1, q)];
        if rng.chance(1, 2) {
            params.push((2, rng.range(10, 24) as u32));
        }
        if rng.chance(1, 8) {
            params.push((6, 1));
            params.push((2, rng.range(10, 26) as u32));
        }
        if rng.chance(1, 8) {
            params.push((3, rng.range(16, 20) as u32));
        }
        if rng.chance(1, 8) {
            params.push((5, *rng.pick(&[1, 1000, 1 << 20])));
        }
        let offset = rng.chance(1, 4);
        if offset {
            params.push((9, *rng.pick(&[1, 2, 77, 1 << 10, 1 << 16, (1 << 24) - 1, 1 << 30])));
        }
        let large = params.iter().any(|&(k, _)| k == 6);
        // Long inputs are rare, and rarer where they take long.
        let sizes = &SIZES[..if rng.chance(1, if q >= 10 { 40 } else { 8 }) { SIZES.len() } else { 19 }];
        let at = |e: String| -> ! { panic!("seed {seed}: {e}\nparams {params:?}; TRACE=1 shows the calls") };
        let mut p = enc::Pair::new(&EncCase { data: Vec::new(), params: params.clone(), dicts: Vec::new(), schedule: 0, misuse: true }).unwrap_or_else(|e| at(e));
        let mut data: Vec<u8> = Vec::new();
        // The operation that is not complete, and what is left of its input.
        let mut pending: Option<(i32, usize, usize)> = None;
        for _ in 0..rng.range(1, 60) {
            let (op, start, end) = match pending {
                Some(same) if rng.chance(2, 3) => same,
                _ => {
                    let n = *rng.pick(sizes);
                    let start = rng.below(pool.len() - n + 1);
                    (if rng.chance(1, 40) { 2 } else { *rng.pick(&[0, 0, 0, 0, 1, 1, 3, 3, 3]) }, start, start + n)
                }
            };
            let (ok, used) = p.step(op, &pool[start..end], *rng.pick(&ROOM)).unwrap_or_else(|e| at(e));
            calls += 1;
            refused += usize::from(!ok);
            if op != 3 {
                data.extend_from_slice(&pool[start..start + used]);
            }
            // After a call that was refused, the operation that it interrupted can still be completed.
            if ok {
                pending = (start + used < end || p.has_more_output()).then_some((op, start + used, end));
            }
        }
        // To the end, if it still can get there.
        for _ in 0..200 {
            if p.is_finished() || !p.step(2, &[], 1 << 22).unwrap_or_else(|e| at(e)).0 {
                break;
            }
        }
        if p.is_finished() && !offset {
            enc::round_trip(&p.out, &data, &[], large, rng.next()).unwrap_or_else(|e| at(e));
            decoded += 1;
        }
    }
    println!("ok: {iters} iterations, {calls} calls, {refused} refused, {decoded} streams decoded");
}

/// The second part of a stream, made with a stream offset and a dictionary. Distances into the dictionary start after
/// both parts, although the encoder only has the second.
pub fn run_offset_dict(seed0: u64, iters: u64, qualities: u64) {
    let qs = crate::args::qualities(qualities, 5..12);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let mut noise = |n: usize| -> Vec<u8> { (0..n).map(|_| rng.next() as u8).collect() };
        let dictionary = noise(400_000);
        let (first, tail) = (noise(1 + seed as usize % 3000), noise(500));
        let q = qs[it as usize % qs.len()];
        // The first two bytes get a block of their own.
        let block = 2 + if q < 9 { 1 << 16 } else { 1 << 18 };
        let address = 5000;
        let wrong = address + block - first.len();
        let second = [&dictionary[address..address + block], &dictionary[wrong..wrong + 3000], &tail[..]].concat();
        let dicts = vec![dictionary];
        let params = vec![(1, q), (2, 22)];
        let fail = |e: String| -> ! { panic!("seed {seed} quality {q}: {e}") };
        let mut stream = rust_stream(&first, &params, &dicts, EncoderOperation::Flush).unwrap_or_else(|e| fail(e));
        let params = [&params[..], &[(9, first.len() as u32)]].concat();
        let case = EncCase { data: second.clone(), params, dicts: dicts.clone(), schedule: 0, misuse: false };
        stream.extend(enc::compare(&case).unwrap_or_else(|e| fail(e)));
        enc::round_trip(&stream, &[first, second].concat(), &dicts, false, 0).unwrap_or_else(|e| fail(e));
    }
    println!("ok: {iters} iterations");
}

/// One part of a stream, by both encoders in lock step. All parts but the last end with a flush.
fn part_in_lock_step(rng: &mut Rng, data: &[u8], params: &[(i32, u32)], dicts: &[Vec<u8>], last: bool) -> Result<Vec<u8>, String> {
    let mut p = enc::Pair::new(&EncCase { data: Vec::new(), params: params.to_vec(), dicts: dicts.to_vec(), schedule: 0, misuse: false })?;
    let mut rest = data;
    if rng.chance(1, 2) {
        let most = *rng.pick(&[7, 300, 70_000]);
        while !rest.is_empty() {
            let n = rng.range(1, most).min(rest.len());
            let (op, big) = (i32::from(rng.chance(1, 12)), rng.chance(1, 2));
            let before = rest.len();
            let mut piece = &rest[..n];
            while !piece.is_empty() {
                let cap = if big { 1 << 20 } else { *rng.pick(&[0, 1, 3, 5, 600, 1 << 16]) };
                let (ok, used) = p.step(op, piece, cap)?;
                piece = &piece[used..];
                if !ok {
                    return Err(format!("both refuse a call, {} bytes into the part", data.len() - before));
                }
            }
            if !enc::run_op(&mut p, rng, op, &[], true)? {
                return Err("both refuse to complete a call".into());
            }
            rest = &rest[n..];
        }
    }
    if !enc::run_op(&mut p, rng, if last { 2 } else { 1 }, rest, true)? {
        return Err("both refuse the last call".into());
    }
    Ok(p.out)
}

/// `into_prepared_dictionaries` and `into_dictionaries`: what an encoder or a decoder gives back, wherever in a stream it
/// is and whether or not it has failed, has to serve the next one like new.
fn handed_on(rng: &mut Rng, data: &[u8], params: &[(i32, u32)], dicts: &[Vec<u8>]) -> Result<(), String> {
    let fresh = rust_stream(data, params, dicts, EncoderOperation::Finish)?;
    let with_params = || {
        let mut e = Encoder::new();
        for &(k, v) in params {
            assert!(e.set_parameter(EncoderParameter::from_raw(k as u32).unwrap(), v));
        }
        e
    };
    let mut buf = vec![0u8; 1 << 16];
    let mut used = with_params();
    for d in dicts {
        assert!(used.attach_prepared_dictionary(PreparedDictionary::new(d.clone().into_boxed_slice()).unwrap()));
    }
    for _ in 0..rng.below(5) {
        let mut input = &data[..rng.below(data.len() + 1).min(70_000)];
        let mut room: &mut [u8] = &mut buf[..*rng.pick(&[0, 5, 1 << 16])];
        let _ = used.compress_stream(EncoderOperation::from_raw(rng.below(4) as u32).unwrap(), &mut input, &mut room);
    }
    let taken = used.into_prepared_dictionaries();
    if taken.len() != dicts.len() {
        return Err(format!("into_prepared_dictionaries: {} of {}", taken.len(), dicts.len()));
    }
    let mut e = with_params();
    for p in taken {
        if !e.attach_prepared_dictionary(p) {
            return Err("a dictionary that was in use is refused".into());
        }
    }
    let (mut out, mut input) = (Vec::new(), data);
    while !e.is_finished() {
        let mut room: &mut [u8] = &mut buf;
        e.compress_stream(EncoderOperation::Finish, &mut input, &mut room).map_err(|e| format!("with dictionaries that were in use: {e}"))?;
        let made = (1 << 16) - room.len();
        out.extend_from_slice(&buf[..made]);
    }
    if out != fresh {
        return Err(format!("with dictionaries that were in use the stream is another: {} and {} bytes", out.len(), fresh.len()));
    }

    let mut used = Decoder::new();
    for d in dicts {
        assert!(used.attach_dictionary(d.clone().into_boxed_slice()));
    }
    let mut start = fresh[..rng.below(fresh.len() + 1)].to_vec();
    if !start.is_empty() && rng.chance(1, 3) {
        let at = rng.below(start.len());
        start[at] ^= 1 << rng.below(8);
    }
    let mut input = &start[..];
    let mut room: &mut [u8] = &mut buf[..*rng.pick(&[0, 5, 1 << 16])];
    let _ = used.decompress_stream(&mut input, &mut room);
    let taken = used.into_dictionaries();
    if !taken.iter().map(|d| &d[..]).eq(dicts.iter().map(|d| &d[..])) {
        return Err("into_dictionaries gives something else than was attached".into());
    }
    let mut d = Decoder::new();
    for dictionary in taken {
        if !d.attach_dictionary(dictionary) {
            return Err("a dictionary that was in use is refused by the decoder".into());
        }
    }
    let (mut back, mut input) = (Vec::new(), &fresh[..]);
    loop {
        let mut room: &mut [u8] = &mut buf;
        let result = d.decompress_stream(&mut input, &mut room);
        let made = (1 << 16) - room.len();
        back.extend_from_slice(&buf[..made]);
        match result {
            DecoderResult::NeedsMoreOutput => {}
            DecoderResult::Success if back == data => return Ok(()),
            _ => return Err(format!("with dictionaries that were in use: {result:?} after {} of {} bytes", back.len(), data.len())),
        }
    }
}

/// A stream in parts, each by an encoder of its own that is told how much came before (`BROTLI_PARAM_STREAM_OFFSET`), with
/// dictionaries, and with more input than the window holds. That both encoders write the same is not enough here: what
/// they write has to decode to the input. After a copy from a dictionary comes what could be taken for more of it.
pub fn run_parts(seed0: u64, iters: u64, max_len: usize, qualities: u64, corpus: &r#gen::Corpus) {
    let qs = crate::args::qualities(qualities, 0..12);
    let mut totals = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let lgwin = if rng.chance(3, 4) { rng.range(10, 16) } else { rng.range(17, 22) };
        let window = (1usize << lgwin) - 16;
        let lgblock = if rng.chance(1, 4) { rng.range(16, 18) } else { 0 };
        let block = 1usize << if q < 4 { 14 } else if lgblock != 0 { lgblock } else if q >= 9 && lgwin > 16 { lgwin.min(18) } else { 16 };
        let mut params = vec![(1, q), (2, lgwin as u32)];
        if lgblock != 0 {
            params.push((3, lgblock as u32));
        }
        if rng.chance(1, 4) {
            params.push((5, *rng.pick(&[1 << 20, (1 << 20) - 1, 100])));
        }
        let mut dicts: Vec<Vec<u8>> = Vec::new();
        for _ in 0..*rng.pick(&[0, 1, 1, 1, 2, 3, 15]) {
            let n = match rng.below(4) {
                0 => rng.range(1, 40),
                1 | 2 => rng.range(1, 3000),
                _ => rng.range(1000, 60_000),
            };
            dicts.push(match rng.below(3) {
                0 | 1 => (0..n).map(|_| rng.next() as u8).collect(),
                _ => r#gen::data(&mut rng, corpus, n),
            });
        }
        if !dicts.is_empty() && rng.chance(1, 10) {
            for _ in 0..rng.range(1, 3).min(15 - dicts.len()) {
                dicts.insert(rng.below(dicts.len() + 1), Vec::new());
            }
        }
        let all = dicts.concat();
        let most = max_len.min(if q >= 10 { 150_000 } else { max_len });
        let edge = |rng: &mut Rng, v: usize| (v + rng.below(5)).saturating_sub(2).max(1);
        let mut whole: Vec<u8> = Vec::new();
        let mut stream: Vec<u8> = Vec::new();
        let parts = *rng.pick(&[1, 1, 2, 2, 2, 3, 4]);
        let sparse = rng.chance(2, 3);
        let wordy = rng.chance(1, 3);
        let fail = |e: String, whole: &[u8], part: usize, params: &[(i32, u32)]| -> ! {
            let path = format!("{}/brotli-partsfail-{seed}.bin", std::env::temp_dir().display());
            std::fs::write(&path, whole).unwrap();
            panic!("seed {seed} part {part} of {parts}: {e}\nlen {} params {params:?} dicts {:?}\ndata saved to {path}", whole.len(), dicts.iter().map(Vec::len).collect::<Vec<_>>());
        };
        for part in 0..parts {
            let offset = whole.len();
            let len = match rng.below(8) {
                0 => rng.range(1, 5),
                1 => edge(&mut rng, window),
                2 => edge(&mut rng, block),
                3 => block + rng.range(1, 600),
                4 => rng.range(1, 3000),
                5 => rng.range(1, (4 * window).min(most)),
                _ => rng.range(1, most),
            }
            .min(most);
            // With an offset, the first two bytes get a block of their own.
            let phase = if offset == 0 { 0 } else { 2 };
            while whole.len() - offset < len {
                let here = whole.len() - offset;
                let to_end = block - (here + block - phase) % block;
                // A copy is only taken up again in the next block if that goes into the same meta-block, which it does not
                // after many literals: an eighth of the ring buffer's size.
                let straddle = to_end <= 300 && rng.chance(3, 4);
                // How much of the copy is in this block.
                let before_end = to_end;
                let literals = if straddle { 0 } else if sparse { *rng.pick(&[0, 0, 0, 1, 2, 5]) } else { *rng.pick(&[0, 0, 1, 3, 9, 40, 700]) };
                whole.extend((0..literals).map(|_| rng.next() as u8));
                // The distance that stands for a word of the static dictionary depends on the offset, too.
                if wordy && !straddle && rng.chance(1, 2) {
                    let n = rng.range(4, 80);
                    whole.extend(crate::ring::words(&mut rng, n));
                    continue;
                }
                if all.is_empty() || rng.chance(1, 4) {
                    // From the input, also from the parts before.
                    let distance = if rng.chance(1, 3) { edge(&mut rng, window).min(whole.len()) } else { rng.range(1, whole.len().max(1)) };
                    for _ in 0..if whole.is_empty() { 0 } else { rng.range(4, 300) } {
                        whole.push(whole[whole.len() - distance]);
                    }
                    continue;
                }
                let n = if straddle { (before_end + rng.below(3)).saturating_sub(1).max(1) } else if rng.chance(1, 8) { rng.range(400, 3000) } else { rng.range(4, 400) }.min(all.len());
                // The first and the last byte of the dictionaries are the limits of what is a distance into them.
                let address = match rng.below(if straddle { 3 } else { 8 }) {
                    0 => 0,
                    1 => all.len() - n,
                    _ => rng.below(all.len() - n + 1),
                };
                // The distance that stands for `address`.
                let distance = whole.len().min(window) + all.len() - address;
                whole.extend_from_slice(&all[address..address + n]);
                let more = rng.range(4, 400);
                match rng.below(if straddle { 8 } else { 6 }) {
                    // More of the dictionary.
                    0 | 6 | 7 => whole.extend_from_slice(&all[address + n..(address + n + more).min(all.len())]),
                    // The dictionary as many bytes earlier or later as there were before this part.
                    1 if address + n >= offset => whole.extend_from_slice(&all[address + n - offset..(address + n - offset + more).min(all.len())]),
                    2 if address + n + offset < all.len() => whole.extend_from_slice(&all[address + n + offset..(address + n + offset + more).min(all.len())]),
                    // Something else, then more of the dictionary at the same distance.
                    5 => {
                        let skipped = rng.range(1, 3);
                        whole.extend((0..skipped).map(|_| rng.next() as u8));
                        let from = (address + n + skipped).min(all.len());
                        whole.extend_from_slice(&all[from..(from + more).min(all.len())]);
                    }
                    // What is that far back in the input.
                    3 | 4 if whole.len() >= distance => {
                        for _ in 0..more {
                            whole.push(whole[whole.len() - distance]);
                        }
                    }
                    _ => {}
                }
            }
            whole.truncate(offset + len);
            let last = part + 1 == parts;
            let mut params = params.clone();
            if offset != 0 {
                params.push((9, offset as u32));
            }
            let data = &whole[offset..];
            // When a copy goes on into an empty dictionary, the reference reads past its end.
            let out = if dicts.iter().any(Vec::is_empty) {
                rust_stream(data, &params, &dicts, if last { EncoderOperation::Finish } else { EncoderOperation::Flush })
            } else {
                part_in_lock_step(&mut rng, data, &params, &dicts, last)
            };
            stream.extend(out.unwrap_or_else(|e| fail(e, &whole, part, &params)));
        }
        enc::round_trip(&stream, &whole, &dicts, false, rng.next()).unwrap_or_else(|e| fail(e, &whole, parts, &params));
        if !dicts.is_empty() && rng.chance(1, 3) {
            handed_on(&mut rng, &whole[..whole.len().min(200_000)], &params, &dicts).unwrap_or_else(|e| fail(e, &whole, parts, &params));
        }
        totals.0 += whole.len();
        totals.1 += stream.len();
    }
    println!("ok: {iters} iterations, {} -> {}", totals.0, totals.1);
}

/// Every word of the static dictionary, as it is, with its first letter in upper case and all in upper case, or after each
/// of the 121 transforms, each of them an input of its own. The tables in which the Rust encoder looks words up are made
/// when they are first needed, those of the reference are part of its source.
pub fn run_every_word(qualities: u64, all_transforms: bool) {
    const TAILS: [&[u8]; 3] = [b"", b" ", b"ing "];
    let qs = crate::args::qualities(qualities, 2..12);
    let (mut cases, mut total_out) = (0usize, 0usize);
    for len in 4..=24usize {
        for index in 0..1usize << crate::grammar::size_bits(len) {
            // Or Identity, UppercaseFirst and UppercaseAll without prefix or suffix.
            for transform in if all_transforms { (0..121).collect() } else { vec![0, 9, 44] } {
                let word = crate::grammar::dictionary_word(len, index, transform);
                for &q in &qs {
                    for tail in &TAILS[..if all_transforms { 1 } else { 3 }] {
                        let case = EncCase { data: [&word[..], tail].concat(), params: vec![(1, q), (2, 16)], dicts: Vec::new(), schedule: 0, misuse: false };
                        match enc::compare(&case) {
                            Ok(out) => total_out += out.len(),
                            Err(e) => panic!("seed 0: word {index} of length {len}, transform {transform}, quality {q}, {:?}: {e}", String::from_utf8_lossy(&case.data)),
                        }
                        cases += 1;
                    }
                }
            }
        }
    }
    println!("ok: {cases} cases, {total_out} bytes");
}

/// The start of a stream with an offset, call by call: every combination of three operations, each with little input and
/// little room for output. All of these calls are in order, so none may be refused, and the stream has to decode.
pub fn run_flint(qualities: u64) {
    let qs = crate::args::qualities(qualities, 0..12);
    let text: Vec<u8> = (0..200u32).map(|i| b'a' + (i * 7 % 26) as u8).collect();
    let metadata = [0x5Au8; 17];
    let mut cases = 0usize;
    for &q in &qs {
        for offset in [1usize, 77] {
            let params = vec![(1, q), (2, 18)];
            // What the offset stands for, from another encoder.
            let first = rust_stream(&text[..offset], &params, &[], EncoderOperation::Flush).unwrap();
            let params = [&params[..], &[(9, offset as u32)]].concat();
            // (operation, bytes of input, room for output in the first call)
            let mut calls: Vec<[(i32, usize, usize); 3]> = Vec::new();
            for (op1, n1) in [(0, 1), (0, 2), (0, 3), (0, 10), (1, 1), (1, 2), (1, 3), (3, 0), (3, 1)] {
                for op2 in 0..4 {
                    for n2 in [0usize, 1, 16, 17] {
                        for (op3, n3) in [(0, 1), (0, 17), (1, 0), (1, 1), (3, 0), (3, 16), (2, 0), (2, 1)] {
                            for room1 in 0..7 {
                                for room2 in 0..7 {
                                    for room3 in [0usize, 1, 5, 100] {
                                        calls.push([(op1, n1, room1), (op2, n2, room2), (op3, n3, room3)]);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            for sequence in calls {
                let at = |e: String| -> ! { panic!("seed 0: quality {q}, offset {offset}, (operation, input, room) {sequence:?}: {e}") };
                let mut p = enc::Pair::new(&EncCase { data: Vec::new(), params: params.clone(), dicts: Vec::new(), schedule: 0, misuse: false }).unwrap_or_else(|e| at(e));
                let mut pos = offset;
                for (op, n, room) in sequence {
                    if p.is_finished() {
                        break;
                    }
                    let mut input = if op == 3 { &metadata[..n] } else { &text[pos..pos + n] };
                    let mut room = room;
                    loop {
                        let (ok, used) = p.step(op, input, room).unwrap_or_else(|e| at(e));
                        if !ok {
                            at(format!("both refuse operation {op} with {} bytes of input and room for {room}", input.len()));
                        }
                        input = &input[used..];
                        // Process is complete when the input is taken. The others have to hand over their output.
                        if input.is_empty() && (op == 0 || !p.has_more_output()) {
                            break;
                        }
                        room = 1 << 16;
                    }
                    if op != 3 {
                        pos += n;
                    }
                }
                while !p.is_finished() {
                    if !p.step(2, &[], 1 << 16).unwrap_or_else(|e| at(e)).0 {
                        at("both refuse to finish".into());
                    }
                }
                let stream = [&first[..], &p.out].concat();
                enc::round_trip(&stream, &text[..pos], &[], false, cases as u64).unwrap_or_else(|e| at(e));
                cases += 1;
            }
        }
    }
    println!("ok: {cases} cases");
}

/// Bytes that another thread changes while they are read, as JavaScript can do to the buffer of a `write()` that is under
/// way. What comes out is anybody's guess, but it has to be an answer: no panic, no hang, and none of the errors that stand
/// for a bug. A failure cannot be repeated by its seed; the message says where it was.
pub fn run_race(seed0: u64, iters: u64, max_len: usize, qualities: u64, corpus: &r#gen::Corpus) {
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering::Relaxed};
    /// Stops the other thread, also after a panic: the scope waits for it.
    struct Stop<'a>(&'a AtomicBool);
    impl Drop for Stop<'_> {
        fn drop(&mut self) {
            self.0.store(true, Relaxed);
        }
    }
    let qs = crate::args::qualities(qualities, 0..12);
    let (mut encoded, mut refused, mut decoded, mut failed) = (0usize, 0usize, 0usize, 0usize);
    for it in 0..iters {
        let seed = seed0 + it;
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let len = match rng.below(4) {
            0 => rng.range(1, 2000),
            1 => rng.range(1, 40_000),
            _ => rng.range(1, max_len),
        };
        // Two texts that take turns.
        let one = r#gen::data(&mut rng, corpus, len);
        let other: Vec<u8> = match rng.below(5) {
            0 => (0..len).map(|_| rng.next() as u8).collect(),
            1 => vec![rng.next() as u8; len],
            2 => one.iter().map(|b| b ^ 0x20).collect(),
            3 => one.iter().rev().copied().collect(),
            _ => r#gen::data(&mut rng, corpus, len),
        };
        let params = vec![(1, q), (2, rng.range(10, 24) as u32)];
        let streams = [rust_stream(&one, &params, &[], EncoderOperation::Finish).unwrap(), rust_stream(&other, &params, &[], EncoderOperation::Finish).unwrap()];
        let how = rng.below(4);
        let changer = |shared: &[AtomicU8], texts: [&[u8]; 2], stop: &AtomicBool, mut rng: Rng| {
            let n = shared.len();
            while !stop.load(Relaxed) {
                let from = texts[rng.below(2)];
                let (at, most) = (rng.below(n), match how { 0 => 1, 1 => 16, 2 => 1000, _ => n });
                for i in at..(at + rng.range(1, most)).min(n) {
                    shared[i].store(if how == 0 && rng.chance(1, 2) { rng.next() as u8 } else { from[i.min(from.len() - 1)] }, Relaxed);
                }
            }
        };
        // The encoder.
        let shared: Vec<AtomicU8> = one.iter().map(|&b| AtomicU8::new(b)).collect();
        let stop = AtomicBool::new(false);
        let chunk = *rng.pick(&[usize::MAX, usize::MAX, 1 << 16, 5000, 300]);
        let flush = rng.chance(1, 3);
        std::thread::scope(|s| {
            s.spawn(|| changer(&shared, [&one, &other], &stop, Rng(seed ^ 0x5555)));
            let _stop = Stop(&stop);
            // SAFETY: there is none. This is the data race that the test is about.
            let data = unsafe { std::slice::from_raw_parts(shared.as_ptr().cast::<u8>(), shared.len()) };
            for _ in 0..if len < 40_000 { 30 } else { 6 } {
                let mut e = Encoder::new();
                for &(k, v) in &params {
                    assert!(e.set_parameter(EncoderParameter::from_raw(k as u32).unwrap(), v));
                }
                let mut out = Vec::new();
                let mut buf = vec![0u8; 1 << 16];
                let mut pieces = data.chunks(chunk).peekable();
                'stream: loop {
                    let mut piece = pieces.next().unwrap_or(&[]);
                    let op = if pieces.peek().is_none() { EncoderOperation::Finish } else if flush { EncoderOperation::Flush } else { EncoderOperation::Process };
                    loop {
                        let mut o: &mut [u8] = &mut buf;
                        if let Err(e) = e.compress_stream(op, &mut piece, &mut o) {
                            println!("seed {seed}: quality {q}, {len} bytes, chunk {chunk}, flush {flush}: the encoder says {e:?}");
                            refused += 1;
                            break 'stream;
                        }
                        let made = (1 << 16) - o.len();
                        out.extend_from_slice(&buf[..made]);
                        if piece.is_empty() && !e.has_more_output() {
                            break;
                        }
                    }
                    if op == EncoderOperation::Finish {
                        break;
                    }
                }
                encoded += 1;
                // All at once: with room for the largest result, it cannot fail.
                let mut whole = vec![0u8; bun_brotli::max_compressed_size(len).unwrap()];
                let n = bun_brotli::compress(q as i32, params[1].1 as i32, bun_brotli::EncoderMode::Generic, data, &mut whole);
                assert!(n.is_some(), "seed {seed}: quality {q}, {len} bytes: compress fails");
                // It need not be a valid stream.
                let mut d = Decoder::new();
                let mut input = &out[..];
                loop {
                    let mut o: &mut [u8] = &mut buf;
                    match d.decompress_stream(&mut input, &mut o) {
                        DecoderResult::NeedsMoreOutput => {}
                        DecoderResult::Error => {
                            assert!(d.error_code() as i32 != -31, "seed {seed}: unreachable");
                            break;
                        }
                        _ => break,
                    }
                }
            }
        });
        // The decoder.
        let n = streams[0].len().max(streams[1].len());
        let shared: Vec<AtomicU8> = (0..n).map(|i| AtomicU8::new(*streams[0].get(i).unwrap_or(&0))).collect();
        let stop = AtomicBool::new(false);
        let n_in = *rng.pick(&[usize::MAX, usize::MAX, 4096, 100, 3]);
        let room = *rng.pick(&[1 << 16, 1 << 16, 1000, 7]);
        std::thread::scope(|s| {
            s.spawn(|| changer(&shared, [&streams[0], &streams[1]], &stop, Rng(seed ^ 0x3333)));
            let _stop = Stop(&stop);
            // SAFETY: as above.
            let data = unsafe { std::slice::from_raw_parts(shared.as_ptr().cast::<u8>(), shared.len()) };
            let mut buf = vec![0u8; room];
            for _ in 0..if len < 40_000 { 30 } else { 6 } {
                let mut d = Decoder::new();
                let mut pos = 0usize;
                let mut total = 0usize;
                loop {
                    let end = pos.saturating_add(n_in).min(n);
                    let mut input = &data[pos..end];
                    let mut o: &mut [u8] = &mut buf;
                    let r = d.decompress_stream(&mut input, &mut o);
                    pos = end - input.len();
                    total += room - o.len();
                    match r {
                        DecoderResult::Success => break,
                        DecoderResult::Error => {
                            assert!(d.error_code() as i32 != -31, "seed {seed}: unreachable");
                            failed += 1;
                            break;
                        }
                        DecoderResult::NeedsMoreInput if pos == n => break,
                        _ => {}
                    }
                    // A changed stream can be a bomb.
                    if total > 64 << 20 {
                        break;
                    }
                }
                decoded += 1;
            }
        });
    }
    assert!(refused == 0, "seed {seed0}: the encoder failed {refused} times");
    println!("ok: {encoded} streams encoded, {decoded} decoded, {failed} of them with an error");
}

/// The table of the hashers of qualities 5 to 9 changes while a stream goes on: it gets room for all buckets after 1 KiB,
/// and at qualities 5 and 6 a block for every bucket after 16 and 32 KiB. That shows only in streams with flushes before
/// that point. Here the start of the input fills few, many or nearly all buckets, and what follows is made of pieces of it,
/// each of which is found only if its bucket still has its own block.
pub fn run_dense(seed0: u64, iters: u64, qualities: u64) {
    let qs = crate::args::qualities(qualities, 5..10);
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let mark = match q {
            5 | 6 if rng.chance(3, 4) => 16384 << (q - 5),
            _ => 1024,
        };
        let before = match rng.below(4) {
            0 => mark - rng.below(8),
            1 => mark - rng.below(200),
            2 => mark + rng.below(8),
            _ => rng.range(8, mark),
        };
        let kind = rng.below(5);
        let mut first: Vec<u8> = Vec::with_capacity(before);
        let symbols = rng.range(2, 6) as u64;
        let mut used = vec![false; 1 << 14];
        while first.len() < before {
            let byte = match kind {
                // Few buckets.
                0 => b'a' + (rng.next() % symbols) as u8,
                // A new bucket with every position, while there are any.
                1 | 2 if first.len() >= 3 => {
                    let start = rng.next() as u8;
                    let low = u32::from_le_bytes([first[first.len() - 3], first[first.len() - 2], first[first.len() - 1], 0]);
                    let bucket = |b: u8| ((low | u32::from(b) << 24).wrapping_mul(0x1E35_A7BD) >> 18) as usize;
                    let b = (0..=255u8).map(|i| start.wrapping_add(i)).find(|&b| !used[bucket(b)]).unwrap_or(start);
                    used[bucket(b)] = true;
                    b
                }
                _ => rng.next() as u8,
            };
            first.push(byte);
        }
        let mut data = first.clone();
        let more = if rng.chance(1, 4) { rng.range(1, 300) } else { rng.range(300, 3 * mark.max(8192)) };
        let sorted = rng.chance(1, 4);
        let mut at = 0;
        while data.len() < before + more {
            let n = rng.range(4, 24).min(before);
            at = if sorted { (at + n + rng.below(8)) % (before - n + 1) } else { rng.below(before - n + 1) };
            data.extend_from_slice(&first[at..at + n]);
            data.extend((0..rng.below(3)).map(|_| rng.next() as u8));
        }
        let mut params = vec![(1, q), (2, rng.range(17, 24) as u32)];
        if rng.chance(1, 8) {
            params.push((5, *rng.pick(&[data.len() as u32, mark as u32])));
        }
        for _ in 0..3 {
            let style = rng.below(4);
            let (mut steps, mut pos) = (Vec::new(), 0usize);
            while pos < data.len() && steps.len() < 4000 {
                let to_mark = mark.saturating_sub(pos);
                let n = match style {
                    _ if pos.abs_diff(mark) < 10 => rng.range(1, 4),
                    // All that comes before the mark at once.
                    0 if to_mark > 0 => to_mark.saturating_sub(rng.below(10)).max(1),
                    1 => rng.range(1, 400),
                    2 => rng.range(1, 5000),
                    _ => rng.range(1, mark),
                }
                .min(data.len() - pos);
                pos += n;
                steps.push(enc::Step { op: i32::from(rng.chance(7, 8)), n });
            }
            let case = EncCase { data: data.clone(), params: params.clone(), dicts: Vec::new(), schedule: if rng.chance(1, 2) { 0 } else { rng.next() | 1 }, misuse: false };
            match enc::compare_steps(&case, &steps).and_then(|out| enc::round_trip(&out, &data, &[], false, 0).map(|()| out)) {
                Ok(out) => {
                    total_in += data.len();
                    total_out += out.len();
                }
                Err(e) => {
                    let head: Vec<_> = steps.iter().take(12).map(|s| (s.op, s.n)).collect();
                    panic!("seed {seed}: {e}\nmark {mark}, {before} bytes of kind {kind}, then {more}; params {params:?} schedule {} steps {} {head:?}", case.schedule, steps.len());
                }
            }
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}

/// The rolling hasher, which a large window adds to the hashers of qualities 3 to 9, finds chunks of 32 bytes from far back,
/// and starts anew with every block of input. Here blocks of about 32 bytes repeat chunks that only it still knows, and that
/// are among the 64th part that it stores. Now and then the block starts just before the end of the ring buffer, where it
/// does not start anew.
pub fn run_rolling(seed0: u64, iters: u64, qualities: u64) {
    let qs = crate::args::qualities(qualities, 3..10);
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        // One in 8 is at the end of the ring buffer: each of qualities 3 to 5, with the block 28 to 36 bytes before the end,
        // and 30 to 34 bytes long, in turn.
        let turn = seed as usize / 8;
        let at_ring_end = seed % 8 == 0 && qs.contains(&(3 + turn as u32 % 3));
        let q = if at_ring_end { 3 + turn as u32 % 3 } else { *rng.pick(&qs) };
        let jump = if q < 5 { 4 } else { 1 };
        let mut noise = |n: usize| -> Vec<u8> { (0..n.div_ceil(8)).flat_map(|_| rng.next().to_le_bytes()).take(n).collect() };
        // More positions than the other hasher holds.
        let forgotten = 3 * match q {
            3 => 1 << 17,
            4 => 1 << 20,
            _ => 1usize << (15 + q - 1),
        };
        let ring = 1usize << 26;
        let lead = if at_ring_end { ring - forgotten.max(8 << 20) - (1 << 18) } else { seed as usize % 5 };
        let mut data = noise(lead);
        let source_at = data.len();
        data.extend(noise(1 << 18));
        let filler = noise(if at_ring_end { ring - data.len() - 64 } else { forgotten });
        data.extend(filler);
        let mut rng = Rng(seed ^ 0x77);
        // Where the chunks are whose hash is stored.
        let stored: Vec<usize> = ((source_at + 4).next_multiple_of(jump)..source_at + (1 << 18) - 200)
            .step_by(jump)
            .filter(|&at| data[at..at + 32].iter().step_by(jump).fold(0u32, |state, &b| state.wrapping_mul(69069).wrapping_add(u32::from(b) + 1)) & ((1 << 30) - 1) < 1 << 24)
            .collect();
        let mut steps = vec![enc::Step { op: 1, n: data.len() }];
        for trial in 0..if at_ring_end { 40 } else { 300 } {
            // Other bytes, so that blocks start at all positions modulo `jump`, and near the end of the ring buffer at each.
            let first = at_ring_end && trial == 0;
            let gap = if first { 64 - (28 + turn / 3 % 9) } else { rng.below(6) };
            if gap != 0 {
                data.extend((0..gap).map(|_| rng.next() as u8));
                steps.push(enc::Step { op: 1, n: gap });
            }
            let at = *rng.pick(&stored);
            // The chunk has to be at a multiple of `jump` again.
            let before = (jump - data.len() % jump) % jump;
            let n = before + if first { 30 + turn / 27 % 5 } else if rng.chance(3, 4) { rng.range(30, 36) } else { rng.range(4, 100) };
            data.extend_from_within(at - before..at - before + n);
            steps.push(enc::Step { op: i32::from(first || rng.chance(7, 8)), n });
        }
        let params = vec![(6, 1), (1, q), (2, 25 + u32::from(!at_ring_end) * (seed % 3) as u32), (5, 1 << 20)];
        let case = EncCase { data, params, dicts: Vec::new(), schedule: 0, misuse: false };
        match enc::compare_steps(&case, &steps).and_then(|out| enc::round_trip(&out, &case.data, &[], true, 0).map(|()| out)) {
            Ok(out) => {
                total_in += case.data.len();
                total_out += out.len();
            }
            Err(e) => panic!("seed {seed}: {e}\nparams {:?}, {} bytes, at the end of the ring buffer: {at_ring_end}", case.params, case.data.len()),
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}

/// The hasher of qualities 10 and 11 adds the last 127 positions of a block when the next block is there, and goes no
/// further back for them than the window reaches from the start of that block. Here a sequence from as far back as a copy
/// can reach is only found by way of such positions: it starts with 4 equal bytes, and a longer run of that byte, which a
/// flush cuts in two, leads up to its repetition.
pub fn run_stitch(seed0: u64, iters: u64, qualities: u64) {
    let qs = crate::args::qualities(qualities, 10..12);
    let (mut total_in, mut total_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let lgwin = rng.range(10, 14);
        let most = (1usize << lgwin) - 16;
        let c = rng.range(1, 254) as u8;
        // Sorts before or after the run.
        let mut tail: Vec<u8> = (0..40).map(|_| rng.next() as u8).collect();
        tail[0] = if rng.chance(1, 2) { rng.below(usize::from(c)) } else { rng.range(usize::from(c) + 1, 255) } as u8;
        // How much longer the run is the second time, and how far back the first one is from where the two are the same.
        let longer = if rng.chance(1, 2) { rng.range(1, 4) } else { rng.range(1, 140) };
        let distance = match rng.below(8) {
            0..=2 => most,
            3 => most - 1,
            4 => most - 2,
            5 => most + 1,
            _ => most - rng.below(60),
        };
        let other = |rng: &mut Rng, n: usize| -> Vec<u8> { (0..n).map(|_| { let b = rng.next() as u8; if b == c { c ^ 1 } else { b } }).collect() };
        let lead = rng.below(300);
        let mut data = other(&mut rng, lead);
        let first = data.len();
        data.extend_from_slice(&[c; 4]);
        data.extend_from_slice(&tail);
        let filler = first + distance - longer - data.len();
        data.extend(other(&mut rng, filler));
        let run = data.len();
        data.extend(std::iter::repeat_n(c, longer + 4));
        data.extend_from_slice(&tail[..rng.range(4, 40)]);
        // A position is only added once 127 more bytes are there.
        let rest = rng.range(100, 300);
        data.extend(other(&mut rng, rest));
        // The flush is within the run, or near it.
        let cut = if rng.chance(3, 4) { run + rng.range(1, longer) } else { run + longer + 4 - rng.below(140.min(run)) };
        let mut steps = Vec::new();
        if rng.chance(1, 3) {
            steps.push(enc::Step { op: 1, n: rng.range(1, run - 150) });
        }
        steps.push(enc::Step { op: 1, n: cut - steps.first().map_or(0, |s: &enc::Step| s.n) });
        let case = EncCase { data, params: vec![(1, q), (2, lgwin as u32)], dicts: Vec::new(), schedule: 0, misuse: false };
        match enc::compare_steps(&case, &steps).and_then(|out| enc::round_trip(&out, &case.data, &[], false, 0).map(|()| out)) {
            Ok(out) => {
                total_in += case.data.len();
                total_out += out.len();
            }
            Err(e) => panic!("seed {seed}: {e}\nparams {:?}, distance {distance} of {most}, run longer by {longer}, flush {} bytes into it", case.params, cut as isize - run as isize),
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}

/// Whether the encoder writes anything when it has `data[..end]`, of which `data[..flushed]` was flushed, and a byte more.
fn writes_meta_block(params: &[(i32, u32)], data: &[u8], flushed: usize, end: usize) -> bool {
    let mut e = Encoder::new();
    for &(k, v) in params {
        assert!(e.set_parameter(EncoderParameter::from_raw(k as u32).unwrap(), v));
    }
    let mut buf = vec![0u8; 1 << 20];
    let mut made = 0;
    for (op, mut input) in [(EncoderOperation::Flush, &data[..flushed]), (EncoderOperation::Process, &data[flushed..end + 1])] {
        made = 0;
        loop {
            let mut o: &mut [u8] = &mut buf;
            e.compress_stream(op, &mut input, &mut o).unwrap();
            made += (1 << 20) - o.len();
            if input.is_empty() && !e.has_more_output() {
                break;
            }
        }
    }
    made != 0
}

/// At the end of a block of input the encoder either writes a meta-block or goes on with the next block in the same one. It
/// writes when there are as many literals, or commands, as an eighth of the largest meta-block, and at qualities 2 and 3
/// when the two add up to 12,287. Here the numbers go past those limits in steps of one.
pub fn run_merge(qualities: u64) {
    const BLOCK: usize = 1 << 16;
    let qs = crate::args::qualities(qualities, 2..12);
    let mut rng = Rng(1);
    let noise: Vec<u8> = (0..8 * BLOCK).map(|_| rng.next() as u8).collect();
    let mut cases = 0usize;
    let mut check = |what: &str, data: Vec<u8>, params: Vec<(i32, u32)>, steps: &[enc::Step]| {
        let case = EncCase { data, params, dicts: Vec::new(), schedule: 0, misuse: false };
        if let Err(e) = enc::compare_steps(&case, steps).and_then(|out| enc::round_trip(&out, &case.data, &[], false, 0)) {
            panic!("seed 0: {what}, params {:?}: {e}", case.params);
        }
        cases += 1;
    };
    for &q in &qs {
        // 40 literals and a copy of 8 bytes, over and over: after 64 literals in a row the encoder would no longer look at every
        // position. Then one long copy to the end of the block, and another block.
        for lgwin in [12u32, 16, 17, 22] {
            let limit = if q < 4 { 0x2FFF } else { (2usize << lgwin.max(16)) / 8 };
            // Qualities 2 and 3 have blocks of 16 KiB, and with a small window a lower limit for the literals alone.
            if limit >= BLOCK / 2 || (q < 4 && lgwin < 16) {
                continue;
            }
            let params = vec![(1, q), (2, lgwin)];
            let build = |literals: usize| -> Vec<u8> {
                let mut data = Vec::with_capacity(2 * BLOCK);
                for unit in noise[..literals].chunks(40) {
                    data.extend_from_slice(unit);
                    if unit.len() == 40 {
                        data.extend_from_within(data.len() - 30..data.len() - 22);
                    }
                }
                data.resize(BLOCK, 0);
                data.extend_from_slice(&noise[2 * BLOCK..2 * BLOCK + 3000]);
                data.extend_from_slice(&[7; 5000]);
                data
            };
            // At qualities 2 and 3 the commands count as well.
            let about = if q < 4 { limit * 40 / 41 } else { limit };
            assert!(!writes_meta_block(&params, &build(about - 50), 0, BLOCK), "seed 0: quality {q}: too many literals");
            assert!(writes_meta_block(&params, &build(about + 20), 0, BLOCK), "seed 0: quality {q}: too few literals");
            for literals in about - 50..about + 20 {
                check(&format!("{literals} literals"), build(literals), params.clone(), &[]);
            }
        }
        // Commands: copies of 4 or 5 bytes from the last 16,000 bytes (from further back they are too short to be worth it), and
        // nothing between them. The last of the fifth block give way to a single long copy.
        if !(5..=8).contains(&q) {
            continue;
        }
        let params = vec![(1, q), (2, 18)];
        for seed in 2..6 {
            let mut rng = Rng(seed);
            let mut whole = noise[..BLOCK].to_vec();
            let mut starts = Vec::new();
            while whole.len() < 8 * BLOCK {
                if whole.len() < 6 * BLOCK {
                    starts.push(whole.len());
                }
                let n = if rng.chance(1, 8) { 4 } else { 5 };
                let from = whole.len() - 8 - rng.below(16_000);
                whole.extend_from_within(from..from + n);
            }
            let build = |fewer: usize| -> Vec<u8> {
                let mut data = whole.clone();
                data[starts[starts.len() - 1 - fewer]..6 * BLOCK].fill(0);
                data
            };
            let writes = |data: &[u8], blocks: usize| writes_meta_block(&params, data, BLOCK, (blocks + 1) * BLOCK);
            let (mut low, mut high) = (0usize, 12_000usize);
            assert!(!writes(&build(low), 4), "seed 0: quality {q}: too many commands in four blocks");
            assert!(writes(&build(low), 5), "seed 0: quality {q}: too few commands in five blocks");
            assert!(!writes(&build(high), 5), "seed 0: quality {q}: something else ends the meta-block");
            while high - low > 1 {
                let middle = (low + high) / 2;
                if writes(&build(middle), 5) { low = middle } else { high = middle }
            }
            for fewer in low.saturating_sub(4)..high + 4 {
                check(&format!("{fewer} copies fewer (the limit is between {low} and {high})"), build(fewer), params.clone(), &[enc::Step { op: 1, n: BLOCK }]);
            }
        }
    }
    println!("ok: {cases} cases");
}

/// The bank that the hashers of small windows keep the position of these 4 bytes in, if they have 512 banks.
fn bank_of(key: [u8; 4]) -> u32 {
    (u32::from_le_bytes(key).wrapping_mul(0x1E35_A7BD) >> 17) & 511
}

/// Qualities 5 to 9 with windows of up to 64 KiB, where the hasher keeps chains of positions whose nodes come from banks
/// of slots, and a bank that is full takes the slot of its oldest node.
pub fn run_chain(seed0: u64, iters: u64, qualities: u64, corpus: &r#gen::Corpus) {
    let qs = crate::args::qualities(qualities, 5..10);
    let mut totals = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let mut lgwin = if rng.chance(1, 2) { 16 } else { rng.range(10, 16) };
        // How many nodes of a chain the search looks at.
        let hops = (if q > 6 { 7 } else { 8 }) << (q - 4);
        // From `lo` to `hi` random bytes.
        let random = |rng: &mut Rng, lo: usize, hi: usize| -> Vec<u8> { (0..rng.range(lo, hi)).map(|_| rng.next() as u8).collect() };
        // In a long stretch of literals the hasher adds 5 positions in 17. After a run every position is looked at again.
        let run = |rng: &mut Rng, data: &mut Vec<u8>, next: u8| {
            let c = rng.next() as u8;
            data.extend(std::iter::repeat_n(if c == next { c ^ 1 } else { c }, 48));
        };
        // More positions than a bank of 65536 slots has, so that the slots are in use for the second time or later.
        let mut data = match rng.below(3) {
            0 => {
                let n = rng.range(66_000, 200_000);
                r#gen::data(&mut rng, corpus, n)
            }
            1 => random(&mut rng, 0, 300),
            _ => Vec::new(),
        };
        match rng.below(5) {
            // The one long match is the node at which the search ends, or the one before or after it.
            0 => {
                let after = hops + rng.range(0, 4) - 3;
                while (1usize << lgwin) - 16 < (after + 2) * 6 + 60 {
                    lgwin += 1;
                }
                let window = (1usize << lgwin) - 16;
                let key = random(&mut rng, 4, 4);
                let target = random(&mut rng, 6, 40);
                // Not so many literals that positions are left out.
                let most = ((window - 4 - target.len()) / (after + 1) - 4).min(if q < 9 { 60 } else { 500 });
                let gap = if rng.chance(1, 2) { rng.range(2, most.min(12)) } else { rng.range(2, most) };
                run(&mut rng, &mut data, key[0]);
                data.extend_from_slice(&key);
                data.extend_from_slice(&target);
                for _ in 0..after {
                    data.extend_from_slice(&key);
                    let at = data.len();
                    let least = if rng.chance(1, 2) { gap } else { 2 };
                    data.extend(random(&mut rng, least, gap));
                    if data[at] == target[0] {
                        data[at] ^= 1;
                    }
                }
                data.extend_from_slice(&key);
                data.extend_from_slice(&target);
                data.extend(random(&mut rng, 0, 40));
            }
            // Records of one length that start with one of a few keys from the same bank. By the end of a chain the bank
            // has given its slots to newer nodes, of this chain or another one, and the search goes on from there. What it
            // comes by are starts of records again, and which of them it sees decides how long the copy is.
            1 => {
                let bank = rng.below(512) as u32;
                let mut keys = Vec::new();
                let wanted = rng.range(3, 8);
                while keys.len() < wanted {
                    let key = (rng.next() as u32).to_le_bytes();
                    if bank_of(key) == bank {
                        keys.push(key);
                    }
                }
                let body = rng.range(1, 12);
                let bodies: Vec<Vec<u8>> = (0..rng.range(2, 5)).map(|_| random(&mut rng, body, body)).collect();
                for _ in 0..rng.range(1000, 160_000 / (4 + body)) {
                    data.extend_from_slice(rng.pick(&keys));
                    data.extend_from_slice(rng.pick(&bodies));
                    // Now and then the records move.
                    if rng.chance(1, 3000) {
                        data.push(rng.next() as u8);
                    }
                }
            }
            // A match as far back as the window allows, or with more than 65535 positions since the one before in its
            // chain.
            2 => {
                let window = (1usize << lgwin) - 16;
                let piece = random(&mut rng, 5, 40);
                for _ in 0..rng.range(1, 4) {
                    let distance = match rng.below(6) {
                        0 | 1 => window + 1 - rng.below(4),
                        2 => 65533 + rng.below(6),
                        3 => 65536 + rng.below(70_000),
                        _ => rng.range(piece.len(), window),
                    };
                    data.extend_from_slice(&piece);
                    data.extend(random(&mut rng, distance - piece.len(), distance - piece.len()));
                }
                data.extend_from_slice(&piece);
                data.extend(random(&mut rng, 0, 40));
            }
            // A node has 16 bits for how far back the one before it in the chain is. With more than that, or nothing,
            // before it, the search ends there. If the node had the low 16 bits, the search would go on at a multiple of
            // 65536 after the one before, or where the position ends in 0xCCCC. There is the long match, in a long stretch of
            // literals, so that the hasher does not know it.
            3 => {
                let window = (1usize << lgwin) - 16;
                let key = random(&mut rng, 4, 4);
                let target = random(&mut rng, 12, 40);
                let hidden = if data.len() > 300 || rng.chance(1, 2) {
                    run(&mut rng, &mut data, key[0]);
                    let before = data.len();
                    data.extend_from_slice(&key);
                    before + if rng.chance(1, 4) { 2 << 16 } else { 1 << 16 }
                } else {
                    0xCCCC
                };
                // In about half of the cases something from here gets into the same chain, and nothing is tested.
                let filler = hidden - data.len();
                data.extend(random(&mut rng, filler, filler));
                data.extend_from_slice(&key);
                data.extend_from_slice(&target);
                let most = ((window - 300) / 2).min(if rng.chance(1, 2) { 100 } else { 3000 });
                data.extend(random(&mut rng, 20, most));
                run(&mut rng, &mut data, key[0]);
                data.extend_from_slice(&key);
                data.push(target[0] ^ 1);
                data.extend(random(&mut rng, 0, most));
                run(&mut rng, &mut data, key[0]);
                data.extend_from_slice(&key);
                data.extend_from_slice(&target);
                data.extend(random(&mut rng, 0, 40));
            }
            // Few different bytes: few chains, all of them long.
            _ => {
                let letters = rng.range(2, 6);
                let n = r#gen::length(&mut rng, 200_000);
                data.extend((0..n).map(|_| b'a' + (rng.below(letters).min(rng.below(letters))) as u8));
            }
        }
        let mut params = vec![(1, q), (2, lgwin as u32)];
        if rng.chance(1, 4) {
            params.push((3, rng.range(16, 20) as u32));
        }
        if rng.chance(1, 4) {
            params.push((0, rng.range(1, 2) as u32));
        }
        let mut dicts = Vec::new();
        if rng.chance(1, 5) && data.len() > 100 {
            for _ in 0..rng.range(1, 2) {
                let at = rng.below(data.len() - 50);
                let n = rng.range(8, (data.len() - at).min(100_000));
                dicts.push(data[at..at + n].to_vec());
            }
        }
        check("chain", seed, &mut rng, &data, &params, &dicts, &mut totals);
    }
    println!("ok: {iters} iterations, {} -> {}", totals.0, totals.1);
}

/// The words of 7 bytes and more that an encoder of quality `q` finds in the static dictionary. Below quality 10 its table
/// knows 4 in 10 of them, and qualities 2 and 3 find next to nothing.
fn words_found(q: u32) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    let mut out = [0u8; 200];
    for len in 7..=24 {
        for index in 0..1usize << crate::grammar::size_bits(len) {
            let mut data = vec![0xFE; 2];
            data.extend(crate::grammar::dictionary_word(len, index, 0));
            data.extend_from_slice(&[0xFF; 16]);
            // 13 to 15 bytes with the word from the dictionary. As literals, all but a few in a thousand take 19 and more.
            if bun_brotli::compress(q as i32, 16, bun_brotli::EncoderMode::Generic, &data, &mut out).unwrap() <= 15 {
                found.push((len, index));
            }
        }
    }
    found
}

/// Dictionaries of almost 64 MiB in all. The distances into them, and to the words of the static dictionary, which come
/// after them, get to the largest distance that there is a code for: 2^26 - 4 and the number of direct codes, without a
/// large window. The window is not full, so all of these distances grow with the position.
pub fn run_reach(seed: u64, qualities: u64) {
    let mut rng = Rng(seed);
    let total = (1usize << 26) - 4 - 40_000;
    let dictionary: Vec<u8> = (0..total).map(|_| b'0' + (rng.next() & 63) as u8).collect();
    let mut dicts = Vec::new();
    let mut rest = &dictionary[..];
    // The copies below are from the first 8000 bytes or so.
    for _ in 0..seed % 3 {
        let (chunk, tail) = rest.split_at(rng.range(1, 4000));
        dicts.push(chunk.to_vec());
        rest = tail;
    }
    dicts.push(rest.to_vec());
    let direct = if seed % 2 == 0 { 0 } else { rng.range(1, 15) };
    for q in crate::args::qualities(qualities, 2..12) {
        // At this position the first byte of the dictionaries is as far back as it gets.
        let edge = 40_000 + if q >= 4 { direct } else { 0 };
        // A copy of `n` bytes at the distance `period`, so that the encoder looks at every position after it, and a byte
        // that an earlier one does not go on with.
        let mark = |rng: &mut Rng, data: &mut Vec<u8>, period: usize, n: usize| {
            let start = data.len();
            data.extend((0..period).map(|_| 0x80 | rng.next() as u8));
            data[start] = 0x80 | data[start + period - 1].wrapping_add(1);
            for i in start..start + n {
                data.push(data[i]);
            }
            data.push(0x80 | data[data.len() - period].wrapping_add(1 + (rng.next() % 126) as u8));
        };
        let mut data = Vec::new();
        // The static dictionary is given up on when fewer than 1 lookup in 128 finds something. Where there is a copy,
        // there is no lookup.
        let words = words_found(q);
        mark(&mut rng, &mut data, 1, 30_000);
        while data.len() < edge - 2200 && !words.is_empty() {
            let &(len, index) = rng.pick(&words);
            data.extend(crate::grammar::dictionary_word(len, index, 0));
            data.push(0x80 | rng.next() as u8);
        }
        // Words that are the last one within reach, or next to it.
        let mut placed = 0;
        loop {
            mark(&mut rng, &mut data, 1, 12);
            let Some(reach) = (edge - 1).checked_sub(data.len()) else { break };
            let near: Vec<(usize, usize)> = words.iter().copied().filter(|&(_, index)| index + 2 >= reach && index <= reach + 2).collect();
            let last: Vec<(usize, usize)> = near.iter().copied().filter(|&(_, index)| index == reach).collect();
            if !near.is_empty() {
                let from = if last.is_empty() || rng.chance(1, 2) { &near } else { &last };
                let &(len, index) = rng.pick(from);
                data.extend(crate::grammar::dictionary_word(len, index, 0));
                placed += usize::from(index == reach);
            }
        }
        // Copies from the dictionaries at the largest distance, or next to it. Before each, four others, or this distance
        // would be tried for being close to one of the last, whatever it is.
        for _ in 0..60 {
            for period in [1, 2, 3, 5] {
                mark(&mut rng, &mut data, period, 24);
            }
            let address = (data.len() - edge + 2).saturating_sub(rng.below(5));
            data.extend_from_slice(&dictionary[address..address + rng.range(7, 40)]);
        }
        mark(&mut rng, &mut data, 1, 12);
        let mut params = vec![(1, q), (2, rng.range(16, 24) as u32)];
        if direct != 0 {
            params.push((8, direct as u32));
        }
        let case = EncCase { data, params, dicts: dicts.clone(), schedule: 0, misuse: false };
        let out = enc::compare(&case).and_then(|out| enc::round_trip(&out, &case.data, &dicts, false, 0).map(|()| out)).unwrap_or_else(|e| panic!("seed {seed} quality {q}: {e}\nparams {:?}", case.params));
        println!("quality {q}: {} -> {}, {} words known, {placed} of them put where they are the last within reach", case.data.len(), out.len(), words.len());
    }
}

/// Qualities 10 and 11 tell UTF-8 from other data, by whether more than three quarters of the bytes of a meta-block belong to
/// well-formed characters, and write the answer to the stream. Here it depends on the first or the last character of a
/// length, on what is just not a character, on a few bytes more or less, or on a character that is cut.
pub fn run_utf8(seed0: u64, iters: u64, qualities: u64) {
    const EDGES: [&[u8]; 34] = [
        &[0x00],
        &[0x01],
        &[0x7F],
        &[0x80],
        &[0xBF],
        &[0xC0, 0x80],
        &[0xC1, 0xBF],
        &[0xC2, 0x80],
        &[0xC2, 0x7F],
        &[0xC2, 0xC0],
        &[0xDF, 0x80],
        &[0xDF, 0xBF],
        &[0xE0, 0x80, 0x80],
        &[0xE0, 0x9F, 0xBF],
        &[0xE0, 0xA0, 0x80],
        &[0xE0, 0xA0, 0x7F],
        &[0xE0, 0xA0, 0xC0],
        &[0xE0, 0x7F, 0x80],
        &[0xE0, 0xC0, 0x80],
        &[0xEF, 0xBF, 0xBF],
        &[0xF0, 0x80, 0x80, 0x80],
        &[0xF0, 0x8F, 0xBF, 0xBF],
        &[0xF0, 0x90, 0x80, 0x80],
        &[0xF0, 0x90, 0x80, 0x7F],
        &[0xF0, 0x90, 0x80, 0xC0],
        &[0xF0, 0x90, 0x7F, 0x80],
        &[0xF0, 0x90, 0xC0, 0x80],
        &[0xF0, 0x7F, 0x80, 0x80],
        &[0xF0, 0xC0, 0x80, 0x80],
        &[0xF4, 0x8F, 0xBF, 0xBF],
        &[0xF4, 0x90, 0x80, 0x80],
        &[0xF7, 0xBF, 0xBF, 0xBF],
        &[0xF8, 0x88, 0x80, 0x80],
        &[0xFF],
    ];
    let qs = crate::args::qualities(qualities, 10..12);
    let mut totals = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        if rng.chance(1, 8) {
            // A character that the end of a meta-block cuts does not count, even if what comes after it in the ring buffer,
            // which was written a lap before, completes it. With it, more than three quarters would be UTF-8. Or nothing is
            // cut, exactly three quarters are UTF-8, and a letter comes after the end.
            let lap = 2usize << 16;
            let unit: &[u8] = *rng.pick(&[&[0xC2, 0x80][..], &[0xE0, 0xA0, 0x80], &[0xF0, 0x90, 0x80, 0x80]]);
            let cut = rng.below(unit.len());
            let units = 3 * rng.range(1, 13);
            let others = units * unit.len() / 3 + if cut == 0 { 0 } else { rng.below(unit.len()) } - cut;
            let mut pieces: Vec<&[u8]> = vec![unit; units];
            pieces.resize(units + others, &[0xFF]);
            for i in (1..pieces.len()).rev() {
                pieces.swap(i, rng.below(i + 1));
            }
            pieces.push(&unit[..cut]);
            let last = pieces.concat();
            let end = lap + rng.range(last.len() + 8, 60_000);
            let block: Vec<u8> = (0..64).map(|_| rng.next() as u8).collect();
            let mut data: Vec<u8> = block.iter().copied().cycle().take(end - last.len()).collect();
            let after: &[u8] = if cut == 0 { b"a" } else { &unit[cut..] };
            data[end - lap..end - lap + after.len()].copy_from_slice(after);
            data.extend_from_slice(&last);
            let steps = [Step { op: 1, n: end - last.len() }, Step { op: 1, n: last.len() }];
            let params = vec![(1, q), (2, rng.range(10, 16) as u32)];
            for schedule in [0, rng.next() | 1] {
                let case = EncCase { data: data.clone(), params: params.clone(), dicts: Vec::new(), schedule, misuse: false };
                match enc::compare_steps(&case, &steps).and_then(|out| enc::round_trip(&out, &data, &[], false, 0).map(|()| out)) {
                    Ok(out) => {
                        totals.0 += data.len();
                        totals.1 += out.len();
                    }
                    Err(e) => panic!("seed {seed} schedule {schedule}: {e}\nlen {} params {params:?}, the last {} bytes are a meta-block", data.len(), last.len()),
                }
            }
            continue;
        }
        let most = if rng.chance(1, 4) { 100_000 } else { 2000 };
        let len = rng.range(16, most);
        let mut data = Vec::new();
        if rng.chance(2, 3) {
            // The same few bytes again and again, and 10 to 20 % of bytes that are not part of any character.
            let unit: Vec<u8> = if rng.chance(1, 2) {
                rng.pick(&EDGES).to_vec()
            } else {
                let first = rng.next() as u8;
                let more = match first {
                    0xC0..=0xDF => 1,
                    0xE0..=0xEF => 2,
                    0xF0..=0xFF => 3,
                    _ => rng.below(4),
                };
                let mut unit = vec![first];
                unit.extend((0..more).map(|_| *rng.pick(&[0x7F, 0x80, 0x81, 0x8F, 0x90, 0x9F, 0xA0, 0xBF, 0xC0])));
                unit
            };
            let percent = rng.range(10, 20);
            let mut others = 0;
            while data.len() < len {
                data.extend_from_slice(&unit);
                if others * 100 < percent * data.len() {
                    data.push(0xFF);
                    others += 1;
                }
            }
        } else {
            // About three quarters.
            let unit: &[u8] = *rng.pick(&[&b"a"[..], &[0xC2, 0x80], &[0xE0, 0xA0, 0x80], &[0xF0, 0x90, 0x80, 0x80]]);
            let wanted = if rng.chance(1, 2) { len * 3 / 4 + rng.below(7) - 3 } else { len * rng.range(700, 800) / 1000 };
            let units = wanted / unit.len();
            let mut pieces: Vec<&[u8]> = vec![unit; units];
            pieces.resize(units + len - units * unit.len(), &[0xFF]);
            for i in (1..pieces.len()).rev() {
                pieces.swap(i, rng.below(i + 1));
            }
            data = pieces.concat();
        }
        let mut params = vec![(1, q), (2, rng.range(10, 24) as u32)];
        if rng.chance(1, 4) {
            params.push((0, rng.range(1, 2) as u32));
        }
        check("utf8", seed, &mut rng, &data, &params, &[], &mut totals);
    }
    println!("ok: {iters} iterations, {} -> {}", totals.0, totals.1);
}
