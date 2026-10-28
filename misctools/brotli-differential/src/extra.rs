//! The subcommands that are not in main.rs.
use crate::dec::{self, DecCase, compare, mutate};
use crate::ffi::{self, c_compress};
use crate::rng::Rng;
use crate::{CORPUS_DIRS, api, args, big, grammar, oom, perf, random_enc_params, r#gen, ring, shapes, stream};

/// `StreamingDecoder`: intact, cut short, damaged, and followed by something else.
fn dec_stream(seed0: u64, iters: u64, max_len: usize) {
    let corpus = r#gen::Corpus::load(CORPUS_DIRS, 4 << 20);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let len = r#gen::length(&mut rng, max_len);
        let data = r#gen::data(&mut rng, &corpus, len);
        let mut p = random_enc_params(&mut rng, len, &corpus);
        p.dict = None;
        let intact = c_compress(&data, &p);
        for k in 0..10 {
            let mut stream = intact.clone();
            match k {
                0 | 1 | 2 => {}
                3 => stream.truncate(rng.below(stream.len() + 1)),
                4 => stream.extend((0..rng.range(1, 40)).map(|_| rng.next() as u8)),
                _ => mutate(&mut rng, &mut stream),
            }
            let schedule = rng.next();
            if let Err(e) = stream::compare(&stream, schedule, 64 << 20) {
                let path = format!("{}/brotli-streamfail-{seed}-{k}.br", std::env::temp_dir().display());
                std::fs::write(&path, &stream).unwrap();
                panic!("seed {seed} k={k} schedule {schedule}: {e}\nparams {:?}; stream saved to {path}", p.params);
            }
        }
    }
    println!("ok: {iters} iterations");
}

/// Streams from the grammar. `evil`: one chance in this many, at each opportunity, to break a rule (0: never).
fn dec_gen(seed0: u64, iters: u64, evil: usize) {
    let mut stats = std::collections::BTreeMap::<String, u64>::new();
    let (mut bytes_in, mut bytes_out) = (0usize, 0usize);
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let s = grammar::stream(&mut rng, evil, 300_000);
        bytes_in += s.bytes.len();
        bytes_out += s.output.len();
        let base = DecCase { stream: s.bytes.clone(), large_window: s.large_window || rng.chance(1, 8), no_realloc: rng.chance(1, 8), dicts: s.dictionaries.clone(), schedule: 0, max_output: usize::MAX };
        let save = |stream: &[u8]| {
            let path = format!("{}/brotli-genfail-{seed}.br", std::env::temp_dir().display());
            std::fs::write(&path, stream).unwrap();
            path
        };
        for k in 0..4 {
            let mut case = base.clone();
            case.schedule = if k == 0 { 0 } else { rng.next() | 1 };
            match compare(&case, s.evil.is_none().then_some(&s.output[..])) {
                Ok(o) => {
                    if s.evil.is_none() && o.result != 1 {
                        panic!("seed {seed}: a stream that should be valid: result {} error {} after {} of {} bytes; saved to {}", o.result, o.error, o.output_len, s.output.len(), save(&case.stream));
                    }
                    if k == 0 {
                        *stats.entry(format!("{}: {}", s.evil.unwrap_or("valid"), if o.result == 0 { o.error } else { o.result })).or_default() += 1;
                    }
                }
                Err(e) => panic!("seed {seed} k={k} schedule {} lw {} dicts {} ({}): {e}\nsaved to {}", case.schedule, case.large_window, case.dicts.len(), s.evil.unwrap_or("valid"), save(&case.stream)),
            }
        }
        // Cut short, damaged, and through the other interface.
        for k in 0..6 {
            let mut case = base.clone();
            if k == 0 {
                case.stream.truncate(rng.below(case.stream.len() + 1));
            } else {
                mutate(&mut rng, &mut case.stream);
            }
            case.schedule = if k % 2 == 0 { 0 } else { rng.next() | 1 };
            case.max_output = 16 << 20;
            if let Err(e) = compare(&case, None) {
                panic!("seed {seed} damaged k={k} schedule {} lw {} dicts {}: {e}\nsaved to {}", case.schedule, case.large_window, case.dicts.len(), save(&case.stream));
            }
        }
        if s.dictionaries.is_empty() {
            let schedule = rng.next();
            if let Err(e) = stream::compare(&s.bytes, schedule, 16 << 20) {
                panic!("seed {seed} schedule {schedule}: {e}\nsaved to {}", save(&s.bytes));
            }
        }
    }
    println!("ok: {iters} iterations, {bytes_in} -> {bytes_out}");
    if std::env::var_os("STATS").is_some() {
        for (k, v) in stats {
            println!("  {v:>8} {k}");
        }
    }
}

