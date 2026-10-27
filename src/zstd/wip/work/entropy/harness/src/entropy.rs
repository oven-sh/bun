//! The entropy encoders (`hist`, `fse`, `huf`) against the C library, function by function.
use crate::c::res;
use crate::data::{Rng, data};
use bun_zstd::ErrorCode;
use bun_zstd::testing::entropy as rs;
use std::ffi::{c_int, c_uint, c_void};

#[repr(C)]
struct CTableHeader { table_log: u8, max_symbol_value: u8, unused: [u8; 6] }

unsafe extern "C" {
    fn HIST_add(count: *mut c_uint, src: *const c_void, size: usize);
    fn HIST_count_simple(count: *mut c_uint, max: *mut c_uint, src: *const c_void, size: usize) -> c_uint;
    fn HIST_countFast_wksp(count: *mut c_uint, max: *mut c_uint, src: *const c_void, size: usize, wksp: *mut c_void, wksp_size: usize) -> usize;
    fn HIST_count_wksp(count: *mut c_uint, max: *mut c_uint, src: *const c_void, size: usize, wksp: *mut c_void, wksp_size: usize) -> usize;

    fn FSE_buildCTable_wksp(ct: *mut u32, norm: *const i16, max: c_uint, table_log: c_uint, wksp: *mut c_void, wksp_size: usize) -> usize;
    fn FSE_buildCTable_rle(ct: *mut u32, symbol: u8) -> usize;
    fn FSE_NCountWriteBound(max: c_uint, table_log: c_uint) -> usize;
    fn FSE_writeNCount(buf: *mut c_void, size: usize, norm: *const i16, max: c_uint, table_log: c_uint) -> usize;
    fn FSE_optimalTableLog(max_log: c_uint, size: usize, max: c_uint) -> c_uint;
    fn FSE_optimalTableLog_internal(max_log: c_uint, size: usize, max: c_uint, minus: c_uint) -> c_uint;
    fn FSE_normalizeCount(norm: *mut i16, table_log: c_uint, count: *const c_uint, total: usize, max: c_uint, low_prob: c_uint) -> usize;
    fn FSE_compress_usingCTable(dst: *mut c_void, cap: usize, src: *const c_void, size: usize, ct: *const u32) -> usize;

    fn HUF_compressBound(size: usize) -> usize;
    fn HUF_buildCTable_wksp(t: *mut u64, count: *const c_uint, max: u32, max_nb_bits: u32, wksp: *mut c_void, wksp_size: usize) -> usize;
    fn HUF_writeCTable_wksp(dst: *mut c_void, cap: usize, t: *const u64, max: c_uint, huff_log: c_uint, wksp: *mut c_void, wksp_size: usize) -> usize;
    fn HUF_readCTable(t: *mut u64, max: *mut c_uint, src: *const c_void, size: usize, has_zero: *mut c_uint) -> usize;
    fn HUF_estimateCompressedSize(t: *const u64, count: *const c_uint, max: c_uint) -> usize;
    fn HUF_validateCTable(t: *const u64, count: *const c_uint, max: c_uint) -> c_int;
    fn HUF_optimalTableLog(max_log: c_uint, size: usize, max: c_uint, wksp: *mut c_void, wksp_size: usize, t: *mut u64, count: *const c_uint, flags: c_int) -> c_uint;
    fn HUF_minTableLog(cardinality: c_uint) -> c_uint;
    fn HUF_cardinality(count: *const c_uint, max: c_uint) -> c_uint;
    fn HUF_getNbBitsFromCTable(t: *const u64, symbol: u32) -> u32;
    fn HUF_readCTableHeader(t: *const u64) -> CTableHeader;
    fn HUF_compress1X_usingCTable(dst: *mut c_void, cap: usize, src: *const c_void, size: usize, t: *const u64, flags: c_int) -> usize;
    fn HUF_compress4X_usingCTable(dst: *mut c_void, cap: usize, src: *const c_void, size: usize, t: *const u64, flags: c_int) -> usize;
    fn HUF_compress1X_repeat(dst: *mut c_void, cap: usize, src: *const c_void, size: usize, max: c_uint, log: c_uint, wksp: *mut c_void, wksp_size: usize, t: *mut u64, repeat: *mut c_uint, flags: c_int) -> usize;
    fn HUF_compress4X_repeat(dst: *mut c_void, cap: usize, src: *const c_void, size: usize, max: c_uint, log: c_uint, wksp: *mut c_void, wksp_size: usize, t: *mut u64, repeat: *mut c_uint, flags: c_int) -> usize;

    fn shim_fse_encode3(dst: *mut c_void, cap: usize, ta: *const u32, tb: *const u32, tc: *const u32, sa: *const u8, sb: *const u8, sc: *const u8, n: usize) -> usize;
    fn shim_fse_getMaxNbBits(ct: *const u32, symbol: u32) -> u32;
    fn shim_fse_bitCost(ct: *const u32, symbol: u32, accuracy_log: u32) -> u32;
}

type R<T = usize> = Result<T, u32>;
fn conv<T>(r: Result<T, ErrorCode>) -> R<T> { r.map_err(|e| e as u8 as u32) }

/// What the C code may write past the end of, in cases that are bugs of the caller.
const SLACK: usize = 2048;
const FILL: u8 = 0xA5;

/// A workspace for the C code, zeroed.
fn wksp() -> Vec<u64> { vec![0u64; 8704 / 8 + 64] }
const WKSP_SIZE: usize = 8704;

pub struct Stats { pub cases: u64 }
impl Stats { fn hit(&mut self) { self.cases += 1; } }

/// An output buffer for each side. The C one has slack after `cap`.
struct Out { c: Vec<u8>, r: Vec<u8>, cap: usize }
impl Out {
    fn new(cap: usize) -> Self { Self { c: vec![FILL; cap + SLACK], r: vec![FILL; cap], cap } }
    fn c_ptr(&mut self) -> *mut c_void { self.c.as_mut_ptr().cast() }
    #[track_caller]
    fn check(&self, what: &str, ctx: &dyn std::fmt::Debug) {
        assert!(self.c[..self.cap] == self.r[..], "{what}: output differs at {:?} ({ctx:?})", self.c.iter().zip(&self.r).position(|(a, b)| a != b));
        assert!(self.c[self.cap..].iter().all(|&b| b == FILL), "{what}: the C code wrote past the end ({ctx:?})");
    }
}

// ---------------------------------------------------------------- inputs

