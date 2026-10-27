//! Allocations that fail. Every one has to end in an error that is reported, never in an abort.
use crate::r#gen;
use crate::rng::Rng;
use bun_brotli::{Decoder, DecoderParameter, DecoderResult, Encoder, EncoderOperation, EncoderParameter, PreparedDictionary};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering::Relaxed};

pub struct Failing;
static ARMED: AtomicBool = AtomicBool::new(false);
/// How many more allocations succeed.
static COUNTDOWN: AtomicI64 = AtomicI64::new(i64::MAX);
/// Whether all allocations after that one fail too.
static PERSISTENT: AtomicBool = AtomicBool::new(false);
static COUNT: AtomicU64 = AtomicU64::new(0);
static FAILED: AtomicU64 = AtomicU64::new(0);
static MAX_SIZE: AtomicU64 = AtomicU64::new(0);
static QUIET: AtomicBool = AtomicBool::new(false);

fn fails() -> bool {
    if !ARMED.load(Relaxed) {
        return false;
    }
    COUNT.fetch_add(1, Relaxed);
    let left = COUNTDOWN.fetch_sub(1, Relaxed);
    let fail = left == 0 || (left < 0 && PERSISTENT.load(Relaxed));
    if fail {
        FAILED.fetch_add(1, Relaxed);
    }
    fail
}

unsafe impl GlobalAlloc for Failing {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        if fails() { std::ptr::null_mut() } else { unsafe { System.alloc(l) } }
    }
    unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
        if fails() { std::ptr::null_mut() } else { unsafe { System.alloc_zeroed(l) } }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        if fails() { std::ptr::null_mut() } else { unsafe { System.realloc(p, l, n) } }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        unsafe { System.dealloc(p, l) }
    }
}

fn armed<T>(f: impl FnOnce() -> T) -> T {
    ARMED.store(true, Relaxed);
    let r = f();
    ARMED.store(false, Relaxed);
    r
}

#[derive(Clone)]
struct Case {
    data: Vec<u8>,
    params: Vec<(u32, u32)>,
    dict: Option<Vec<u8>>,
    chunk: usize,
    cap: usize,
}

/// `None` if a call failed.
fn encode(c: &Case) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(c.data.len() * 2 + 4096);
    let mut buf = vec![0u8; c.cap];
    let dict = c.dict.clone().map(Vec::into_boxed_slice);
    let mut e = armed(Encoder::new);
    for &(k, v) in &c.params {
        e.set_parameter(EncoderParameter::from_raw(k).unwrap(), v);
    }
    if let Some(d) = dict {
        if !armed(|| PreparedDictionary::new(d).is_some_and(|p| e.attach_prepared_dictionary(p))) {
            return None;
        }
    }
    let mut pieces = c.data.chunks(c.chunk.max(1)).peekable();
    loop {
        let piece = pieces.next().unwrap_or(&[]);
        let op = if pieces.peek().is_none() { EncoderOperation::Finish } else { EncoderOperation::Process };
        let mut input = piece;
        loop {
            let mut o: &mut [u8] = &mut buf;
            let ok = armed(|| e.compress_stream(op, &mut input, &mut o));
            let made = c.cap - o.len();
            if !ok {
                // It stays that way.
                let mut o: &mut [u8] = &mut buf;
                ARMED.store(false, Relaxed);
                assert!(!e.compress_stream(op, &mut input, &mut o), "a call after a failed one succeeded");
                return None;
            }
            out.extend_from_slice(&buf[..made]);
            if input.is_empty() && !e.has_more_output() {
                break;
            }
        }
        if op == EncoderOperation::Finish {
            assert!(e.is_finished());
            return Some(out);
        }
    }
}

/// `Err` has the error code.
fn decode(stream: &[u8], dict: Option<&Vec<u8>>, chunk: usize, cap: usize, expect_len: usize) -> Result<Vec<u8>, i32> {
    let mut out = Vec::with_capacity(expect_len + 16);
    let mut buf = vec![0u8; cap];
    let dict = dict.cloned().map(Vec::into_boxed_slice);
    let mut d = armed(Decoder::new);
    d.set_parameter(DecoderParameter::LargeWindow, 1);
    if let Some(x) = dict {
        if !armed(|| d.attach_dictionary(x)) {
            return Err(-1000);
        }
    }
    let mut pos = 0usize;
    loop {
        let end = pos.saturating_add(chunk.max(1)).min(stream.len());
        let mut input = &stream[pos..end];
        let mut o: &mut [u8] = &mut buf;
        let r = armed(|| d.decompress_stream(&mut input, &mut o));
        pos = end - input.len();
        let made = cap - o.len();
        out.extend_from_slice(&buf[..made]);
        match r {
            DecoderResult::Success => return Ok(out),
            DecoderResult::Error => return Err(d.error_code() as i32),
            _ => {}
        }
    }
}

