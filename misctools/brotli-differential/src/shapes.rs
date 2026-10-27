//! Inputs of shapes that random data and files do not have.
use crate::enc::{self, EncCase};
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
                if all.is_empty() || rng.chance(1, 4) {
                    // From the input, also from the parts before.
                    let distance = if rng.chance(1, 3) { edge(&mut rng, window).min(whole.len()) } else { rng.range(1, whole.len().max(1)) };
                    for _ in 0..if whole.is_empty() { 0 } else { rng.range(4, 300) } {
                        whole.push(whole[whole.len() - distance]);
                    }
                    continue;
                }
                let n = if straddle { (before_end + rng.below(3)).saturating_sub(1).max(1) } else { rng.range(4, 400) }.min(all.len());
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