fn sizes(rng: &mut Rng) -> usize {
    match rng.below(8) {
        0 => *rng.pick(&[0usize, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 15, 16, 17, 19, 20, 21, 31, 32, 33, 63, 64, 65]),
        1 => *rng.pick(&[255usize, 256, 257, 1023, 1024, 1025, 1499, 1500, 1501, 4095, 4096, 40959, 40960, 40961, 65535, 65536, 131071, 131072]),
        2 => rng.range(0, 64),
        3 | 4 => rng.range(0, 2000),
        5 | 6 => rng.range(0, 20000),
        _ => rng.range(0, 131072),
    }
}

/// 256 counts, of which those above `max` are 0. At least one is not 0. They add up to at most about `budget`.
fn counts(rng: &mut Rng, max: usize, budget: usize) -> Vec<u32> {
    let n = max + 1;
    let mut c = vec![0u32; 256];
    match rng.below(12) {
        0 => { let len = rng.range(1, budget); for b in data(rng, len) { c[b as usize % n] += 1; } }
        1 => { // geometric
            let mut v = budget as f64 / 2.0; let ratio = 0.3 + 0.69 * (rng.below(1000) as f64 / 1000.0);
            for x in c[..n].iter_mut() { *x = v as u32; v *= ratio; }
        }
        2 => { // Fibonacci: the deepest trees
            let (mut a, mut b) = (1u32, 1u32); let mut total = 0usize;
            for x in c[..n].iter_mut() { if total + a as usize > budget { break; } *x = a; total += a as usize; (a, b) = (b, a + b); }
        }
        3 => { let v = (*rng.pick(&[1u32, 2, 3, 163, 164, 165, 166, 200, 255, 256, 1000])).min((budget / n).max(1) as u32); c[..n].fill(v); }
        4 => { // many ties, around the counts that share buckets
            let lo = rng.range(1, 600).min((budget / n).max(1)); let span = rng.range(1, 300);
            for x in c[..n].iter_mut() { *x = (lo + rng.below(span)).min((budget / n).max(1)) as u32; }
        }
        5 => { for _ in 0..rng.range(1, 6) { c[rng.below(n)] = rng.range(1, (budget / 8).max(1)) as u32; } }
        6 => { c[..n].fill(1); c[rng.below(n)] = (budget.saturating_sub(n)).max(1) as u32; }
        7 => { let top = (usize::BITS - (budget / n).max(1).leading_zeros()) as usize; for x in c[..n].iter_mut() { *x = 1 << rng.below(top); } }
        8 => { for x in c[..n].iter_mut() { if rng.chance(1, 2) { *x = rng.size((2 * budget / n).max(1)) as u32; } } }
        9 => { for x in c[..n].iter_mut() { *x = rng.range(0, 3) as u32; } }
        10 => { // two plateaus
            let hi = (budget / n).max(2) as u32; let cut = rng.below(n);
            for (i, x) in c[..n].iter_mut().enumerate() { *x = if i < cut { hi } else { 1 }; }
        }
        _ => { let m = (budget / n).max(1); for x in c[..n].iter_mut() { *x = rng.range(0, m) as u32; } }
    }
    if rng.chance(1, 2) { // any order
        for i in (1..n).rev() { let j = rng.below(i + 1); c.swap(i, j); }
    }
    if c.iter().all(|&x| x == 0) { c[rng.below(n)] = rng.range(1, 5) as u32; }
    c
}

/// Symbols that occur as `counts` says, in any order.
fn data_of(rng: &mut Rng, counts: &[u32]) -> Vec<u8> {
    let mut v = Vec::new();
    for (s, &c) in counts.iter().enumerate() { v.resize(v.len() + c as usize, s as u8); }
    match rng.below(4) {
        0 => {}
        1 => v.reverse(),
        _ => for i in (1..v.len()).rev() { let j = rng.below(i + 1); v.swap(i, j); },
    }
    v
}

/// `len` symbols among those whose weight is not 0.
fn data_among(rng: &mut Rng, weights: &[i16], len: usize) -> Vec<u8> {
    let mut pool = Vec::new();
    for (s, &w) in weights.iter().enumerate() { for _ in 0..w.unsigned_abs() { pool.push(s as u8); } }
    let uniform: Vec<u8> = weights.iter().enumerate().filter(|(_, w)| **w != 0).map(|(s, _)| s as u8).collect();
    let pool = if rng.chance(1, 4) { uniform } else { pool };
    (0..len).map(|_| *rng.pick(&pool)).collect()
}

/// Normalized counts that add up to `1 << table_log`, made directly.
fn random_norm(rng: &mut Rng, max: usize, table_log: u32) -> Vec<i16> {
    let size = 1usize << table_log;
    let mut norm = vec![0i16; max + 1];
    let mut left = size;
    let low = if rng.chance(1, 2) { rng.below((max + 1).min(size - 1) + 1) } else { 0 };
    let mut order: Vec<usize> = (0..=max).collect();
    for i in (1..order.len()).rev() { let j = rng.below(i + 1); order.swap(i, j); }
    for &s in &order[..low] { norm[s] = -1; left -= 1; }
    let others = &order[low..];
    if others.is_empty() || left == 0 {
        // All the slots must be taken: give what is left to a low probability symbol.
        if left > 0 { let s = order[0]; norm[s] = 1 + left as i16; }
        return norm;
    }
    let used = rng.range(1, others.len().min(left));
    for &s in &others[..used] { norm[s] = 1; left -= 1; }
    while left > 0 {
        let s = others[rng.below(used)];
        let n = if rng.chance(1, 3) { left } else { 1 + rng.size(left - 1) };
        norm[s] += n as i16; left -= n;
    }
    norm
}

// ---------------------------------------------------------------- hist

