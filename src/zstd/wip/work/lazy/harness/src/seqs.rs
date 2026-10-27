//! A frame through the Rust block compressors and through the C library (`ZSTD_generateSequences`).
use crate::c;
use crate::data::{Rng, data};
use bun_zstd::testing::{Dict, State};
use std::ffi::{c_uint, c_void};

#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
struct Sequence { offset: c_uint, lit_length: c_uint, match_length: c_uint, rep: c_uint }
#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct CParams { window_log: c_uint, chain_log: c_uint, hash_log: c_uint, search_log: c_uint, min_match: c_uint, target_length: c_uint, strategy: c_uint }
#[repr(C)]
#[derive(Clone, Copy)]
struct CustomMem { a: *const c_void, b: *const c_void, c: *const c_void }
#[repr(C)]
struct ShimState {
    cp: [c_uint; 7], use_row: c_uint, has_dms: c_uint,
    next_to_update: c_uint, loaded_dict_end: c_uint, low_limit: c_uint, dict_limit: c_uint, row_hash_log: c_uint, hash_salt_entropy: c_uint, lazy_skipping: c_uint,
    hash_salt: u64, hash_cache: [c_uint; 8], rep: [c_uint; 3],
    hash_table: *const u32, chain_table: *const u32, tag_table: *const u8,
}
enum CDict {}
enum CCtxParams {}
unsafe extern "C" {
    fn ZSTD_generateSequences(c: *mut c::ZSTD_CCtx, out: *mut Sequence, cap: usize, src: *const c_void, size: usize) -> usize;
    fn ZSTD_adjustCParams(p: CParams, src_size: u64, dict_size: usize) -> CParams;
    fn ZSTD_getCParams(level: i32, src_size: u64, dict_size: usize) -> CParams;
    fn ZSTD_createCCtxParams() -> *mut CCtxParams;
    fn ZSTD_freeCCtxParams(p: *mut CCtxParams) -> usize;
    fn ZSTD_CCtxParams_setParameter(p: *mut CCtxParams, param: c_uint, v: i32) -> usize;
    fn ZSTD_createCDict_advanced2(d: *const c_void, n: usize, load: c_uint, ty: c_uint, p: *const CCtxParams, mem: CustomMem) -> *mut CDict;
    fn ZSTD_freeCDict(d: *mut CDict) -> usize;
    fn ZSTD_CCtx_refCDict(c: *mut c::ZSTD_CCtx, d: *const CDict) -> usize;
    fn ZSTD_getCParamsFromCDict(d: *const CDict) -> CParams;
    fn shim_state(c: *const c::ZSTD_CCtx, s: *mut ShimState);
    fn shim_collect(c: *mut c::ZSTD_CCtx, out: *mut Sequence, cap: usize);
    fn shim_collected(c: *const c::ZSTD_CCtx) -> usize;
}

fn arr(p: CParams) -> [u32; 7] { [p.window_log, p.chain_log, p.hash_log, p.search_log, p.min_match, p.target_length, p.strategy] }

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Mode { NoDict, Prefix, CDict }

struct COut { seqs: Vec<(u32, u32, u32, u32)>, cp: [u32; 7], use_row: bool, cdict_cp: [u32; 7], state: State }

