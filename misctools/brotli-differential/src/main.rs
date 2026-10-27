mod dec;
mod enc;
mod ffi;
mod r#gen;
mod ring;
mod rng;

use dec::{DecCase, compare, mutate};
use ffi::{EncParams, c_compress};
use rng::Rng;

const CORPUS_DIRS: &[&str] = &[
    concat!(env!("CARGO_MANIFEST_DIR"), "/brotli-ref/tests/testdata"),
    concat!(env!("CARGO_MANIFEST_DIR"), "/brotli-ref/c/enc"),
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/js/node"),
    concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/runtime"),
];

pub fn random_enc_params(rng: &mut Rng, data_len: usize, corpus: &r#gen::Corpus) -> EncParams {
    let mut p = EncParams::default();
    let quality = if data_len > 1 << 20 { rng.below(10) } else { rng.below(12) } as u32;
    p.params.push((1, quality));
    if rng.chance(3, 4) {
        p.params.push((2, rng.range(10, 24) as u32));
    }
    if rng.chance(1, 4) {
        p.params.push((0, rng.below(3) as u32));
    }
    if rng.chance(1, 6) {
        p.params.push((3, rng.range(16, 24) as u32));
    }
    if rng.chance(1, 8) {
        p.params.push((4, 1));
    }
    if rng.chance(1, 4) {
        p.params.push((5, if rng.chance(1, 2) { data_len as u32 } else { rng.below(1 << 22) as u32 }));
    }
    if rng.chance(1, 8) {
        p.params.push((6, 1));
        p.params.push((2, rng.range(10, 30) as u32));
    }
    if rng.chance(1, 6) {
        let npostfix = rng.below(4) as u32;
        p.params.push((7, npostfix));
        p.params.push((8, (rng.below(16) as u32) << npostfix));
    }
    if rng.chance(1, 8) {
        let n = r#gen::length(rng, 1 << 16).max(1);
        p.dict = Some(r#gen::data(rng, corpus, n));
    }
    p
}

fn dec_fuzz(seed0: u64, iters: u64, max_len: usize) {
    let corpus = r#gen::Corpus::load(CORPUS_DIRS, 4 << 20);
    eprintln!("corpus: {} files", corpus.files.len());
    let mut stats = std::collections::BTreeMap::<i32, u64>::new();
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let len = r#gen::length(&mut rng, max_len);
        let data = r#gen::data(&mut rng, &corpus, len);
        let p = random_enc_params(&mut rng, len, &corpus);
        let stream = c_compress(&data, &p);
        let large_window = p.params.iter().any(|&(k, v)| k == 6 && v == 1) || rng.chance(1, 8);
        let dicts: Vec<Vec<u8>> = p.dict.clone().into_iter().collect();
        let base = DecCase { stream, large_window, no_realloc: rng.chance(1, 8), dicts, schedule: 0, max_output: usize::MAX };
        // Intact, in one piece and in pieces.
        for k in 0..3 {
            let mut case = base.clone();
            case.schedule = if k == 0 { 0 } else { rng.next() | 1 };
            match compare(&case, Some(&data)) {
                Ok(o) => {
                    if o.result != 1 {
                        panic!("seed {seed}: intact stream did not decode: result {} err {} params {:?}", o.result, o.error, p.params);
                    }
                }
                Err(e) => panic!("seed {seed} (intact, k={k}, schedule {}): {e}\nparams {:?}", case.schedule, p.params),
            }
        }
        // Damaged.
        for k in 0..12 {
            let mut case = base.clone();
            mutate(&mut rng, &mut case.stream);
            case.schedule = if k % 3 == 0 { 0 } else { rng.next() | 1 };
            case.max_output = 64 << 20;
            if rng.chance(1, 10) {
                case.large_window = !case.large_window;
            }
            if rng.chance(1, 20) {
                case.dicts.clear();
            }
            match compare(&case, None) {
                Ok(o) => *stats.entry(if o.result == 0 { o.error } else { o.result }).or_default() += 1,
                Err(e) => {
                    let path = format!("{}/brotli-fail-{seed}-{k}.br", std::env::temp_dir().display());
                    std::fs::write(&path, &case.stream).unwrap();
                    panic!("seed {seed} (damaged k={k}, schedule {}, lw {}, dicts {}): {e}\nstream saved to {path}", case.schedule, case.large_window, case.dicts.len());
                }
            }
        }
        if it % 500 == 499 {
            eprintln!("{} iterations, outcomes {:?}", it + 1, stats);
        }
    }
    println!("ok: {iters} iterations; outcomes {stats:?}");
}

