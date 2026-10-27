//! One block through a Rust block compressor and through the C library (`ZSTD_generateSequences`).
use crate::c;
use crate::data::{Rng, data};
use std::ffi::{c_uint, c_void};

#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
struct Sequence { offset: c_uint, lit_length: c_uint, match_length: c_uint, rep: c_uint }
#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct CParams { window_log: c_uint, chain_log: c_uint, hash_log: c_uint, search_log: c_uint, min_match: c_uint, target_length: c_uint, strategy: c_uint }
unsafe extern "C" {
    fn ZSTD_generateSequences(c: *mut c::ZSTD_CCtx, out: *mut Sequence, cap: usize, src: *const c_void, size: usize) -> usize;
    fn ZSTD_adjustCParams(p: CParams, src_size: u64, dict_size: usize) -> CParams;
    fn ZSTD_getCParams(level: i32, src_size: u64, dict_size: usize) -> CParams;
}

fn c_sequences(cp: [u32; 7], use_row: bool, dict: &[u8], src: &[u8]) -> Vec<(u32, u32, u32)> {
    let mut cctx = c::CCtx::new();
    // windowLog, chainLog, hashLog, searchLog, minMatch, targetLength, strategy
    for (id, v) in [101, 103, 102, 104, 105, 106, 107].iter().zip(cp) { cctx.set(*id, v as i32).unwrap(); }
    cctx.set(1011, if use_row { 1 } else { 2 }).unwrap(); // useRowMatchFinder
    cctx.set(1010, 2).unwrap(); // no block splitter
    if !dict.is_empty() { cctx.ref_prefix(dict).unwrap(); }
    let mut out = vec![Sequence::default(); src.len() / 3 + 8];
    let n = c::res(unsafe { ZSTD_generateSequences(cctx.0, out.as_mut_ptr(), out.len(), src.as_ptr().cast(), src.len()) }).unwrap();
    out[..n].iter().map(|s| (s.lit_length, s.match_length, s.offset)).collect()
}

/// `strategies`: which of 1..=9 to test. `with_dict`: also test with a prefix, which is the extDict variants.
pub fn run(seed: u64, iters: u64, strategies: &[u32], with_dict: bool) {
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        if i % 500 == 0 { eprintln!("seqs iter {i} (seed {s})"); }
        let max = *rng.pick(&[40usize, 300, 3000, 30_000, 131_071]);
        let len = rng.range(7, max);
        let mut src = data(&mut rng, len);
        let dict = if with_dict && rng.chance(1, 2) { let m = *rng.pick(&[20usize, 1000, 100_000, 600_000]); let n = rng.size(m); data(&mut rng, n) } else { Vec::new() };
        if !dict.is_empty() && rng.chance(2, 3) {
            for _ in 0..rng.range(1, 6) {
                let n = rng.size(dict.len().min(src.len()));
                let at = rng.below(dict.len() - n + 1);
                let to = rng.below(src.len() - n + 1);
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
        // The C library refuses to give the sequences of a block of less than 7 bytes.
        let block_size = (1usize << p.window_log).min(128 << 10);
        if src.len() % block_size != 0 && src.len() % block_size < 7 { src.truncate(src.len() - src.len() % block_size); }
        let p = unsafe { ZSTD_adjustCParams(p, src.len() as u64, dict.len()) };
        let cp = [p.window_log, p.chain_log, p.hash_log, p.search_log, p.min_match, p.target_length, p.strategy];
        let use_row = rng.chance(1, 2);
        let expected = c_sequences(cp, use_row, &dict, &src);
        let got = bun_zstd::testing::first_block(cp, use_row, &dict, &src);
        let got = got.unwrap_or_else(|e| panic!("seed {s}: error {e:?} (cp {cp:?} row {use_row} dict {} src {})", dict.len(), src.len()));
        if got != expected {
            let at = got.iter().zip(&expected).position(|(a, b)| a != b).unwrap_or(got.len().min(expected.len()));
            panic!("seed {s}: cp {cp:?} row {use_row} dict {} src {}: sequence {at} differs: got {:?}, expected {:?} ({} vs {} sequences)",
                dict.len(), src.len(), got.get(at), expected.get(at), got.len(), expected.len());
        }
    }
    println!("seqs ok: {iters} iterations from seed {seed}, strategies {strategies:?}, dict {with_dict}");
}