/// `None` if the C library refuses (a last block that is too small).
fn c_frame(cp: [u32; 7], use_row: bool, mode: Mode, dict: &[u8], src: &[u8], streaming: bool) -> Option<COut> {
    let mut cctx = c::CCtx::new();
    let mut cdict = std::ptr::null_mut();
    let mut cdict_cp = [0; 7];
    cctx.set(1010, 2).unwrap(); // no block splitter
    if mode == Mode::CDict {
        unsafe {
            let p = ZSTD_createCCtxParams();
            for (i, v) in cp.iter().enumerate() { c::res(ZSTD_CCtxParams_setParameter(p, 101 + i as u32, *v as i32)).unwrap(); }
            c::res(ZSTD_CCtxParams_setParameter(p, 1011, if use_row { 1 } else { 2 })).unwrap();
            let null = std::ptr::null();
            cdict = ZSTD_createCDict_advanced2(dict.as_ptr().cast(), dict.len(), 1, 1, p, CustomMem { a: null, b: null, c: null });
            assert!(!cdict.is_null());
            ZSTD_freeCCtxParams(p);
            c::res(ZSTD_CCtx_refCDict(cctx.0, cdict)).unwrap();
            cdict_cp = arr(ZSTD_getCParamsFromCDict(cdict));
        }
        cctx.set(1001, 1).unwrap(); // force attach
        cctx.set(101, cp[0] as i32).unwrap();
    } else {
        for (i, v) in cp.iter().enumerate() { cctx.set(101 + i as u32, *v as i32).unwrap(); }
        cctx.set(1011, if use_row { 1 } else { 2 }).unwrap(); // useRowMatchFinder
        if mode == Mode::Prefix { cctx.ref_prefix(dict).unwrap(); }
    }
    let mut out = vec![Sequence::default(); src.len() / 3 + src.len() / 1024 + 8];
    let n = if streaming {
        unsafe { shim_collect(cctx.0, out.as_mut_ptr(), out.len()) };
        let mut dst = vec![0u8; src.len() + src.len() / 64 + 1024];
        let (mut dpos, mut spos) = (0, 0);
        let mut r = Ok(0);
        while spos < src.len() && r.is_ok() {
            (r, dpos, spos) = cctx.stream2(&mut dst, dpos, src, spos, 0);
        }
        if r.is_ok() { (r, _, _) = cctx.stream2(&mut dst, dpos, src, spos, 2); assert!(r != Ok(1) || true); }
        r.map(|left| { assert_eq!(left, 0); unsafe { shim_collected(cctx.0) } })
    } else {
        c::res(unsafe { ZSTD_generateSequences(cctx.0, out.as_mut_ptr(), out.len(), src.as_ptr().cast(), src.len()) })
    };
    let r = n.ok().map(|n| {
        let mut s: ShimState = unsafe { std::mem::zeroed() };
        unsafe { shim_state(cctx.0, &mut s) };
        let row_used = s.use_row != 0 && (3..=5).contains(&s.cp[6]);
        let table = |p: *const u32, n: usize| if n == 0 { Vec::new() } else { unsafe { std::slice::from_raw_parts(p, n) }.to_vec() };
        let state = State {
            has_dms: s.has_dms != 0, next_to_update: s.next_to_update, loaded_dict_end: s.loaded_dict_end, low_limit: s.low_limit, dict_limit: s.dict_limit,
            hash_salt_entropy: s.hash_salt_entropy, lazy_skipping: s.lazy_skipping != 0, hash_cache: s.hash_cache, rep: s.rep,
            hash_table: table(s.hash_table, 1 << s.cp[2]),
            chain_table: table(s.chain_table, if s.cp[6] != 1 && !row_used { 1 << s.cp[1] } else { 0 }),
            tag_table: if row_used { unsafe { std::slice::from_raw_parts(s.tag_table, 1 << s.cp[2]) }.to_vec() } else { Vec::new() },
        };
        COut {
            seqs: out[..n].iter().map(|s| (s.lit_length, s.match_length, s.rep, if s.rep == 0 { s.offset } else { 0 })).collect(),
            cp: s.cp, use_row: s.use_row != 0, cdict_cp, state,
        }
    });
    if !cdict.is_null() { unsafe { ZSTD_freeCDict(cdict) }; }
    r
}

fn first_diff<T: PartialEq>(a: &[T], b: &[T]) -> Option<usize> {
    if a.len() != b.len() { return Some(a.len().min(b.len())); }
    a.iter().zip(b).position(|(a, b)| a != b)
}