/// Seeds for `fuzz_dec` and `fuzz_enc`.
fn gen_corpus(dir: &str, n: u64) {
    let corpus = r#gen::Corpus::load(CORPUS_DIRS, 4 << 20);
    std::fs::create_dir_all(format!("{dir}/dec")).unwrap();
    std::fs::create_dir_all(format!("{dir}/enc")).unwrap();
    for seed in 0..n {
        let mut rng = Rng(seed);
        let len = match rng.below(4) { 0 => rng.below(64), 1 | 2 => rng.below(1500), _ => rng.below(12000) };
        let data = r#gen::data(&mut rng, &corpus, len);
        let mut p = random_enc_params(&mut rng, len, &corpus);
        p.dict = None;
        let which = if rng.chance(1, 4) { rng.range(1, 2) as u8 } else { 0 };
        let mut e = ffi::CEncoder::new();
        for &(k, v) in &p.params {
            e.set(k, v);
        }
        for d in dec::dictionaries(which) {
            assert!(e.attach(d));
        }
        let large = p.params.iter().any(|&(k, v)| k == 6 && v == 1);
        let mut out = vec![u8::from(large) | which << 2, rng.next() as u8 & 3];
        let mut buf = vec![0u8; 1 << 16];
        let mut input: &[u8] = &data;
        // In a few meta-blocks.
        while !e.is_finished() {
            let n = if rng.chance(1, 2) { input.len() } else { rng.below(input.len() + 1) };
            let op = if n == input.len() { 2 } else { rng.range(0, 1) as i32 };
            let mut piece = &input[..n];
            loop {
                let (ok, used, made) = e.stream(op, piece, &mut buf);
                assert!(ok);
                piece = &piece[used..];
                out.extend_from_slice(&buf[..made]);
                if piece.is_empty() && !e.has_more_output() {
                    break;
                }
            }
            input = &input[n..];
        }
        std::fs::write(format!("{dir}/dec/s{seed}"), &out).unwrap();
        let mut recipe: Vec<u8> = (0..12).map(|_| rng.next() as u8).collect();
        recipe[0] = (seed % 12) as u8;
        recipe[4] &= !(4 | 64);
        recipe.extend((0..rng.range(10, 300)).map(|_| rng.next() as u8));
        std::fs::write(format!("{dir}/enc/s{seed}"), &recipe).unwrap();
    }
    let testdata = concat!(env!("CARGO_MANIFEST_DIR"), "/brotli-ref/tests/testdata");
    for e in std::fs::read_dir(testdata).unwrap().flatten() {
        let name = e.file_name().to_str().unwrap().to_string();
        let bytes = std::fs::read(e.path()).unwrap();
        if name.contains(".compressed") && bytes.len() < 40000 {
            std::fs::write(format!("{dir}/dec/t-{name}"), [&[0, 0][..], &bytes].concat()).unwrap();
        }
    }
}