fn t_hist(rng: &mut Rng, st: &mut Stats) {
    let len = sizes(rng);
    let mut src = data(rng, len);
    if rng.chance(1, 2) { let m = rng.range(1, 256); for b in src.iter_mut() { *b = (*b as usize % m) as u8; } }
    let actual = src.iter().copied().max().unwrap_or(0) as u32;
    let mut padded = src.clone(); padded.extend_from_slice(&[0xEE; 32]);
    let p: *const c_void = padded.as_ptr().cast();
    let garbage: Vec<u32> = (0..256).map(|_| rng.next() as u32 >> 8).collect();
    let mut w = wksp();

    // Checked.
    for _ in 0..3 {
        let max = match rng.below(4) { 0 => rng.below(256) as u32, 1 => actual, 2 => actual.saturating_sub(1), _ => *rng.pick(&[255u32, 256, 1000]) };
        let (mut cc, mut cr, mut mc, mut mr) = (garbage.clone(), garbage.clone(), max, max);
        let a = res(unsafe { HIST_count_wksp(cc.as_mut_ptr(), &mut mc, p, len, w.as_mut_ptr().cast(), 4096) });
        let b = conv(rs::hist_count_wksp(&mut cr, &mut mr, &src));
        assert_eq!((a, mc, &cc), (b, mr, &cr), "HIST_count_wksp len {len} max {max}");
        st.hit();
    }
    // Trusted.
    let max = rng.range(actual as usize, 255) as u32;
    let (mut cc, mut cr, mut mc, mut mr) = (garbage.clone(), garbage.clone(), max, max);
    let a = res(unsafe { HIST_countFast_wksp(cc.as_mut_ptr(), &mut mc, p, len, w.as_mut_ptr().cast(), 4096) });
    let b = conv(rs::hist_count_fast_wksp(&mut cr, &mut mr, &src));
    assert_eq!((a, mc, &cc), (b, mr, &cr), "HIST_countFast_wksp len {len} max {max}");
    st.hit();

    let (mut cc, mut cr, mut mc, mut mr) = (garbage.clone(), garbage.clone(), max, max);
    let a = unsafe { HIST_count_simple(cc.as_mut_ptr(), &mut mc, p, len) };
    let b = rs::hist_count_simple(&mut cr, &mut mr, &src).unwrap();
    assert_eq!((a, mc, &cc), (b, mr, &cr), "HIST_count_simple len {len} max {max}");
    st.hit();

    let (mut cc, mut cr) = (garbage.clone(), garbage.clone());
    unsafe { HIST_add(cc.as_mut_ptr(), p, len) };
    rs::hist_add(&mut cr, &src).unwrap();
    assert_eq!(cc, cr, "HIST_add");
    st.hit();
}

// ---------------------------------------------------------------- fse

fn t_fse_logs(rng: &mut Rng, st: &mut Stats) {
    for _ in 0..50 {
        let max_log = rng.below(15) as u32;
        let size = match rng.below(3) { 0 => rng.range(2, 40), 1 => rng.range(2, 5000), _ => 2 + rng.size(1 << 20) };
        let max = rng.range(1, 255) as u32;
        let minus = rng.range(1, 2) as u32;
        assert_eq!(unsafe { FSE_optimalTableLog(max_log, size, max) }, rs::fse_optimal_table_log(max_log, size, max), "FSE_optimalTableLog {max_log} {size} {max}");
        assert_eq!(unsafe { FSE_optimalTableLog_internal(max_log, size, max, minus) }, rs::fse_optimal_table_log_internal(max_log, size, max, minus), "FSE_optimalTableLog_internal {max_log} {size} {max} {minus}");
        let max0 = rng.below(256) as u32;
        assert_eq!(unsafe { FSE_NCountWriteBound(max0, max_log) }, rs::fse_ncount_write_bound(max0, max_log));
        assert_eq!(unsafe { HUF_compressBound(size) }, rs::huf_compress_bound(size));
        assert_eq!(unsafe { HUF_minTableLog(max + 1) }, rs::huf_min_table_log(max + 1));
        st.cases += 5;
    }
}

/// `FSE_CTable` of the C code, with garbage that it is not to touch... which is zero, as for the other side.
fn c_fse_table() -> Vec<u32> { vec![0u32; 1 + (1 << 11) + 256 * 2 + 16] }

fn write_ncount_both(rng: &mut Rng, st: &mut Stats, norm: &[i16], max: u32, table_log: u32) -> R {
    let bound = unsafe { FSE_NCountWriteBound(max, table_log) };
    let mut full = Err(0);
    for k in 0..4 {
        let cap = match k { 0 => 512 + rng.below(8), 1 => bound, 2 => bound.saturating_sub(1 + rng.below(4)), _ => rng.below(bound + 2) };
        let mut out = Out::new(cap);
        let a = res(unsafe { FSE_writeNCount(out.c_ptr(), cap, norm.as_ptr(), max, table_log) });
        let b = conv(rs::fse_write_ncount(&mut out.r, norm, max, table_log));
        assert_eq!(a, b, "FSE_writeNCount cap {cap} max {max} log {table_log} {norm:?}");
        out.check("FSE_writeNCount", &(cap, max, table_log, norm));
        st.hit();
        if k == 0 { full = a; }
    }
    full
}

/// Builds the table on both sides and uses it. `norm` is valid, `table_log <= 9`, `max <= 52`.
fn use_fse_table(rng: &mut Rng, st: &mut Stats, norm: &[i16], max: u32, table_log: u32) -> (Vec<u32>, rs::Fse) {
    let mut w = wksp();
    let mut ct = c_fse_table();
    let mut rt = rs::Fse::new();
    let a = res(unsafe { FSE_buildCTable_wksp(ct.as_mut_ptr(), norm.as_ptr(), max, table_log, w.as_mut_ptr().cast(), WKSP_SIZE) });
    let b = conv(rt.build(norm, max, table_log));
    assert_eq!(a, b.map(|_| 0), "FSE_buildCTable_wksp");
    let conv_t = rt.to_c();
    assert_eq!(&ct[..conv_t.len()], &conv_t[..], "FSE_buildCTable_wksp table: max {max} log {table_log} {norm:?}");
    st.hit();

    for s in 0..=max {
        assert_eq!(unsafe { shim_fse_getMaxNbBits(ct.as_ptr(), s) }, rt.get_max_nb_bits(s), "FSE_getMaxNbBits");
        if norm[s as usize] != 0 {
            assert_eq!(unsafe { shim_fse_bitCost(ct.as_ptr(), s, 8) }, rt.bit_cost(s, 8), "FSE_bitCost");
        }
    }
    st.hit();

    for _ in 0..3 {
        let len = match rng.below(4) { 0 => rng.below(12), 1 => rng.below(300), 2 => rng.below(300), _ => rng.below(3000) };
        let src = data_among(rng, norm, len);
        let bound = len + (len >> 7) + 4 + 8;
        let cap = match rng.below(5) { 0 => bound, 1 => bound - 1, 2 => bound + rng.below(50), 3 => rng.below(bound), _ => rng.below(20) };
        let mut out = Out::new(cap);
        let a = unsafe { FSE_compress_usingCTable(out.c_ptr(), cap, src.as_ptr().cast(), len, ct.as_ptr()) };
        let b = rt.compress(&mut out.r, &src);
        // `FSE_BLOCKBOUND` is no bound for rare symbols with a large table log, and the C code trusts it.
        if cap >= bound && out.c[cap..].iter().any(|&b| b != FILL) { assert!(table_log > 7); assert_eq!(b, 0); continue; }
        assert_eq!(a, b, "FSE_compress_usingCTable len {len} cap {cap}");
        out.check("FSE_compress_usingCTable", &(len, cap, table_log));
        st.hit();
    }
    (ct, rt)
}