/// Purely random and bit-structured garbage.
fn dec_garbage(seed0: u64, iters: u64) {
    let mut stats = std::collections::BTreeMap::<i32, u64>::new();
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let len = rng.range(0, 200);
        let stream: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
        let case = DecCase {
            stream,
            large_window: rng.chance(1, 2),
            no_realloc: rng.chance(1, 8),
            dicts: if rng.chance(1, 4) { vec![(0..rng.range(1, 300)).map(|_| rng.next() as u8).collect()] } else { vec![] },
            schedule: if rng.chance(1, 2) { 0 } else { rng.next() | 1 },
            max_output: 64 << 20,
        };
        match compare(&case, None) {
            Ok(o) => *stats.entry(if o.result == 0 { o.error } else { o.result }).or_default() += 1,
            Err(e) => panic!("seed {seed}: {e}\n{:02x?}", case.stream),
        }
    }
    println!("ok: {iters} iterations; outcomes {stats:?}");
}

/// `qualities`: a bit mask.
fn enc_fuzz(seed0: u64, iters: u64, max_len: usize, qualities: u64) {
    let corpus = r#gen::Corpus::load(CORPUS_DIRS, 4 << 20);
    let qs: Vec<u32> = (0..12).filter(|q| qualities >> q & 1 != 0).collect();
    let mut total_in = 0usize;
    let mut total_out = 0usize;
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let q = *rng.pick(&qs);
        let max = if q >= 10 { max_len.min(1 << 20) } else { max_len };
        let len = r#gen::length(&mut rng, max);
        let data = r#gen::data(&mut rng, &corpus, len);
        let mut p = random_enc_params(&mut rng, len, &corpus);
        p.params.retain(|&(k, _)| k != 1);
        p.params.insert(rng.below(p.params.len() + 1), (1, q));
        if rng.chance(1, 12) {
            // Out of range values.
            let k = rng.below(11) as i32;
            let v = match rng.below(4) {
                0 => rng.below(64) as u32,
                1 => rng.next() as u32,
                2 => u32::MAX - rng.below(4) as u32,
                _ => 1 << rng.below(32),
            };
            if k != 1 && !(k == 2 && v > 24 && v < 64) {
                p.params.push((k, v));
            }
        }
        if rng.chance(1, 16) {
            p.params.push((9, match rng.below(3) { 0 => rng.range(1, 100) as u32, 1 => rng.below(1 << 24) as u32, _ => 1 << 30 }));
        }
        let mut dicts: Vec<Vec<u8>> = p.dict.clone().into_iter().collect();
        if !dicts.is_empty() && rng.chance(1, 3) {
            let most = if rng.chance(1, 8) { 16 } else { 3 };
            for _ in 0..rng.range(1, most) {
                let n = r#gen::length(&mut rng, 1 << 14).max(1);
                // Often related to the data.
                if rng.chance(1, 2) && data.len() > 16 {
                    let off = rng.below(data.len() - 8);
                    let n = n.min(data.len() - off);
                    dicts.push(data[off..off + n].to_vec());
                } else {
                    dicts.push(r#gen::data(&mut rng, &corpus, n));
                }
            }
        }
        if let Some(d) = dicts.first_mut() {
            if rng.chance(1, 2) && data.len() > 16 {
                let off = rng.below(data.len() - 8);
                let n = rng.range(8, data.len() - off);
                *d = data[off..off + n].to_vec();
            }
        }
        let lgwin_large = p.params.iter().any(|&(k, v)| k == 2 && v > 26);
        if lgwin_large && rng.chance(3, 4) {
            // Huge ring buffers are slow to allocate; keep them rare.
            p.params.retain(|&(k, v)| !(k == 2 && v > 26));
        }
        for k in 0..3 {
            let case = enc::EncCase {
                data: data.clone(),
                params: p.params.clone(),
                dicts: dicts.clone(),
                schedule: if k == 0 { 0 } else { rng.next() | 1 },
                misuse: k == 2 && rng.chance(1, 4),
            };
            match enc::compare(&case) {
                Ok(out) => {
                    total_in += data.len();
                    total_out += out.len();
                }
                Err(e) => {
                    let path = format!("{}/brotli-encfail-{seed}.bin", std::env::temp_dir().display());
                    std::fs::write(&path, &data).unwrap();
                    panic!(
                        "seed {seed} k={k} schedule {} misuse {}: {e}\nlen {} params {:?} dicts {:?}\ndata saved to {path}",
                        case.schedule,
                        case.misuse,
                        data.len(),
                        case.params,
                        case.dicts.iter().map(Vec::len).collect::<Vec<_>>()
                    );
                }
            }
        }
        if rng.chance(1, 4) {
            let lgwin = rng.range(8, 26) as i32;
            let cap = match rng.below(4) {
                0 => rng.below(data.len() + 20),
                1 => bun_brotli::max_compressed_size(data.len()),
                2 => bun_brotli::max_compressed_size(data.len()).saturating_sub(1),
                _ => data.len() * 2 + 1024,
            };
            if let Err(e) = enc::compare_one_shot(q as i32, lgwin, rng.below(3) as i32, &data, cap) {
                panic!("seed {seed}: {e}");
            }
        }
        if it % 200 == 199 {
            eprintln!("{} iterations, {total_in} -> {total_out}", it + 1);
        }
    }
    println!("ok: {iters} iterations, {total_in} -> {total_out}");
}