fn with_failure<T>(at: i64, persistent: bool, f: impl FnOnce() -> T + std::panic::UnwindSafe) -> (Result<T, String>, u64) {
    COUNTDOWN.store(at, Relaxed);
    PERSISTENT.store(persistent, Relaxed);
    FAILED.store(0, Relaxed);
    QUIET.store(true, Relaxed);
    let r = std::panic::catch_unwind(f);
    QUIET.store(false, Relaxed);
    ARMED.store(false, Relaxed);
    COUNTDOWN.store(i64::MAX, Relaxed);
    let r = r.map_err(|e| e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default());
    (r, FAILED.load(Relaxed))
}

/// `MakeUncompressedStream` of the reference.
fn uncompressed_stream(input: &[u8]) -> Vec<u8> {
    let mut out = vec![0x21, 0x03];
    for chunk in input.chunks(1 << 24) {
        let n = chunk.len() as u32;
        let nibbles = if n > 1 << 20 { 2 } else if n > 1 << 16 { 1 } else { 0 };
        let bits = (nibbles << 1) | ((n - 1) << 3) | (1 << (19 + 4 * nibbles));
        out.extend_from_slice(&bits.to_le_bytes()[..if nibbles == 2 { 4 } else { 3 }]);
        out.extend_from_slice(chunk);
    }
    out.push(3);
    out
}

/// Without memory, `compress` and `compress_append` still work if the output has room for the input as it is.
fn fallback() {
    let data: Vec<u8> = (0..(2usize << 24) + 5).map(|i| (i * 31 + (i >> 9)) as u8).collect();
    for len in [1usize, 2, 65535, 65536, 65537, (1 << 20) - 1, 1 << 20, (1 << 20) + 1, (1 << 24) - 1, 1 << 24, (1 << 24) + 1, (2 << 24) + 5] {
        let input = &data[..len];
        let expect = uncompressed_stream(input);
        let bound = bun_brotli::max_compressed_size(len);
        assert!(expect.len() <= bound, "len {len}");
        for quality in [0, 1, 5, 11] {
            let mut out = vec![0u8; bound];
            let mut spare = Vec::with_capacity(bound + 3);
            spare.extend_from_slice(b"abc");
            COUNTDOWN.store(0, Relaxed);
            PERSISTENT.store(true, Relaxed);
            let a = armed(|| bun_brotli::compress(quality, 22, bun_brotli::EncoderMode::Generic, input, &mut out));
            let same = a.is_some_and(|n| out[..n] == expect[..]);
            let b = armed(|| bun_brotli::compress_append(quality, 22, bun_brotli::EncoderMode::Generic, input, &mut spare));
            let short = armed(|| bun_brotli::compress(quality, 22, bun_brotli::EncoderMode::Generic, input, &mut out[..bound - 1]));
            COUNTDOWN.store(i64::MAX, Relaxed);
            assert!(same && b == a && spare[3..] == expect[..] && &spare[..3] == b"abc", "fallback: len {len} quality {quality}: {a:?} {b:?}, expected {}", expect.len());
            assert!(short.is_none(), "fallback: len {len} quality {quality}: with one byte less than the bound {short:?}");
            let a = armed(|| bun_brotli::compress(quality, 22, bun_brotli::EncoderMode::Generic, input, &mut out));
            assert!(a.is_some());
        }
        let mut c = crate::ffi::CDecoder::new();
        let mut back = vec![0u8; len + 1];
        let (r, _, made) = c.stream(&expect, &mut back);
        assert!(r == 1 && back[..made] == *input, "fallback: len {len} does not decode");
    }
    println!("fallback: ok");
}