fn t_fse(rng: &mut Rng, st: &mut Stats) {
    // The alphabets of sequences and of Huffman weights, or any.
    let max = match rng.below(6) { 0 => 12, 1 => 35, 2 => 52, 3 => 31, 4 => rng.range(1, 52), _ => rng.range(1, 255) };
    let budget = *rng.pick(&[8usize, 40, 255, 1000, 20000, 131072, 1 << 22]);
    let mut count = counts(rng, max, budget);
    // As the callers do, `max` is the last symbol present, most of the time.
    let max = if rng.chance(4, 5) { count.iter().rposition(|&c| c != 0).unwrap().max(1) } else { max } as u32;
    let mut total: usize = count.iter().map(|&c| c as usize).sum();
    if total < 2 { count[0] += 2; total += 2; }
    let low_prob = rng.chance(1, 2);
    let table_log = match rng.below(4) {
        0 => rng.below(15) as u32,
        _ => { let max_log = *rng.pick(&[5u32, 6, 8, 9, 9, 11, 12, 0]); unsafe { FSE_optimalTableLog(max_log, total, max) } }
    };
    let mut nc = vec![0x5A5Ai16; 256];
    let mut nr = nc.clone();
    let a = res(unsafe { FSE_normalizeCount(nc.as_mut_ptr(), table_log, count.as_ptr(), total, max, low_prob as u32) });
    let b = conv(rs::fse_normalize_count(&mut nr, table_log, &count, total, max, low_prob));
    assert_eq!((a, &nc), (b, &nr), "FSE_normalizeCount log {table_log} total {total} max {max} low {low_prob} {:?}", &count[..=max as usize]);
    st.hit();
    let Ok(log) = a else { return };
    if log == 0 { return; }
    let log = log as u32;
    let norm = &nc[..=max as usize];
    assert_eq!(norm.iter().map(|n| n.unsigned_abs() as usize).sum::<usize>(), 1 << log);
    write_ncount_both(rng, st, norm, max, log).unwrap();
    if log <= 9 && max <= 52 { use_fse_table(rng, st, norm, max, log); }
}

fn t_fse_tables(rng: &mut Rng, st: &mut Stats) {
    let mut made = Vec::new();
    for _ in 0..3 {
        let table_log = rng.range(5, 9) as u32;
        let max = match rng.below(4) { 0 => 52, 1 => 35, 2 => 31, _ => rng.range(1, 52) };
        let norm = random_norm(rng, max, table_log);
        assert_eq!(norm.iter().map(|n| n.unsigned_abs() as usize).sum::<usize>(), 1 << table_log, "{norm:?}");
        if norm.iter().filter(|&&n| n != 0).count() > 1 { write_ncount_both(rng, st, &norm, max as u32, table_log).unwrap(); }
        let (ct, rt) = use_fse_table(rng, st, &norm, max as u32, table_log);
        made.push((ct, rt, norm));
    }
    // A run-length table in place of one of them, built over what is there.
    if rng.chance(1, 3) {
        let i = rng.below(3);
        let symbol = rng.below(53) as u8;
        let (ct, rt, norm) = &mut made[i];
        assert_eq!(unsafe { FSE_buildCTable_rle(ct.as_mut_ptr(), symbol) }, 0);
        rt.build_rle(symbol).unwrap();
        let t = rt.to_c();
        // Only the header, the two states and the transform of the symbol are defined.
        assert_eq!(ct[..2], t[..2], "FSE_buildCTable_rle");
        assert_eq!(ct[2 + 2 * symbol as usize..][..2], t[2 + 2 * symbol as usize..][..2], "FSE_buildCTable_rle");
        *norm = vec![0; 53]; norm[symbol as usize] = 1;
        st.hit();
        let len = rng.below(40);
        let src = vec![symbol; len];
        let cap = rng.below(60);
        let mut out = Out::new(cap);
        let a = unsafe { FSE_compress_usingCTable(out.c_ptr(), cap, src.as_ptr().cast(), len, ct.as_ptr()) };
        let b = rt.compress(&mut out.r, &src);
        assert_eq!(a, b, "FSE_compress_usingCTable rle");
        out.check("FSE_compress_usingCTable rle", &(len, cap));
        st.hit();
    }
    let n = 1 + rng.size(2000);
    let syms: Vec<Vec<u8>> = made.iter().map(|(_, _, norm)| data_among(rng, norm, n)).collect();
    let bound = n * 4 + 32;
    let cap = match rng.below(4) { 0 => rng.below(20), 1 => rng.below(bound), _ => bound };
    let mut out = Out::new(cap);
    let a = res(unsafe { shim_fse_encode3(out.c_ptr(), cap, made[0].0.as_ptr(), made[1].0.as_ptr(), made[2].0.as_ptr(), syms[0].as_ptr(), syms[1].as_ptr(), syms[2].as_ptr(), n) });
    let b = conv(rs::fse_encode3(&mut out.r, [&made[0].1, &made[1].1, &made[2].1], [&syms[0], &syms[1], &syms[2]]));
    assert_eq!(a, b, "encode3 n {n} cap {cap}");
    out.check("encode3", &(n, cap));
    st.hit();

    // Too large for the table.
    let norm = random_norm(rng, 52, 10);
    let mut ct = c_fse_table();
    let mut w = wksp();
    // The workspace that `ZSTD_buildCTable` has.
    let a = res(unsafe { FSE_buildCTable_wksp(ct.as_mut_ptr(), norm.as_ptr(), 52, 10, w.as_mut_ptr().cast(), 1140) });
    assert_eq!(a, conv(rs::Fse::new().build(&norm, 52, 10)).map(|_| 0));
    st.hit();
}

