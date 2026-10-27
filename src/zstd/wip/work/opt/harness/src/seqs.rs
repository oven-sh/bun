//! A frame through the Rust block compressors and through the C library (`ZSTD_generateSequences`).
use crate::c;
use crate::data::{Rng, data};
use bun_zstd::testing::{Dict, Extra, State};
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
    hash_table3: *const u32, hash_log3: c_uint, sums: [c_uint; 8], freqs: [*const u32; 4],
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
    fn shim_frame2(c: *mut c::ZSTD_CCtx, cp: *const c_uint, dict: *const c_void, dict_size: usize, cdict: *const CDict, lit_mode: i32,
        seqs: *mut [u32; 3], nb_seqs: usize, e: *const ShimEntropy, out: *mut Sequence, cap: usize, first: *const c_void, first_size: usize, src: *const c_void, size: usize) -> usize;
}

#[repr(C)]
pub struct ShimEntropy { huf: [u64; 257], ll: [u32; 36], ml: [u32; 53], of: [u32; 32] }

/// What `shim_frame2` sets beside the parameters.
pub struct CExtra { lit_mode: u32, ldm: Vec<[u32; 3]>, entropy: Option<Box<ShimEntropy>>, first_chunk: Vec<u8> }

fn arr(p: CParams) -> [u32; 7] { [p.window_log, p.chain_log, p.hash_log, p.search_log, p.min_match, p.target_length, p.strategy] }

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Mode { NoDict, Prefix, CDict }

struct COut { seqs: Vec<(u32, u32, u32, u32)>, cp: [u32; 7], use_row: bool, cdict_cp: [u32; 7], state: State }

