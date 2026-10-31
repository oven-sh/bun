//! Allocations that fail. Every one has to end in an error that is reported, never in an abort.
use crate::r#gen;
use crate::rng::Rng;
use bun_brotli::{Decoder, DecoderParameter, DecoderResult, Encoder, EncoderError, EncoderOperation, EncoderParameter, PreparedDictionary, StreamingDecoder};
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

/// For `oom-sites`: the line of the crate that each allocation comes from.
static RECORDING: AtomicBool = AtomicBool::new(false);
/// What is allocated for that record does not count.
static BUSY: AtomicBool = AtomicBool::new(false);
static SITES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// The innermost line of the crate in a backtrace, not counting its helpers for allocating.
fn site_of(backtrace: &str) -> String {
    let lines = backtrace.lines().filter_map(|l| l.trim().strip_prefix("at "));
    let mut files = lines.filter_map(|l| l.split_once("/src/brotli/").or_else(|| l.split_once("/bun_brotli/src/"))).map(|(_, f)| f);
    let at = files.find(|f| !f.starts_with("util.rs")).unwrap_or("?");
    at.rsplit_once(':').map_or(at, |(f, _)| f).to_string()
}

fn fails() -> bool {
    if !ARMED.load(Relaxed) || BUSY.load(Relaxed) {
        return false;
    }
    if RECORDING.load(Relaxed) {
        BUSY.store(true, Relaxed);
        let site = site_of(&std::backtrace::Backtrace::force_capture().to_string());
        SITES.lock().unwrap().push(site);
        BUSY.store(false, Relaxed);
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
        meter(0, l.size());
        if fails() { std::ptr::null_mut() } else { unsafe { System.alloc(l) } }
    }
    unsafe fn alloc_zeroed(&self, l: Layout) -> *mut u8 {
        meter(0, l.size());
        if fails() { std::ptr::null_mut() } else { unsafe { System.alloc_zeroed(l) } }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        // An allocator that cannot grow a block in place has both for a moment.
        meter(0, n);
        meter(l.size(), 0);
        if fails() { std::ptr::null_mut() } else { unsafe { System.realloc(p, l, n) } }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        meter(l.size(), 0);
        unsafe { System.dealloc(p, l) }
    }
}

/// For `mem-scan`: what is allocated while this is set.
static METERED: AtomicBool = AtomicBool::new(false);
static LIVE: AtomicI64 = AtomicI64::new(0);
static PEAK: AtomicI64 = AtomicI64::new(0);
static ALLOCATIONS: AtomicU64 = AtomicU64::new(0);

fn meter(freed: usize, allocated: usize) {
    if METERED.load(Relaxed) {
        let live = LIVE.fetch_add(allocated as i64 - freed as i64, Relaxed) + allocated as i64 - freed as i64;
        PEAK.fetch_max(live, Relaxed);
        ALLOCATIONS.fetch_add(u64::from(allocated != 0), Relaxed);
    }
}

pub fn meter_reset() {
    LIVE.store(0, Relaxed);
    PEAK.store(0, Relaxed);
    ALLOCATIONS.store(0, Relaxed);
}

/// (bytes now, most bytes at a time, allocations) of what ran in `metered` since `meter_reset`.
pub fn meter_read() -> (usize, usize, usize) {
    (LIVE.load(Relaxed) as usize, PEAK.load(Relaxed) as usize, ALLOCATIONS.load(Relaxed) as usize)
}

pub fn metered<T>(f: impl FnOnce() -> T) -> T {
    METERED.store(true, Relaxed);
    let r = f();
    METERED.store(false, Relaxed);
    r
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
    /// After every piece.
    flush: bool,
    cap: usize,
}