/// Counts that are not normalized.
fn t_fse_bad_norm(rng: &mut Rng, st: &mut Stats) {
    let table_log = rng.below(15) as u32;
    let max = rng.range(1, 255);
    let mut norm = if (5..=12).contains(&table_log) { random_norm(rng, max, table_log) } else { vec![1; max + 1] };
    for _ in 0..rng.below(4) {
        let i = rng.below(norm.len());
        norm[i] = match rng.below(4) { 0 => 0, 1 => -1, 2 => norm[i].wrapping_add(rng.range(0, 6) as i16 - 3), _ => rng.below(1 << table_log.min(12)) as i16 };
    }
    // A large buffer: past the bound, the C code does not check what it writes.
    let cap = 1024;
    let mut out = Out::new(cap);
    let a = res(unsafe { FSE_writeNCount(out.c_ptr(), cap, norm.as_ptr(), max as u32, table_log) });
    let b = conv(rs::fse_write_ncount(&mut out.r, &norm, max as u32, table_log));
    assert_eq!(a, b, "FSE_writeNCount bad: log {table_log} {norm:?}");
    out.check("FSE_writeNCount bad", &(table_log, &norm));
    st.hit();
}

// ---------------------------------------------------------------- huf

fn bmi2(rng: &mut Rng) -> c_int { (std::arch::is_x86_feature_detected!("bmi2") && rng.chance(1, 2)) as c_int }

fn c_build(count: &[u32], max: u32, bits: u32, init: &rs::Huf) -> (R, rs::Huf) {
    let mut t = *init;
    let mut w = wksp();
    let r = res(unsafe { HUF_buildCTable_wksp(t.as_mut_ptr(), count.as_ptr(), max, bits, w.as_mut_ptr().cast(), WKSP_SIZE) });
    (r, t)
}

fn using_ctable_both(rng: &mut Rng, st: &mut Stats, t: &rs::Huf, src: &[u8]) {
    let log = t[0] as u8 as usize;
    let tight = ((src.len() * log) >> 3) + 8;
    for four in [false, true] {
        for _ in 0..2 {
            let cap = match rng.below(8) {
                0 => tight, 1 => tight.saturating_sub(1), 2 => tight + 1 + rng.below(30), 3 => rng.below(tight + 1), 4 => rng.below(24),
                5 => tight / 4 + rng.below(40), _ => unsafe { HUF_compressBound(src.len()) },
            };
            let mut out = Out::new(cap);
            let f = bmi2(rng);
            let (a, b) = if four {
                (res(unsafe { HUF_compress4X_usingCTable(out.c_ptr(), cap, src.as_ptr().cast(), src.len(), t.as_ptr(), f) }), conv(rs::huf_compress_4x_using_ctable(&mut out.r, src, t)))
            } else {
                (res(unsafe { HUF_compress1X_usingCTable(out.c_ptr(), cap, src.as_ptr().cast(), src.len(), t.as_ptr(), f) }), conv(rs::huf_compress_1x_using_ctable(&mut out.r, src, t)))
            };
            assert_eq!(a, b, "HUF_compress{}X_usingCTable len {} cap {cap} log {log}", if four { 4 } else { 1 }, src.len());
            out.check("HUF_compressNX_usingCTable", &(four, src.len(), cap, log));
            st.hit();
        }
    }
}

fn t_huf_table(rng: &mut Rng, st: &mut Stats) {
    let max = match rng.below(4) { 0 => 255, 1 => rng.range(0, 255), 2 => rng.range(0, 40), _ => rng.range(100, 255) };
    let budget = *rng.pick(&[10usize, 100, 1000, 5000, 20000, 131072, 131072]);
    let count = counts(rng, max, budget);
    let max = if rng.chance(3, 4) { count.iter().rposition(|&c| c != 0).unwrap() } else { max } as u32;
    let total: usize = count.iter().map(|&c| c as usize).sum();

    let card = unsafe { HUF_cardinality(count.as_ptr(), max) };
    assert_eq!(card, rs::huf_cardinality(&count, max), "HUF_cardinality");
    let min_log = unsafe { HUF_minTableLog(card) };
    assert_eq!(min_log, rs::huf_min_table_log(card));
    st.hit();

    let bits = match rng.below(6) { 0 => 0, 1 => 11, 2 => min_log, _ => rng.range(min_log as usize, 12) as u32 };
    let mut init = [0u64; 257];
    if rng.chance(1, 2) { for x in init.iter_mut() { *x = rng.next(); } }
    let (a, ct) = c_build(&count, max, bits, &init);
    let mut rt = init;
    let b = conv(rs::huf_build_ctable(&mut rt, &count, max, bits));
    assert_eq!(a, b, "HUF_buildCTable_wksp max {max} bits {bits} {:?}", &count[..=max as usize]);
    assert!(ct == rt, "HUF_buildCTable_wksp table: max {max} bits {bits} {:?}", &count[..=max as usize]);
    st.hit();
    let log = a.unwrap() as u32;

    // Out of range.
    if rng.chance(1, 8) {
        let (a, t) = c_build(&count, max, 13, &init);
        let mut tr = init;
        assert_eq!(a, conv(rs::huf_build_ctable(&mut tr, &count, max, 13)), "HUF_buildCTable_wksp 13 bits");
        assert!(t == tr);
        let big = 256 + rng.below(3) as u32;
        let (a, t) = c_build(&count, big, bits, &init);
        let mut tr = init;
        assert_eq!(a, conv(rs::huf_build_ctable(&mut tr, &count, big, bits)), "HUF_buildCTable_wksp max {big}");
        assert!(t == tr);
        let mut out = Out::new(300);
        let mut w = wksp();
        let a = res(unsafe { HUF_writeCTable_wksp(out.c_ptr(), 300, ct.as_ptr(), big, log, w.as_mut_ptr().cast(), WKSP_SIZE) });
        assert_eq!(a, conv(rs::huf_write_ctable(&mut out.r, &rt, big, log)), "HUF_writeCTable_wksp max {big}");
        out.check("HUF_writeCTable_wksp", &big);
        st.cases += 3;
    }

    let h = unsafe { HUF_readCTableHeader(ct.as_ptr()) };
    assert_eq!((h.table_log, h.max_symbol_value), rs::huf_read_ctable_header(&rt));
    for s in 0..256 { assert_eq!(unsafe { HUF_getNbBitsFromCTable(ct.as_ptr(), s) }, rs::huf_get_nb_bits(&rt, s)); }
    assert_eq!(unsafe { HUF_estimateCompressedSize(ct.as_ptr(), count.as_ptr(), max) }, rs::huf_estimate_compressed_size(&rt, &count, max));
    st.cases += 3;
    for _ in 0..3 {
        let max2 = rng.below(256);
        let other = if rng.chance(1, 2) { counts(rng, max2, 1000) } else { let mut o = count.clone(); let i = rng.below(256); o[i] = rng.below(2) as u32; o };
        let max2 = if rng.chance(1, 2) { max2 as u32 } else { max };
        assert_eq!(unsafe { HUF_validateCTable(ct.as_ptr(), other.as_ptr(), max2) } != 0, rs::huf_validate_ctable(&rt, &other, max2), "HUF_validateCTable");
        assert_eq!(unsafe { HUF_estimateCompressedSize(ct.as_ptr(), other.as_ptr(), max2) }, rs::huf_estimate_compressed_size(&rt, &other, max2));
        st.cases += 2;
    }

    // The header.
    let mut header = Vec::new();
    for k in 0..4 {
        let cap = match k { 0 => 300, 1 => rng.below(140), 2 => rng.below(20), _ => 129 + rng.below(3) };
        let mut out = Out::new(cap);
        let mut w = wksp();
        let a = res(unsafe { HUF_writeCTable_wksp(out.c_ptr(), cap, ct.as_ptr(), max, log, w.as_mut_ptr().cast(), WKSP_SIZE) });
        let b = conv(rs::huf_write_ctable(&mut out.r, &rt, max, log));
        assert_eq!(a, b, "HUF_writeCTable_wksp cap {cap} max {max} log {log}");
        out.check("HUF_writeCTable_wksp", &(cap, max, log));
        st.hit();
        if let (0, Ok(n)) = (k, a) { header = out.r[..n].to_vec(); }
    }
    if !header.is_empty() {
        header.extend((0..rng.below(8)).map(|_| rng.next() as u8));
        let any = rng.below(256) as u32;
        let limit = *rng.pick(&[255, max, max.saturating_sub(1), any]);
        read_ctable_both(rng, st, &header, limit);
        let n = rng.below(header.len() + 1);
        read_ctable_both(rng, st, &header[..n], 255);
        let i = rng.below(header.len());
        header[i] = rng.next() as u8;
        read_ctable_both(rng, st, &header, 255);
    }

    // The best limit on the depth.
    if total > 1 && card > 1 {
        for flags in [0, 2] {
            let max_log = if flags == 0 { rng.below(13) as u32 } else { rng.range(min_log as usize, 12) as u32 };
            let (mut tc, mut tr) = (init, init);
            let mut w = wksp();
            // The sizes that the two callers give.
            let wsize = *rng.pick(&[4864usize, 7896]);
            let a = unsafe { HUF_optimalTableLog(max_log, total, max, w.as_mut_ptr().cast(), wsize, tc.as_mut_ptr(), count.as_ptr(), flags) };
            let b = rs::huf_optimal_table_log(max_log, total, max, &mut tr, &count, flags as u32);
            assert_eq!(a, b, "HUF_optimalTableLog flags {flags} max_log {max_log} total {total} max {max} {:?}", &count[..=max as usize]);
            assert!(tc == tr, "HUF_optimalTableLog table");
            st.hit();
        }
    }

    // Encoding.
    let src = data_of(rng, &count);
    let n = if rng.chance(1, 2) { src.len() } else { rng.below(src.len() + 1) };
    using_ctable_both(rng, st, &ct, &src[..n]);
}