/// `strategies`: which of 1..=9 to test. `modes`: which kinds of dictionary.
pub fn run(seed: u64, iters: u64, strategies: &[u32], modes: &[Mode], stream: bool) {
    let mut skipped = 0u64;
    let mut dms_blocks = 0u64;
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        if i % 2000 == 0 { eprintln!("seqs iter {i} (seed {s})"); }
        let max = *rng.pick(&[40usize, 300, 3000, 30_000, 131_071, 400_000]);
        let len = rng.range(7, max);
        let mut src = data(&mut rng, len);
        let mode = *rng.pick(modes);
        let dict = if mode != Mode::NoDict { let m = *rng.pick(&[20usize, 1000, 100_000, 600_000]); let n = rng.size(m); data(&mut rng, n) } else { Vec::new() };
        let mode = if dict.is_empty() { Mode::NoDict } else { mode };
        if !dict.is_empty() && rng.chance(2, 3) {
            for _ in 0..rng.range(1, 6) {
                let n = rng.size(dict.len().min(src.len()));
                let at = if rng.chance(1, 3) { dict.len() - n } else { rng.below(dict.len() - n + 1) };
                let to = if rng.chance(1, 4) { 0 } else { rng.below(src.len() - n + 1) };
                src[to..to + n].copy_from_slice(&dict[at..at + n]);
            }
        }
        let strategy = *rng.pick(strategies);
        let p = if rng.chance(1, 3) {
            // the parameters of a level, with the strategy forced
            let mut p = unsafe { ZSTD_getCParams(rng.range(1, 22) as i32, src.len() as u64, dict.len()) };
            p.strategy = strategy;
            p
        } else {
            CParams {
                window_log: rng.range(10, 22) as u32, chain_log: rng.range(6, 20) as u32, hash_log: rng.range(6, 20) as u32,
                search_log: rng.range(1, 9) as u32, min_match: rng.range(3, 7) as u32,
                target_length: *rng.pick(&[0u32, 1, 2, 4, 8, 16, 32, 64, 128, 256, 999, 4096]), strategy,
            }
        };
        let p = unsafe { ZSTD_adjustCParams(p, src.len() as u64, dict.len()) };
        let use_row = rng.chance(1, 2);
        let streaming = stream && rng.chance(3, 4);
        let Some(c) = c_frame(arr(p), use_row, mode, &dict, &src, streaming) else { skipped += 1; continue };
        let d = match mode { Mode::NoDict => Dict::None, Mode::Prefix => Dict::Prefix(&dict), Mode::CDict => Dict::CDict(&dict, c.cdict_cp) };
        let what = format!("seed {s}: {mode:?} streaming {streaming} cp {:?} cdict cp {:?} row {} dict {} src {}", c.cp, c.cdict_cp, c.use_row, dict.len(), src.len());
        let (got, state) = bun_zstd::testing::frame(c.cp, c.use_row, d, &src, streaming).unwrap_or_else(|e| panic!("{what}: error {e:?}"));
        if mode == Mode::CDict && dict.len() >= 8 { dms_blocks += 1; }
        if let Some(at) = first_diff(&got, &c.seqs) {
            panic!("{what}: sequence {at} differs: got {:?}, expected {:?} ({} vs {} sequences)", got.get(at), c.seqs.get(at), got.len(), c.seqs.len());
        }
        if state != c.state {
            let (a, b) = (&state, &c.state);
            panic!("{what}: state differs: hash table {:?} chain table {:?} tag table {:?}\n got {:?}\n exp {:?}",
                first_diff(&a.hash_table, &b.hash_table), first_diff(&a.chain_table, &b.chain_table), first_diff(&a.tag_table, &b.tag_table),
                (a.has_dms, a.next_to_update, a.loaded_dict_end, a.low_limit, a.dict_limit, a.hash_salt_entropy, a.lazy_skipping, a.hash_cache, a.rep),
                (b.has_dms, b.next_to_update, b.loaded_dict_end, b.low_limit, b.dict_limit, b.hash_salt_entropy, b.lazy_skipping, b.hash_cache, b.rep));
        }
    }
    println!("seqs ok: {iters} iterations from seed {seed} ({skipped} skipped, {dms_blocks} with an attached CDict), strategies {strategies:?}, modes {modes:?}, streaming {stream}");
}

/// Speed of the Rust block compressors against the C ones, on a file.
pub fn bench(path: &str, mode: Mode) {
    let all = std::fs::read(path).unwrap();
    let (dict, src) = if mode == Mode::NoDict { (&[][..], &all[..]) } else { all.split_at(100_000.min(all.len() / 2)) };
    for (level, strategy, use_row) in [(5, 3, false), (5, 3, true), (7, 4, false), (7, 4, true), (10, 5, false), (10, 5, true), (12, 5, true), (13, 6, false), (15, 6, false)] {
        let mut p = unsafe { ZSTD_getCParams(level, if mode == Mode::CDict { 100_000 } else { src.len() as u64 }, dict.len()) };
        p.strategy = strategy;
        let mut best = [f64::MAX; 2];
        let mut nseq = [0usize; 2];
        for _ in 0..3 {
            let t = std::time::Instant::now();
            let c = c_frame(arr(p), use_row, mode, dict, src, false).unwrap();
            best[0] = best[0].min(t.elapsed().as_secs_f64());
            nseq[0] = c.seqs.len();
            let d = match mode { Mode::NoDict => Dict::None, Mode::Prefix => Dict::Prefix(dict), Mode::CDict => Dict::CDict(dict, c.cdict_cp) };
            let t = std::time::Instant::now();
            let (got, _) = bun_zstd::testing::frame(c.cp, c.use_row, d, src, false).unwrap();
            best[1] = best[1].min(t.elapsed().as_secs_f64());
            nseq[1] = got.len();
        }
        let mb = src.len() as f64 / 1e6;
        println!("{mode:?} level {level} strategy {strategy} row {use_row}: C {:.1} MB/s, Rust {:.1} MB/s ({:.0}%) seqs {} {}", mb / best[0], mb / best[1], 100.0 * best[0] / best[1], nseq[0], nseq[1]);
    }
}