/// `None` if the C library refuses (a last block that is too small).
fn c_frame(cp: [u32; 7], use_row: bool, mode: Mode, dict: &[u8], src: &[u8], extra: Option<&CExtra>) -> Option<COut> {
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
            if extra.is_none() { c::res(ZSTD_CCtx_refCDict(cctx.0, cdict)).unwrap(); }
            cdict_cp = arr(ZSTD_getCParamsFromCDict(cdict));
        }
        cctx.set(1001, 1).unwrap(); // force attach
        cctx.set(101, cp[0] as i32).unwrap();
    } else {
        for (i, v) in cp.iter().enumerate() { cctx.set(101 + i as u32, *v as i32).unwrap(); }
        cctx.set(1011, if use_row { 1 } else { 2 }).unwrap(); // useRowMatchFinder
        if mode == Mode::Prefix { cctx.ref_prefix(dict).unwrap(); }
    }
    let total = src.len() + extra.map_or(0, |x| x.first_chunk.len());
    let mut out = vec![Sequence::default(); total / 3 + total / 1024 + 8];
    let n = c::res(unsafe {
        match extra {
            None => ZSTD_generateSequences(cctx.0, out.as_mut_ptr(), out.len(), src.as_ptr().cast(), src.len()),
            Some(x) => {
                let mut ldm = x.ldm.clone();
                let d = if mode == Mode::Prefix { dict } else { &[] };
                shim_frame2(cctx.0, cp.as_ptr(), d.as_ptr().cast(), d.len(), cdict, x.lit_mode as i32, ldm.as_mut_ptr(), ldm.len(),
                    x.entropy.as_deref().map_or(std::ptr::null(), |e| e), out.as_mut_ptr(), out.len(), x.first_chunk.as_ptr().cast(), x.first_chunk.len(), src.as_ptr().cast(), src.len())
            }
        }
    });
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
            hash_table3: table(s.hash_table3, if s.hash_log3 != 0 { 1 << s.hash_log3 } else { 0 }),
            sums: if s.cp[6] >= 7 { s.sums } else { [0; 8] },
            freqs: if s.cp[6] >= 7 { [table(s.freqs[0], 256), table(s.freqs[1], 36), table(s.freqs[2], 53), table(s.freqs[3], 32)] } else { Default::default() },
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
pub fn run(seed: u64, iters: u64, strategies: &[u32], modes: &[Mode], with_extra: bool) {
    let (mut with_ldm, mut with_entropy) = (0u64, 0u64);
    let mut skipped = 0u64;
    let mut dms_blocks = 0u64;
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        if i % 2000 == 0 { eprintln!("seqs iter {i} (seed {s})"); }
        let max = *rng.pick(&[40usize, 300, 3000, 30_000, 131_071, 400_000]);
        let len = rng.range(7, max);
        let mut src = data(&mut rng, len);
        if rng.chance(1, 40) {
            // Whole blocks of noise, of which only the end matches something.
            src = (0..(128 << 10) * rng.range(1, 2)).map(|_| rng.next() as u8).collect();
            let n = rng.range(9, 40);
            let (from, to) = (rng.below(src.len() - 2 * n), src.len() - n);
            src.copy_within(from..from + n, to);
        }
        let mode = *rng.pick(modes);
        let mut dict = if mode != Mode::NoDict { let m = *rng.pick(&[20usize, 1000, 100_000, 600_000]); let n = rng.size(m); data(&mut rng, n) } else { Vec::new() };
        if !dict.is_empty() && rng.chance(1, 4) {
            // The input goes on where the dictionary ends.
            let mut all = data(&mut rng, dict.len() + src.len());
            src = all.split_off(dict.len());
            dict = all;
        }
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
        let p = if with_extra && rng.chance(1, 2) { p } else { unsafe { ZSTD_adjustCParams(p, src.len() as u64, dict.len()) } };
        let use_row = rng.chance(1, 2);
        let extra = with_extra.then(|| {
            let mut ldm = Vec::new();
            if rng.chance(2, 3) {
                let max_ll = *rng.pick(&[4usize, 100, 3000, 100_000]);
                let max_ml = *rng.pick(&[8usize, 100, 3000, 5000, 200_000]);
                let target = if rng.chance(1, 4) { rng.below(src.len()) } else { src.len() + rng.below(1000) };
                let mut total = 0;
                while total < target {
                    let (ll, ml) = (rng.size(max_ll), rng.size(max_ml));
                    // Most of them are matches, as far as the block goes.
                    let at = total + ll;
                    let offset = if rng.chance(1, 8) || at == 0 || at >= src.len() { 1 + rng.size(1 << p.window_log) } else { 1 + rng.size(at - 1) };
                    ldm.push([offset as u32, ll as u32, ml as u32]);
                    total += ll + ml;
                }
            }
            let entropy = rng.chance(1, 2).then(|| {
                let mut e = Box::new(ShimEntropy { huf: [0; 257], ll: [0; 36], ml: [0; 53], of: [0; 32] });
                let max_symbol = if rng.chance(3, 4) { 255 } else { rng.below(256) as u64 };
                e.huf[0] = 11 | max_symbol << 8;
                let lo = rng.below(2);
                for v in &mut e.huf[1..] { *v = rng.range(lo, 11) as u64 | rng.next() << 8; }
                let mut fill = |t: &mut [u32], max: usize| for v in t { let bits = rng.range(lo, max) as u32; *v = (bits << 16).wrapping_sub(rng.below(1 << 16) as u32 * (bits != 0) as u32); };
                fill(&mut e.ll, 10); fill(&mut e.ml, 10); fill(&mut e.of, 9);
                e
            });
            let first_chunk = if src.len() > 20 && rng.chance(1, 2) {
                let rest = src.split_off(if rng.chance(1, 2) { rng.range(7, src.len() - 7) } else { src.len() - 7 - rng.size(src.len() - 14) });
                std::mem::replace(&mut src, rest)
            } else { Vec::new() };
            CExtra { lit_mode: rng.below(3) as u32, ldm, entropy, first_chunk }
        });
        let Some(mut c) = c_frame(arr(p), use_row, mode, &dict, &src, extra.as_ref()) else { skipped += 1; continue };
        let d = match mode { Mode::NoDict => Dict::None, Mode::Prefix => Dict::Prefix(&dict), Mode::CDict => Dict::CDict(&dict, c.cdict_cp) };
        let what = format!("seed {s}: {mode:?} cp {:?} cdict cp {:?} row {} dict {} src {}", c.cp, c.cdict_cp, c.use_row, dict.len(), src.len());
        let ldm: Vec<(u32, u32, u32)> = extra.iter().flat_map(|x| &x.ldm).map(|s| (s[0], s[1], s[2])).collect();
        let x = extra.as_ref().map_or(Extra::default(), |x| Extra {
            lit_mode: x.lit_mode, ldm: &ldm, entropy: x.entropy.as_deref().map(|e| (&e.huf, &e.ll, &e.ml, &e.of)),
            first_chunk: &x.first_chunk,
        });
        with_ldm += !ldm.is_empty() as u64;
        with_entropy += x.entropy.is_some() as u64;
        let what = format!("{what} lit mode {} ldm {} entropy {} first chunk {}", x.lit_mode, ldm.len(), x.entropy.is_some(), x.first_chunk.len());
        let (got, mut state) = bun_zstd::testing::frame2(c.cp, c.use_row, d, &src, x).unwrap_or_else(|e| panic!("{what}: error {e:?}"));
        if x.lit_mode == 2 {
            // Nothing writes the statistics of literals.
            state.freqs[0].clear(); c.state.freqs[0].clear();
            state.sums[0] = 0; c.state.sums[0] = 0; state.sums[4] = 0; c.state.sums[4] = 0;
        }
        if mode == Mode::CDict && dict.len() >= 8 { dms_blocks += 1; }
        if let Some(at) = first_diff(&got, &c.seqs) {
            panic!("{what}: sequence {at} differs: got {:?}, expected {:?} ({} vs {} sequences)", got.get(at), c.seqs.get(at), got.len(), c.seqs.len());
        }
        if state != c.state {
            let (a, b) = (&state, &c.state);
            panic!("{what}: state differs: hash table 3 {:?} sums {:?} {:?} freqs {:?} hash table {:?} chain table {:?} tag table {:?}\n got {:?}\n exp {:?}",
                first_diff(&a.hash_table3, &b.hash_table3), a.sums, b.sums, a.freqs == b.freqs, first_diff(&a.hash_table, &b.hash_table), first_diff(&a.chain_table, &b.chain_table), first_diff(&a.tag_table, &b.tag_table),
                (a.has_dms, a.next_to_update, a.loaded_dict_end, a.low_limit, a.dict_limit, a.hash_salt_entropy, a.lazy_skipping, a.hash_cache, a.rep),
                (b.has_dms, b.next_to_update, b.loaded_dict_end, b.low_limit, b.dict_limit, b.hash_salt_entropy, b.lazy_skipping, b.hash_cache, b.rep));
        }
    }
    println!("seqs ok: {iters} iterations from seed {seed} ({skipped} skipped, {dms_blocks} with an attached CDict, {with_ldm} with LDM sequences, {with_entropy} with entropy tables), strategies {strategies:?}, modes {modes:?}");
}