fn read_ctable_both(rng: &mut Rng, st: &mut Stats, src: &[u8], max: u32) {
    let mut init = [0u64; 257];
    if rng.chance(1, 2) { for x in init.iter_mut() { *x = rng.next(); } }
    let (mut tc, mut tr) = (init, init);
    let (mut mc, mut zc) = (max, 7u32);
    // The C code may look at bytes after the end, without using them.
    let mut padded = src.to_vec(); padded.extend_from_slice(&[0; 16]);
    let a = res(unsafe { HUF_readCTable(tc.as_mut_ptr(), &mut mc, padded.as_ptr().cast(), src.len(), &mut zc) });
    let b = conv(rs::huf_read_ctable(&mut tr, max, src));
    match (a, b) {
        (Ok(n), Ok((size, m, z))) => assert_eq!((n, mc, zc != 0), (size, m, z), "HUF_readCTable"),
        (a, b) => assert_eq!(a.err(), b.err(), "HUF_readCTable error: {src:?}"),
    }
    assert!(tc == tr, "HUF_readCTable table: {src:?}");
    st.hit();
}

fn t_huf_read(rng: &mut Rng, st: &mut Stats) {
    let len = rng.below(140);
    let mut src: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
    if len > 0 {
        match rng.below(3) {
            0 => src[0] = 128 + rng.below(128) as u8,
            1 => { src[0] = 128 + rng.below(128) as u8; for b in src[1..].iter_mut() { *b = (rng.below(4) << 4 | rng.below(4)) as u8; } }
            _ => {}
        }
    }
    let limit = *rng.pick(&[255, 255, 100, 10]);
    read_ctable_both(rng, st, &src, limit);
}

fn literals(rng: &mut Rng, len: usize) -> Vec<u8> {
    match rng.below(6) {
        0 | 1 => data(rng, len),
        2 => { let max = rng.range(1, 255); let c = counts(rng, max, len.max(1)); let mut v = data_of(rng, &c); v.truncate(len); v }
        3 => { // nearly incompressible
            let m = rng.range(100, 256); (0..len).map(|_| rng.below(m) as u8).collect()
        }
        4 => { // compressible in the middle only
            let mut v: Vec<u8> = (0..len).map(|_| rng.next() as u8).collect();
            if len > 8192 { for b in v[4096..len - 4096].iter_mut() { *b &= 7; } }
            v
        }
        _ => { let k = rng.range(1, 8); (0..len).map(|_| { let mut b = rng.next() as u8; for _ in 0..k { b &= rng.next() as u8; } b }).collect() }
    }
}