/// `None` if a call failed.
fn encode(c: &Case) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(c.data.len() * 2 + 4096);
    let mut buf = vec![0u8; c.cap];
    let dict = c.dict.clone().map(Vec::into_boxed_slice);
    let mut e = armed(Encoder::new);
    for &(k, v) in &c.params {
        assert!(e.set_parameter(EncoderParameter::from_raw(k).unwrap(), v));
    }
    if let Some(d) = dict {
        if !armed(|| PreparedDictionary::new(d).is_some_and(|p| e.attach_prepared_dictionary(p))) {
            return None;
        }
    }
    // With flushes, every other piece is 40 times as long: from the start of a stream to well into it in one step.
    let mut rest = &c.data[..];
    let mut long = true;
    let mut pieces = std::iter::from_fn(|| {
        long = !long && c.flush;
        let piece = rest.split_off(..c.chunk.max(1).saturating_mul(if long { 40 } else { 1 }).min(rest.len()))?;
        (!piece.is_empty()).then_some(piece)
    })
    .peekable();
    loop {
        let piece = pieces.next().unwrap_or(&[]);
        let op = if pieces.peek().is_none() { EncoderOperation::Finish } else if c.flush { EncoderOperation::Flush } else { EncoderOperation::Process };
        let mut input = piece;
        loop {
            let mut o: &mut [u8] = &mut buf;
            let ok = armed(|| e.compress_stream(op, &mut input, &mut o));
            let made = c.cap - o.len();
            if let Err(error) = ok {
                assert_eq!(error, EncoderError::OutOfMemory);
                // It stays that way.
                let mut o: &mut [u8] = &mut buf;
                ARMED.store(false, Relaxed);
                assert_eq!(e.compress_stream(op, &mut input, &mut o), Err(error), "a call after a failed one");
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

fn decode_streaming(stream: &[u8], chunk: usize) -> Result<Vec<u8>, bun_brotli::Error> {
    let mut out = Vec::new();
    let mut d = armed(StreamingDecoder::new);
    let mut pos = 0usize;
    loop {
        let end = pos.saturating_add(chunk.max(1)).min(stream.len());
        match armed(|| d.decompress(&stream[pos..end], &mut out, usize::MAX, end == stream.len())) {
            Ok(_) => return Ok(out),
            Err(bun_brotli::Error::ShortRead) if end < stream.len() => pos = end,
            Err(e) => {
                // It stays that way.
                let len = out.len();
                assert!(matches!(d.decompress(&stream[pos..end], &mut out, usize::MAX, true), Ok(n) if n == end - pos) && out.len() == len && !d.is_inflating(), "a call after a failed one did something");
                return Err(e);
            }
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
pub fn uncompressed_stream(input: &[u8]) -> Vec<u8> {
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
        let bound = bun_brotli::max_compressed_size(len).unwrap();
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

/// An allocation that cannot fail, and does, becomes a panic that says where it was.
fn set_hooks() {
    std::alloc::set_alloc_error_hook(|layout| {
        ARMED.store(false, Relaxed);
        let at = site_of(&std::backtrace::Backtrace::force_capture().to_string());
        MAX_SIZE.fetch_max(layout.size() as u64, Relaxed);
        panic!("INFALLIBLE allocation at {at}");
    });
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if !QUIET.load(Relaxed) {
            default_hook(info);
        }
    }));
}

/// `f` without a failure, and the line of the crate that each of its allocations comes from.
fn recorded<T>(f: impl FnOnce() -> T) -> (T, Vec<String>) {
    SITES.lock().unwrap().clear();
    RECORDING.store(true, Relaxed);
    let r = f();
    RECORDING.store(false, Relaxed);
    (r, std::mem::take(&mut SITES.lock().unwrap()))
}

/// `run` picks allocations at random, and seldom one that happens once in thousands. Here the first and the last allocation
/// of every line of the crate that allocates fail, in streams that between them get to all the parts of the codec.
pub fn sites(corpus: &r#gen::Corpus) {
    set_hooks();
    let mut rng = Rng(1);
    let mixed = r#gen::data(&mut rng, corpus, 300_000);
    // Text in letters of two bytes, for which the literals get a context map below quality 10, too. ASCII does not.
    let text: String = (0..100_000).map(|_| if rng.chance(1, 6) { ' ' } else { char::from_u32(0x430 + rng.below(32) as u32).unwrap() }).collect();
    let text = text.as_bytes();
    // Stretches of a hundred kinds: many block types, and many histograms to cluster.
    let kinds: Vec<Vec<u8>> = (0..100).map(|_| (0..rng.range(2, 12)).map(|_| rng.next() as u8).collect()).collect();
    let mut blocks = Vec::new();
    while blocks.len() < 400_000 {
        let kind = rng.pick(&kinds).clone();
        blocks.extend((0..rng.range(300, 900)).map(|_| *rng.pick(&kind)));
    }
    let mut cases = Vec::new();
    for q in 0..12u32 {
        let case = |data: &[u8], more: &[(u32, u32)], dict: Option<&[u8]>, chunk: usize, flush: bool| Case {
            data: data.to_vec(),
            params: [&[(1, q)], more].concat(),
            dict: dict.map(<[u8]>::to_vec),
            chunk,
            flush,
            cap: 1 << 16,
        };
        cases.push(case(&mixed, &[], None, usize::MAX, false));
        cases.push(case(&blocks, &[], None, 100_000, false));
        cases.push(case(&mixed[..70_000], &[(2, 16)], Some(&mixed[100_000..130_000]), 900, true));
        cases.push(case(&mixed[..150_000], &[(6, 1), (2, 25), (5, 1 << 20)], None, 5000, false));
        cases.push(case(&mixed[..100], &[(9, 3)], None, usize::MAX, false));
        cases.push(case(text, &[], None, usize::MAX, false));
        // A flush within the first KiB, then 36,000 bytes at once.
        cases.push(case(&mixed[..70_000], &[], None, 900, true));
    }
    let mut seen = std::collections::BTreeMap::<String, u64>::new();
    let mut problems = Vec::new();
    let mut runs = 0u64;
    // The first and the last index of each line.
    let picks = |sites: &[String]| -> Vec<(String, i64)> {
        let mut ends = std::collections::BTreeMap::<&String, (usize, usize)>::new();
        for (i, site) in sites.iter().enumerate() {
            ends.entry(site).or_insert((i, i)).1 = i;
        }
        ends.into_iter().flat_map(|(site, (first, last))| [(site.clone(), first as i64), (site.clone(), last as i64)]).collect()
    };
    for case in &cases {
        let describe = format!("{} bytes, params {:?}, dict {:?}, chunk {}, flush {}", case.data.len(), case.params, case.dict.as_ref().map(Vec::len), case.chunk, case.flush);
        let (stream, allocations) = recorded(|| encode(case));
        let stream = stream.unwrap_or_else(|| panic!("{describe}: failed without a failure"));
        for (site, at) in picks(&allocations) {
            for persistent in [false, true] {
                let c = case.clone();
                let (r, failed) = with_failure(at, persistent, move || encode(&c));
                runs += 1;
                *seen.entry(site.clone()).or_default() += 1;
                match r {
                    Err(e) => problems.push(format!("{e}: {describe}, encoder allocation {at} of {} ({site}), persistent {persistent}", allocations.len())),
                    Ok(Some(out)) if failed != 0 && out != stream => problems.push(format!("other output after a failed allocation: {describe}, allocation {at} ({site})")),
                    _ => {}
                }
            }
        }
        let (back, allocations) = recorded(|| decode(&stream, case.dict.as_ref(), 1000, 1 << 14, case.data.len()));
        // A stream with an offset does not decode on its own.
        if back.as_ref().is_ok_and(|out| *out == case.data) {
            for (site, at) in picks(&allocations) {
                for persistent in [false, true] {
                    let (s, d, len) = (stream.clone(), case.dict.clone(), case.data.len());
                    let (r, _) = with_failure(at, persistent, move || decode(&s, d.as_ref(), 1000, 1 << 14, len));
                    runs += 1;
                    *seen.entry(site.clone()).or_default() += 1;
                    match r {
                        Err(e) => problems.push(format!("{e}: {describe}, decoder allocation {at} of {} ({site}), persistent {persistent}", allocations.len())),
                        Ok(Err(code)) if !(-30..=-21).contains(&code) && code != -1000 => problems.push(format!("decoder error {code}: {describe}, allocation {at} ({site})")),
                        _ => {}
                    }
                }
            }
        }
        let (back, allocations) = recorded(|| decode_streaming(&stream, 1000));
        if back.is_ok_and(|out| out == case.data) {
            for (site, at) in picks(&allocations) {
                let s = stream.clone();
                let (r, _) = with_failure(at, true, move || decode_streaming(&s, 1000));
                runs += 1;
                *seen.entry(site.clone()).or_default() += 1;
                match r {
                    Err(e) => problems.push(format!("{e}: {describe}, StreamingDecoder allocation {at} of {} ({site})", allocations.len())),
                    Ok(Err(bun_brotli::Error::OutOfMemory)) => {}
                    Ok(other) => problems.push(format!("StreamingDecoder: {:?}: {describe}, allocation {at} ({site})", other.map(|out| out.len()))),
                }
            }
        }
    }
    let _ = std::panic::take_hook();
    for (site, n) in &seen {
        println!("{n:6} {site}");
    }
    for p in &problems {
        println!("PROBLEM: {p}");
    }
    assert!(problems.is_empty(), "seed 0: {} problems", problems.len());
    println!("ok: {} lines that allocate, {runs} runs", seen.len());
}

pub fn run(seed0: u64, iters: u64, max_len: usize, corpus: &r#gen::Corpus) {
    set_hooks();
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
        // One in 16: at qualities 5 and 6, a flush within the first KiB and then more than 32 KiB at once. The table gets a
        // block for every bucket while it has room for a few.
        let jump = seed % 16 == 0;
        let len = if jump { rng.range(40_000, 60_000) } else { r#gen::length(&mut rng, max_len) };
        let data = r#gen::data(&mut rng, corpus, len);
        let q = if jump { rng.range(5, 6) } else { rng.below(12) } as u32;
        let mut params = vec![(1, q)];
        if !jump && rng.chance(2, 3) {
            params.push((2, rng.range(10, 24) as u32));
        }
        if !jump && rng.chance(1, 6) {
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
        // With flushes the tables of the hashers grow and change while they are in use.
        let flush = jump || rng.chance(1, 4);
        let chunk = if jump { 900 } else if flush { *rng.pick(&[300, 900, 5000, 15000]) } else { *rng.pick(&[usize::MAX, 1 << 16, 5000, 100_000]) };
        let case = Case { data, params, dict, chunk, flush, cap: *rng.pick(&[1 << 22, 1 << 16, 700]) };
        let describe = format!("seed {seed} len {len} params {:?} dict {:?} chunk {} flush {flush} cap {}", case.params, case.dict.as_ref().map(Vec::len), case.chunk, case.cap);
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
        if case.dict.is_some() || case.params.contains(&(6, 1)) {
            continue;
        }
        COUNT.store(0, Relaxed);
        assert!(decode_streaming(&stream, dchunk).is_ok_and(|out| out == case.data), "{describe}: StreamingDecoder");
        let n_str = COUNT.load(Relaxed) as i64;
        for at in pick(&mut rng, n_str) {
            let persistent = rng.chance(1, 2);
            let s = stream.clone();
            let (r, failed) = with_failure(at, persistent, move || decode_streaming(&s, dchunk));
            runs += 1;
            injected += failed.min(1);
            let problem = match r {
                Err(e) => e,
                Ok(Err(bun_brotli::Error::OutOfMemory)) => continue,
                Ok(Err(_)) => "StreamingDecoder reports another error after a failed allocation".into(),
                Ok(Ok(out)) if out == case.data => {
                    survived += 1;
                    continue;
                }
                Ok(Ok(_)) => "StreamingDecoder went on after a failed allocation with other output".into(),
            };
            problems.entry(problem).or_insert((0, format!("{describe} StreamingDecoder allocation {at}/{n_str} persistent {persistent} chunk {dchunk}"))).0 += 1;
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
    let cap = bun_brotli::max_compressed_size(data.len()).unwrap() - 1;
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