pub fn run(seed0: u64, iters: u64, max_len: usize, corpus: &r#gen::Corpus) {
    std::alloc::set_alloc_error_hook(|layout| {
        ARMED.store(false, Relaxed);
        let bt = std::backtrace::Backtrace::force_capture().to_string();
        // The innermost line of the crate.
        let at = bt.lines().filter_map(|l| l.trim().strip_prefix("at ")).find_map(|l| l.split_once("/src/brotli/").map(|(_, f)| f)).unwrap_or("?");
        let at = at.rsplit_once(':').map_or(at, |(f, _)| f);
        MAX_SIZE.fetch_max(layout.size() as u64, Relaxed);
        panic!("INFALLIBLE allocation at {at}");
    });
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if !QUIET.load(Relaxed) {
            default_hook(info);
        }
    }));
    let mut problems = std::collections::BTreeMap::<String, (u64, String)>::new();
    QUIET.store(true, Relaxed);
    let r = std::panic::catch_unwind(fallback);
    QUIET.store(false, Relaxed);
    ARMED.store(false, Relaxed);
    COUNTDOWN.store(i64::MAX, Relaxed);
    if let Err(e) = r {
        let e = e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default();
        problems.insert(e, (1, "the fallback of compress without memory".into()));
    }
    let mut sizes = std::collections::BTreeMap::<String, u64>::new();
    let (mut runs, mut injected, mut survived) = (0u64, 0u64, 0u64);
    let mut codes = std::collections::BTreeMap::<i32, u64>::new();
    for it in 0..iters {
        let seed = seed0.wrapping_add(it);
        let mut rng = Rng(seed);
        let len = r#gen::length(&mut rng, max_len);
        let data = r#gen::data(&mut rng, corpus, len);
        let q = rng.below(12) as u32;
        let mut params = vec![(1, q)];
        if rng.chance(2, 3) {
            params.push((2, rng.range(10, 24) as u32));
        }
        if rng.chance(1, 6) {
            params.push((6, 1));
            params.push((2, rng.range(10, 27) as u32));
        }
        if rng.chance(1, 6) {
            params.push((3, rng.range(16, 22) as u32));
        }
        if rng.chance(1, 4) {
            params.push((5, len as u32));
        }
        if rng.chance(1, 6) {
            params.push((0, rng.below(3) as u32));
        }
        let dict = rng.chance(1, 4).then(|| { let n = rng.range(1, 20000); r#gen::data(&mut rng, corpus, n) });
        let case = Case { data, params, dict, chunk: *rng.pick(&[usize::MAX, 1 << 16, 5000, 100_000]), cap: *rng.pick(&[1 << 22, 1 << 16, 700]) };
        let describe = format!("seed {seed} len {len} params {:?} dict {:?} chunk {} cap {}", case.params, case.dict.as_ref().map(Vec::len), case.chunk, case.cap);
        COUNT.store(0, Relaxed);
        let stream = encode(&case).unwrap_or_else(|| panic!("{describe}: failed without a failure"));
        let n_enc = COUNT.load(Relaxed) as i64;
        let (dchunk, dcap) = (*rng.pick(&[usize::MAX, 1000, 17]), *rng.pick(&[1 << 20, 1 << 14, 300]));
        COUNT.store(0, Relaxed);
        let back = decode(&stream, case.dict.as_ref(), dchunk, dcap, len).unwrap_or_else(|e| panic!("{describe}: decoder error {e}"));
        assert!(back == case.data, "{describe}: round trip");
        let n_dec = COUNT.load(Relaxed) as i64;
        let pick = |rng: &mut Rng, n: i64| -> Vec<i64> { if n <= 150 { (0..n).collect() } else { (0..150).map(|_| rng.below(n as usize) as i64).collect() } };
        for at in pick(&mut rng, n_enc) {
            let persistent = rng.chance(1, 2);
            let c = case.clone();
            let (r, failed) = with_failure(at, persistent, move || encode(&c));
            runs += 1;
            injected += failed.min(1);
            match r {
                Err(e) => { let m = sizes.entry(e.clone()).or_default(); *m = (*m).max(MAX_SIZE.swap(0, Relaxed)); problems.entry(e).or_insert((0, format!("{describe} encoder allocation {at}/{n_enc} persistent {persistent}"))).0 += 1; }
                Ok(None) => {}
                Ok(Some(out)) => {
                    survived += 1;
                    if out != stream {
                        problems.entry("the encoder went on after a failed allocation with other output".into()).or_insert((0, format!("{describe} allocation {at}/{n_enc}"))).0 += 1;
                    }
                }
            }
        }
        for at in pick(&mut rng, n_dec) {
            let persistent = rng.chance(1, 2);
            let (s, d) = (stream.clone(), case.dict.clone());
            let (r, failed) = with_failure(at, persistent, move || decode(&s, d.as_ref(), dchunk, dcap, len));
            runs += 1;
            injected += failed.min(1);
            match r {
                Err(e) => { let m = sizes.entry(e.clone()).or_default(); *m = (*m).max(MAX_SIZE.swap(0, Relaxed)); problems.entry(e).or_insert((0, format!("{describe} decoder allocation {at}/{n_dec} persistent {persistent} chunk {dchunk} cap {dcap}"))).0 += 1; }
                Ok(Err(code)) => {
                    *codes.entry(code).or_default() += 1;
                    if !(-30..=-21).contains(&code) && code != -1000 {
                        problems.entry(format!("decoder error {code} after a failed allocation")).or_insert((0, format!("{describe} allocation {at}/{n_dec}"))).0 += 1;
                    }
                }
                Ok(Ok(out)) => {
                    survived += 1;
                    if out != case.data {
                        problems.entry("the decoder went on after a failed allocation with other output".into()).or_insert((0, format!("{describe} allocation {at}/{n_dec}"))).0 += 1;
                    }
                }
            }
        }
    }
    let _ = std::panic::take_hook();
    println!("{runs} runs, {injected} with a failed allocation, {survived} completed all the same; decoder codes {codes:?}");
    for (what, (n, first)) in &problems {
        println!("PROBLEM x{n}: {what} (up to {} bytes)\n    first: {first}", sizes.get(what).copied().unwrap_or(0));
    }
    if problems.is_empty() {
        println!("ok: {iters} iterations");
    } else {
        std::process::exit(1);
    }
}

/// The first call in a process, which builds tables that later calls share, with allocation number `at` failing.
/// Prints whether an allocation failed. The call after it has to work, and give what the reference gives.
pub fn cold_probe(quality: i32, at: i64, persistent: bool) {
    std::alloc::set_alloc_error_hook(|layout| {
        ARMED.store(false, Relaxed);
        eprintln!("INFALLIBLE allocation of {} bytes\n{}", layout.size(), std::backtrace::Backtrace::force_capture());
        std::process::exit(3);
    });
    let data = b"The quick brown fox jumps over the lazy dog, time and time again. Internet information.".repeat(40);
    // One byte less than the bound, so that there is no falling back to an uncompressed stream.
    let cap = bun_brotli::max_compressed_size(data.len()) - 1;
    let mut out = vec![0u8; cap];
    let mut expect = vec![0u8; cap];
    let mut n = cap;
    assert!(unsafe { crate::ffi::BrotliEncoderCompress(quality, 22, 0, data.len(), data.as_ptr(), &mut n, expect.as_mut_ptr()) } != 0);
    COUNTDOWN.store(at, Relaxed);
    PERSISTENT.store(persistent, Relaxed);
    let first = armed(|| bun_brotli::compress(quality, 22, bun_brotli::EncoderMode::Generic, &data, &mut out));
    COUNTDOWN.store(i64::MAX, Relaxed);
    let failed = FAILED.load(Relaxed) != 0;
    assert!(first.is_none() || out[..n] == expect[..n], "the first call gave something else");
    assert!(failed || first == Some(n));
    let second = bun_brotli::compress(quality, 22, bun_brotli::EncoderMode::Generic, &data, &mut out);
    assert!(second == Some(n) && out[..n] == expect[..n], "the call after the failed one: {second:?}, expected {n}");
    println!("{}", if !failed { "none" } else if first.is_some() { "survived" } else { "failed" });
}

pub fn cold() {
    let exe = std::env::current_exe().unwrap();
    for quality in [0, 1, 2, 4, 5, 9, 10, 11] {
        for persistent in [false, true] {
            let (mut failed, mut survived) = (0, 0);
            for at in 0.. {
                let o = std::process::Command::new(&exe).args(["oom-cold-probe", &quality.to_string(), &at.to_string(), &u8::from(persistent).to_string()]).output().unwrap();
                let text = String::from_utf8_lossy(&o.stdout);
                if !o.status.success() {
                    panic!("seed 0: quality {quality}, allocation {at}, persistent {persistent}: {}\n{}", o.status, String::from_utf8_lossy(&o.stderr).lines().filter(|l| l.contains("INFALLIBLE") || l.contains("panicked") || l.contains("brotli/") || l.contains("call")).take(8).collect::<Vec<_>>().join("\n"));
                }
                match text.trim() {
                    "none" => break,
                    "failed" => failed += 1,
                    _ => survived += 1,
                }
            }
            println!("q{quality} persistent {persistent}: {failed} allocations whose failure fails the first call, {survived} without effect; the next call always works");
        }
    }
}