fn t_huf_repeat(rng: &mut Rng, st: &mut Stats) {
    let len = sizes(rng) + if rng.chance(1, 200) { 131073 } else { 0 };
    let src = literals(rng, len);
    let len = src.len();
    let mut hist = vec![0u32; 256];
    for &b in &src { hist[b as usize] += 1; }
    let actual = src.iter().copied().max().unwrap_or(0) as u32;
    let card = hist.iter().filter(|&&c| c != 0).count() as u32;

    let flags = (rng.below(8) << 1) as u32;
    let four = rng.chance(1, 2);

    // The previous table.
    let zero = [0u64; 257];
    let (prev, mut repeat) = match rng.below(7) {
        0 => (zero, 0u32),
        1 if len > 0 => (c_build(&hist, actual, 11, &zero).1, rng.range(0, 2) as u32), // of this very input
        2 => { // has every symbol
            let mut c = hist.clone(); for x in c.iter_mut() { *x = *x / rng.range(1, 3) as u32 + 1; }
            (c_build(&c, 255, *rng.pick(&[11, 12, 9]), &zero).1, rng.range(0, 2) as u32)
        }
        3 => { let c: Vec<u32> = (0..256).map(|_| 1 + rng.size(300) as u32).collect(); (c_build(&c, 255, 11, &zero).1, rng.range(0, 2) as u32) }
        4 => { // of other data: may lack symbols, so that it has to be checked
            let m = rng.range(1, 255); let c = counts(rng, m, 5000);
            let last = c.iter().rposition(|&x| x != 0).unwrap() as u32;
            (c_build(&c, last, 11, &zero).1, rng.range(0, 1) as u32)
        }
        5 if len > 0 => { // of a part of this input
            let mut c = vec![0u32; 256]; for &b in &src[..1 + rng.below(len)] { c[b as usize] += 1; }
            let last = c.iter().rposition(|&x| x != 0).unwrap() as u32;
            (c_build(&c, last, 11, &zero).1, rng.range(0, 1) as u32)
        }
        _ => (zero, 0),
    };
    let sampled = flags & 8 != 0 && len >= 40960;
    let max = match rng.below(6) {
        0 => 0,
        1 => rng.range(actual as usize, 255) as u32,
        2 if !sampled => rng.below(256) as u32,
        3 => *rng.pick(&[256u32, 300]),
        _ => 255,
    };
    let min_log = if card > 0 { unsafe { HUF_minTableLog(card) } } else { 1 };
    let log = match rng.below(5) {
        0 => 0,
        1 => 11,
        2 => 13,
        _ if flags & 2 != 0 => rng.range(min_log as usize, 12) as u32,
        _ => rng.range(1, 12) as u32,
    };
    let cap = match rng.below(8) {
        0 => rng.below(24),
        1 => rng.below(len + 1),
        2 => len,
        3 => len / 2 + rng.below(200),
        _ => unsafe { HUF_compressBound(len) },
    };

    let mut out = Out::new(cap);
    let (mut tc, mut tr) = (prev, prev);
    let (mut rc, mut rr) = (repeat, repeat);
    let mut w = wksp();
    let cf = flags as c_int | bmi2(rng);
    let f = if four { HUF_compress4X_repeat } else { HUF_compress1X_repeat };
    let a = res(unsafe { f(out.c_ptr(), cap, src.as_ptr().cast(), len, max, log, w.as_mut_ptr().cast(), WKSP_SIZE, tc.as_mut_ptr(), &mut rc, cf) });
    let b = conv(rs::huf_compress_repeat(four, &mut out.r, &src, max, log, &mut tr, &mut rr, flags));
    let ctx = (four, len, cap, max, log, flags, repeat);
    assert_eq!((a, rc), (b, rr), "HUF_compressNX_repeat {ctx:?}");
    out.check("HUF_compressNX_repeat", &ctx);
    assert!(tc == tr, "HUF_compressNX_repeat table {ctx:?}");
    st.hit();

    // The next block, with the table that this one left, as the literals of a frame.
    if let Ok(n) = a && n > 1 {
        repeat = if rc == 0 { 1 } else { rc };
        let len2 = sizes(rng);
        let mut src2 = if rng.chance(1, 2) { literals(rng, len2) } else { let mut v = src.clone(); v.truncate(len2); v.reverse(); v };
        if rng.chance(1, 4) && !src2.is_empty() { let i = rng.below(src2.len()); src2[i] = rng.next() as u8; }
        let cap = unsafe { HUF_compressBound(src2.len()) };
        let mut out = Out::new(cap);
        let (mut rc, mut rr) = (repeat, repeat);
        let mut w = wksp();
        let a = res(unsafe { f(out.c_ptr(), cap, src2.as_ptr().cast(), src2.len(), 255, 11, w.as_mut_ptr().cast(), WKSP_SIZE, tc.as_mut_ptr(), &mut rc, cf) });
        let b = conv(rs::huf_compress_repeat(four, &mut out.r, &src2, 255, 11, &mut tr, &mut rr, flags));
        assert_eq!((a, rc), (b, rr), "HUF_compressNX_repeat second {ctx:?}");
        out.check("HUF_compressNX_repeat second", &ctx);
        assert!(tc == tr, "HUF_compressNX_repeat second table {ctx:?}");
        st.hit();
    }
}

/// `which`: `all`, or one of the names below.
pub fn run(seed: u64, iters: u64, which: &str) {
    assert_eq!(rs::HUF_CONSTANTS, (8704, 131072, 11, 8));
    assert_eq!(rs::FSE_NCOUNTBOUND, 512);
    let tests: &[(&str, fn(&mut Rng, &mut Stats))] = &[
        ("hist", t_hist), ("fse_logs", t_fse_logs), ("fse", t_fse), ("fse_tables", t_fse_tables), ("fse_bad_norm", t_fse_bad_norm),
        ("huf_table", t_huf_table), ("huf_read", t_huf_read), ("huf_repeat", t_huf_repeat),
    ];
    let mut totals = vec![0u64; tests.len()];
    for i in 0..iters {
        for (k, (name, test)) in tests.iter().enumerate() {
            if which != "all" && which != *name { continue; }
            let s = seed.wrapping_mul(1_000_003).wrapping_add(i).wrapping_mul(31).wrapping_add(k as u64);
            if std::env::var_os("ENTROPY_TRACE").is_some() { eprintln!("{name} seed {s}"); }
            let mut st = Stats { cases: 0 };
            test(&mut Rng(s), &mut st);
            totals[k] += st.cases;
        }
    }
    for ((name, _), n) in tests.iter().zip(&totals) { if *n > 0 { println!("{name}: {n} comparisons"); } }
    println!("entropy ok: seed {seed}, {iters} iterations, {} comparisons", totals.iter().sum::<u64>());
}

// ---------------------------------------------------------------- speed

fn time(name: &str, bytes: usize, mut c: impl FnMut() -> usize, mut r: impl FnMut() -> usize) {
    let mut best = [f64::MAX; 2];
    let reps = (200_000_000 / bytes.max(1)).clamp(20, 200_000) / 20;
    for _ in 0..7 {
        let t = std::time::Instant::now();
        for _ in 0..reps { std::hint::black_box(c()); }
        best[0] = best[0].min(t.elapsed().as_secs_f64() / reps as f64);
        let t = std::time::Instant::now();
        for _ in 0..reps { std::hint::black_box(r()); }
        best[1] = best[1].min(t.elapsed().as_secs_f64() / reps as f64);
    }
    println!("{name:40} C {:10.0} ns   Rust {:10.0} ns   ratio {:.2}", best[0] * 1e9, best[1] * 1e9, best[1] / best[0]);
}