/// Every file of the corpus at every quality in the mask, with the default settings.
fn enc_files(qualities: u64, lgwin: u32) {
    let corpus = r#gen::Corpus::load(CORPUS_DIRS, 4 << 20);
    for q in (0..12).filter(|q| qualities >> q & 1 != 0) {
        let mut n = 0;
        for (i, f) in corpus.files.iter().enumerate() {
            if q >= 10 && f.len() > 1 << 19 {
                continue;
            }
            let case = enc::EncCase { data: f.clone(), params: vec![(1, q), (2, lgwin)], dicts: vec![], schedule: 0, misuse: false };
            if let Err(e) = enc::compare(&case) {
                let path = format!("{}/brotli-encfail-file.bin", std::env::temp_dir().display());
                std::fs::write(&path, f).unwrap();
                panic!("file {i} ({} bytes) q{q} w{lgwin}: {e}; saved to {path}", f.len());
            }
            n += 1;
        }
        println!("q{q}: {n} files ok");
    }
}

fn enc_one(path: &str, params: &[String]) {
    let data = std::fs::read(path).unwrap();
    let params: Vec<(i32, u32)> = params.iter().map(|s| { let (k, v) = s.split_once('=').unwrap(); (k.parse().unwrap(), v.parse().unwrap()) }).collect();
    let case = enc::EncCase { data, params, dicts: vec![], schedule: 0, misuse: false };
    match enc::compare(&case) {
        Ok(o) => println!("ok: {} bytes", o.len()),
        Err(e) => println!("FAIL: {e}"),
    }
}