/// Runs the files of a `fuzz_dec` corpus, for coverage.
fn replay_dec(dir: &str) {
    let mut n = 0;
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let bytes = std::fs::read(e.path()).unwrap();
        let [flags, schedule, stream @ ..] = &bytes[..] else { continue };
        let case = DecCase {
            stream: stream.to_vec(),
            large_window: flags & 1 != 0,
            no_realloc: flags & 2 != 0,
            dicts: dec::dictionaries(flags >> 2),
            schedule: u64::from(*schedule).wrapping_mul(0x9E37_79B9_7F4A_7C15) >> 8,
            max_output: 4 << 20,
        };
        compare(&case, None).unwrap_or_else(|error| panic!("{}: {error}", e.path().display()));
        n += 1;
    }
    println!("ok: {n} files");
}

/// Compresses and decompresses on a thread with a stack of `kib` KiB. Too little kills the process.
fn stack_probe(which: &str, quality: u32, kib: usize) {
    let corpus = r#gen::Corpus::load(CORPUS_DIRS, 4 << 20);
    let data = r#gen::data(&mut Rng(u64::from(quality)), &corpus, 600_000);
    let rust = which == "rust";
    std::thread::Builder::new()
        .stack_size(kib << 10)
        .spawn(move || {
            let mut out = vec![0u8; data.len() * 2 + 1024];
            let mut back = vec![0u8; data.len() + 16];
            if rust {
                let n = bun_brotli::compress(quality as i32, 22, bun_brotli::EncoderMode::Generic, &data, &mut out).unwrap();
                let mut d = bun_brotli::Decoder::new();
                let mut input: &[u8] = &out[..n];
                let mut o: &mut [u8] = &mut back;
                assert!(d.decompress_stream(&mut input, &mut o) == bun_brotli::DecoderResult::Success);
            } else {
                let mut n = out.len();
                assert!(unsafe { ffi::BrotliEncoderCompress(quality as i32, 22, 0, data.len(), data.as_ptr(), &mut n, out.as_mut_ptr()) } != 0);
                let mut c = ffi::CDecoder::new();
                assert!(c.stream(&out[..n], &mut back).0 == 1);
            }
        })
        .unwrap()
        .join()
        .unwrap();
}

/// The smallest stack, in KiB, with which each quality works.
fn stack() {
    let exe = std::env::current_exe().unwrap();
    for quality in 0..12 {
        let mut line = format!("q{quality}:");
        for which in ["c", "rust"] {
            let works = |kib: usize| std::process::Command::new(&exe).args(["stack-probe", which, &quality.to_string(), &kib.to_string()]).stderr(std::process::Stdio::null()).status().unwrap().success();
            let (mut lo, mut hi) = (4usize, 16384usize);
            assert!(works(hi));
            while hi - lo > 4 {
                let mid = (lo + hi) / 2;
                if works(mid) { hi = mid } else { lo = mid }
            }
            line += &format!(" {which} {hi} KiB");
        }
        println!("{line}");
    }
}