/// Build with `--profile bench`.
pub fn bench() {
    let mut rng = Rng(7);
    let text: Vec<u8> = { let mut v = Vec::new(); while v.len() < 131072 { let n = 1 + rng.size(5000); let mut r2 = Rng(rng.next() | 2); let mut part = Vec::new(); while part.len() < n { part.extend_from_slice(format!("const x{} = await foo({});\n", r2.below(50), r2.below(1000)).as_bytes()); } v.extend_from_slice(&part); } v.truncate(131072); v };
    let skew = |k: usize, rng: &mut Rng| -> Vec<u8> { (0..131072).map(|_| { let mut b = rng.next() as u8; for _ in 0..k { b &= rng.next() as u8; } b }).collect() };
    let inputs: Vec<(&str, Vec<u8>)> = vec![("text", text), ("skew1", skew(1, &mut rng)), ("skew3", skew(3, &mut rng)), ("random", skew(0, &mut rng))];
    let mut w = wksp();
    let wp: *mut c_void = w.as_mut_ptr().cast();
    for (name, src) in &inputs {
        for len in [131072usize, 4000, 300] {
            let src = &src[..len];
            let p: *const c_void = src.as_ptr().cast();
            let (mut cc, mut cr) = (vec![0u32; 256], vec![0u32; 256]);
            time(&format!("HIST_count_wksp {name} {len}"), len,
                || { let mut m = 255; unsafe { HIST_count_wksp(cc.as_mut_ptr(), &mut m, p, len, wp, 4096) } },
                || { let mut m = 255; rs::hist_count_wksp(&mut cr, &mut m, src).unwrap() });
            let max = cc.iter().rposition(|&c| c != 0).unwrap() as u32;
            let mut t = [0u64; 257];
            let mut bt = bun_zstd::testing::entropy_bench::Table::new(&t);
            time(&format!("HUF_buildCTable_wksp {name} {len}"), 2000,
                || unsafe { HUF_buildCTable_wksp(t.as_mut_ptr(), cc.as_ptr(), max, 11, wp, WKSP_SIZE) },
                || bt.build(&cr, max, 11));
            let log = t[0] as u8 as u32;
            let cap = unsafe { HUF_compressBound(len) };
            let mut dst = vec![0u8; cap];
            let mut dst2 = vec![0u8; cap];
            time(&format!("HUF_writeCTable_wksp {name} {len}"), 2000,
                || unsafe { HUF_writeCTable_wksp(dst.as_mut_ptr().cast(), cap, t.as_ptr(), max, log, wp, WKSP_SIZE) },
                || bt.write(&mut dst2, max, log));
            for bits in [11u32, 10, 9, 8] {
                let mut t = [0u64; 257];
                if res(unsafe { HUF_buildCTable_wksp(t.as_mut_ptr(), cc.as_ptr(), max, bits, wp, WKSP_SIZE) }).is_err() { continue; }
                if (t[0] as u8 as u32) != bits { continue; }
                let bt = bun_zstd::testing::entropy_bench::Table::new(&t);
                time(&format!("HUF_compress4X_usingCTable {name} {len} log {bits}"), len,
                    || unsafe { HUF_compress4X_usingCTable(dst.as_mut_ptr().cast(), cap, p, len, t.as_ptr(), 0) },
                    || bt.compress4(&mut dst2, src));
            }
            for flags in [0u32, 2] {
                time(&format!("HUF_compress4X_repeat {name} {len} flags {flags}"), len,
                    || { let mut rep = 0; unsafe { HUF_compress4X_repeat(dst.as_mut_ptr().cast(), cap, p, len, 255, 11, wp, WKSP_SIZE, t.as_mut_ptr(), &mut rep, flags as c_int) } },
                    || bt.repeat4(&mut dst2, src, flags == 2));
            }
        }
    }
    // Sequences.
    for (max, log, n) in [(35u32, 9u32, 5000usize), (52, 9, 5000), (31, 8, 5000), (35, 6, 60)] {
        let count = { let mut c = vec![0u32; 256]; for _ in 0..n { let a = rng.below(max as usize + 1); let b = rng.below(max as usize + 1); c[a.min(b)] += 1; } c };
        let max = count.iter().rposition(|&c| c != 0).unwrap() as u32;
        let log = unsafe { FSE_optimalTableLog(log, n, max) };
        let (mut nc, mut nr) = (vec![0i16; 256], vec![0i16; 256]);
        time(&format!("FSE_normalizeCount {max} {log}"), 500,
            || unsafe { FSE_normalizeCount(nc.as_mut_ptr(), log, count.as_ptr(), n, max, 1) },
            || rs::fse_normalize_count(&mut nr, log, &count, n, max, true).unwrap());
        let mut buf = [0u8; 512];
        let mut buf2 = [0u8; 512];
        time(&format!("FSE_writeNCount {max} {log}"), 500,
            || unsafe { FSE_writeNCount(buf.as_mut_ptr().cast(), 512, nc.as_ptr(), max, log) },
            || rs::fse_write_ncount(&mut buf2, &nr, max, log).unwrap());
        let mut ct = c_fse_table();
        let mut rt = rs::Fse::new();
        time(&format!("FSE_buildCTable_wksp {max} {log}"), 500,
            || unsafe { FSE_buildCTable_wksp(ct.as_mut_ptr(), nc.as_ptr(), max, log, wp, WKSP_SIZE) },
            || { rt.build(&nr, max, log).unwrap(); 0 });
        let syms = data_among(&mut rng, &nc[..=max as usize], n);
        let cap = n * 4 + 64;
        let (mut d1, mut d2) = (vec![0u8; cap], vec![0u8; cap]);
        time(&format!("encode3 {max} {log} n {n}"), n * 3,
            || unsafe { shim_fse_encode3(d1.as_mut_ptr().cast(), cap, ct.as_ptr(), ct.as_ptr(), ct.as_ptr(), syms.as_ptr(), syms.as_ptr(), syms.as_ptr(), n) },
            || rs::fse_encode3(&mut d2, [&rt, &rt, &rt], [&syms, &syms, &syms]).unwrap());
    }
}