fn bench_enc(path: &str, quality: u32, lgwin: u32, reps: usize) {
    let data = std::fs::read(path).unwrap();
    let cap = bun_brotli::max_compressed_size(data.len());
    let mut out = vec![0u8; cap];
    let mut best = [f64::MAX; 2];
    let mut sizes = [0usize; 2];
    // ONLY=c or ONLY=rust leaves the other one out, for a profiler.
    let only = std::env::var("ONLY").unwrap_or_default();
    for _ in 0..reps {
        if only != "rust" {
            let t = std::time::Instant::now();
            let mut n = cap;
            assert!(unsafe { ffi::BrotliEncoderCompress(quality as i32, lgwin as i32, 0, data.len(), data.as_ptr(), &mut n, out.as_mut_ptr()) } != 0);
            best[0] = best[0].min(t.elapsed().as_secs_f64());
            sizes[0] = n;
        }
        if only != "c" {
            let t = std::time::Instant::now();
            sizes[1] = bun_brotli::compress(quality as i32, lgwin as i32, bun_brotli::EncoderMode::Generic, &data, &mut out).unwrap();
            best[1] = best[1].min(t.elapsed().as_secs_f64());
        }
    }
    let mb = data.len() as f64 / 1e6;
    println!("{path} q{quality} w{lgwin}: {} -> C {} Rust {}; C {:.1} MB/s, Rust {:.1} MB/s ({:.0}%)", data.len(), sizes[0], sizes[1], mb / best[0], mb / best[1], 100.0 * best[0] / best[1]);
}

/// Many compressions (and decompressions) of the first `len` bytes of a file: what setting up costs.
fn bench_small(path: &str, len: usize, quality: u32, lgwin: u32, reps: usize) {
    let data = std::fs::read(path).unwrap();
    let data = &data[..len.min(data.len())];
    let cap = bun_brotli::max_compressed_size(data.len());
    let mut out = vec![0u8; cap];
    let mut back = vec![0u8; data.len() + 16];
    let mut t = [0f64; 4];
    let mut n = cap;
    for round in 0..3 {
        let s = std::time::Instant::now();
        for _ in 0..reps {
            n = cap;
            assert!(unsafe { ffi::BrotliEncoderCompress(quality as i32, lgwin as i32, 0, data.len(), data.as_ptr(), &mut n, out.as_mut_ptr()) } != 0);
        }
        t[0] = s.elapsed().as_secs_f64();
        let s = std::time::Instant::now();
        for _ in 0..reps {
            n = bun_brotli::compress(quality as i32, lgwin as i32, bun_brotli::EncoderMode::Generic, data, &mut out).unwrap();
        }
        t[1] = s.elapsed().as_secs_f64();
        let s = std::time::Instant::now();
        for _ in 0..reps {
            let mut c = ffi::CDecoder::new();
            let (r, _, _) = c.stream(&out[..n], &mut back);
            assert!(r == 1);
        }
        t[2] = s.elapsed().as_secs_f64();
        let s = std::time::Instant::now();
        for _ in 0..reps {
            let mut d = bun_brotli::Decoder::new();
            let mut input: &[u8] = &out[..n];
            let mut o: &mut [u8] = &mut back;
            assert!(d.decompress_stream(&mut input, &mut o) == bun_brotli::DecoderResult::Success);
        }
        t[3] = s.elapsed().as_secs_f64();
        let _ = round;
    }
    let us = |x: f64| x * 1e6 / reps as f64;
    println!("{len} bytes q{quality} w{lgwin}: encode C {:.1} us, Rust {:.1} us ({:.0}%); decode C {:.1} us, Rust {:.1} us ({:.0}%)", us(t[0]), us(t[1]), 100.0 * t[0] / t[1], us(t[2]), us(t[3]), 100.0 * t[2] / t[3]);
}