/// Whether there is such a subcommand.
pub fn run(args: &[String]) -> bool {
    let num = |i: usize, d: u64| args::num(args, i, d);
    let text = |i: usize| args::text(args, i);
    let corpus = || r#gen::Corpus::load(CORPUS_DIRS, 4 << 20);
    match args.get(1).map(String::as_str) {
        Some("dec-gen") => dec_gen(num(2, 1), num(3, 1000), num(4, 0) as usize),
        Some("dec-stream") => dec_stream(num(2, 1), num(3, 1000), num(4, 1 << 20) as usize),
        Some("dec-empty-commands") => {
            for distances in [false, true] {
                let stream = grammar::empty_commands(distances);
                println!("{} bytes", stream.len());
                for schedule in [0u64, 9, 5] {
                    let t = std::time::Instant::now();
                    let case = DecCase { stream: stream.clone(), large_window: false, no_realloc: false, dicts: vec![], schedule, max_output: usize::MAX };
                    let o = compare(&case, None).unwrap_or_else(|e| panic!("schedule {schedule}: {e}"));
                    assert_eq!((o.result, o.error), (0, -17), "schedule {schedule}: not _ERROR_FORMAT_BLOCK_SWITCH");
                    println!("schedule {schedule}: error {} after {} calls in {:.1} s", o.error, o.calls, t.elapsed().as_secs_f64());
                }
            }
        }
        Some("enc-tail") => ring::run_tail(num(2, 1), num(3, 1000), num(4, 0x1C), &corpus()),
        Some("enc-marks") => ring::run_marks(num(2, 1), num(3, 1000), num(4, 0x60), &args::rest(args, 5).iter().map(|s| args::parse(s) as usize).collect::<Vec<usize>>(), &corpus()),
        Some("enc-words") => ring::run_words(num(2, 1), num(3, 1000), num(4, 1 << 16) as usize, num(5, 0xFFF)),
        Some("enc-every-word") => shapes::run_every_word(num(2, 0x820), num(3, 0) != 0),
        Some("enc-lengths") => ring::run_lengths(num(2, 1), num(3, 1000), num(4, 1 << 19) as usize, num(5, 0xFFF)),
        Some("enc-dict") => shapes::run_dict(num(2, 1), num(3, 1000), num(4, 1 << 20) as usize, num(5, 0xFFC), &corpus()),
        Some("enc-far-dict") => shapes::run_far_dict(num(2, 1), num(3, 0x3FC)),
        Some("enc-offset-dict") => shapes::run_offset_dict(num(2, 1), num(3, 20), num(4, 0xFE0)),
        Some("enc-blocks") => shapes::run_blocks(num(2, 1), num(3, 100), num(4, 1 << 20) as usize, num(5, 0xFF0)),
        Some("enc-parts") => shapes::run_parts(num(2, 1), num(3, 1000), num(4, 1 << 19) as usize, num(5, 0xFFF), &corpus()),
        Some("enc-flint") => shapes::run_flint(num(2, 0xFFF)),
        Some("race") => shapes::run_race(num(2, 1), num(3, 200), num(4, 300_000) as usize, num(5, 0xFFF), &corpus()),
        Some("enc-dense") => shapes::run_dense(num(2, 1), num(3, 1000), num(4, 0x3E0)),
        Some("enc-rolling") => shapes::run_rolling(num(2, 1), num(3, 40), num(4, 0xF8)),
        Some("enc-stitch") => shapes::run_stitch(num(2, 1), num(3, 3000), num(4, 0xC00)),
        Some("enc-merge") => shapes::run_merge(num(2, 0xFFC)),
        Some("enc-states") => shapes::run_states(num(2, 1), num(3, 1000), num(4, 0xFFF)),
        Some("enc-select") => shapes::run_select(num(2, 1), num(3, 200_000) as usize, &corpus()),
        Some("enc-big") => big::run(num(2, 1), num(3, 6 << 30), args::params(args::rest(args, 4)), &corpus()),
        Some("enc-lap") => big::run_lap(num(2, 1), num(3, (3 << 30) + (64 << 20)), args::params(args::rest(args, 4))),
        Some("api") => api::run(num(2, 1), num(3, 300), &corpus()),
        Some("oom") => oom::run(num(2, 1), num(3, 100), num(4, 1 << 18) as usize, &corpus()),
        Some("oom-cold") => oom::cold(),
        Some("oom-cold-probe") => oom::cold_probe(num(2, 11) as i32, num(3, 0) as i64, num(4, 0) != 0),
        Some("mem-scan") => perf::run_memory(num(2, 0xFFF), num(3, 9_000_000) as usize, &corpus()),
        Some("perf-scan") => perf::run(num(2, 1), num(3, 300), num(4, 1 << 20) as usize, &corpus()),
        Some("stack-probe") => stack_probe(text(2), num(3, 5) as u32, num(4, 1024) as usize),
        Some("stack") => stack(),
        Some("gen-corpus") => gen_corpus(text(2), num(3, 2000)),
        Some("replay-dec") => replay_dec(text(2)),
        _ => return false,
    }
    true
}