fn testdata() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/brotli-ref/tests/testdata");
    let mut n = 0;
    let mut names: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).collect();
    names.sort();
    for p in names {
        let name = p.file_name().unwrap().to_str().unwrap().to_string();
        if !name.contains(".compressed") {
            continue;
        }
        let stream = std::fs::read(&p).unwrap();
        let orig = std::fs::read(format!("{dir}/{}", name.split(".compressed").next().unwrap())).ok();
        for schedule in [0u64, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] {
            let case = DecCase { stream: stream.clone(), large_window: false, no_realloc: false, dicts: vec![], schedule, max_output: usize::MAX };
            let o = compare(&case, orig.as_deref()).unwrap_or_else(|e| panic!("{name} schedule {schedule}: {e}"));
            assert_eq!(o.result, 1, "{name}");
        }
        n += 1;
    }
    println!("ok: {n} files");
}

fn bench_dec(path: &str, quality: u32, lgwin: u32, reps: usize) {
    let data = std::fs::read(path).unwrap();
    let stream = c_compress(&data, &EncParams { params: vec![(1, quality), (2, lgwin)], dict: None });
    let mut out = vec![0u8; data.len() + 16];
    let mut best = [f64::MAX; 2];
    for _ in 0..reps {
        let t = std::time::Instant::now();
        let mut c = ffi::CDecoder::new();
        let (r, _, made) = c.stream(&stream, &mut out);
        assert!(r == 1 && made == data.len());
        best[0] = best[0].min(t.elapsed().as_secs_f64());
        let t = std::time::Instant::now();
        let mut d = bun_brotli::Decoder::new();
        let mut input: &[u8] = &stream;
        let mut o: &mut [u8] = &mut out;
        let r = d.decompress_stream(&mut input, &mut o);
        assert!(r == bun_brotli::DecoderResult::Success);
        best[1] = best[1].min(t.elapsed().as_secs_f64());
    }
    let mb = data.len() as f64 / 1e6;
    println!("{path} q{quality} w{lgwin}: {} -> {} bytes; C {:.1} MB/s, Rust {:.1} MB/s ({:.0}%)", data.len(), stream.len(), mb / best[0], mb / best[1], 100.0 * best[0] / best[1]);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let num = |i: usize, d: u64| args.get(i).and_then(|s| s.parse().ok()).unwrap_or(d);
    match args.get(1).map(String::as_str) {
        Some("testdata") => testdata(),
        Some("dec-fuzz") => dec_fuzz(num(2, 1), num(3, 1000), num(4, 1 << 22) as usize),
        Some("dec-garbage") => dec_garbage(num(2, 1), num(3, 100000)),
        Some("bench-dec") => bench_dec(&args[2], num(3, 5) as u32, num(4, 22) as u32, num(5, 10) as usize),
        Some("enc-fuzz") => enc_fuzz(num(2, 1), num(3, 1000), num(4, 1 << 22) as usize, num(5, 0xFFF)),
        Some("enc-ring") => ring::run(num(2, 1), num(3, 1000), num(4, 1 << 22) as usize, num(5, 0xFFC), &r#gen::Corpus::load(CORPUS_DIRS, 4 << 20)),
        Some("enc-hash") => ring::run_hash(num(2, 1), num(3, 1000), num(4, 1 << 22) as usize, num(5, 0x3E0), &r#gen::Corpus::load(CORPUS_DIRS, 4 << 20)),
        Some("enc-files") => enc_files(num(2, 0xFFF), num(3, 22) as u32),
        Some("bench-small") => bench_small(&args[2], num(3, 1000) as usize, num(4, 5) as u32, num(5, 22) as u32, num(6, 1000) as usize),
        Some("enc-one") => enc_one(&args[2], &args[3..]),
        Some("bench-enc") => bench_enc(&args[2], num(3, 5) as u32, num(4, 22) as u32, num(5, 5) as usize),
        _ => eprintln!("usage: harness testdata | dec-fuzz seed iters maxlen | dec-garbage seed iters"),
    }
}
