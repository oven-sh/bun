//! Long distance matching and the block pre-splitter, against the C library.
use crate::c;
use crate::data::{Rng, data};
use bun_zstd::testing as t;
use std::ffi::{c_int, c_void};

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct LdmParams { enable: u32, hash_log: u32, bucket_size_log: u32, min_match_length: u32, hash_rate_log: u32, window_log: u32 }
#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct CParams { window_log: u32, chain_log: u32, hash_log: u32, search_log: u32, min_match: u32, target_length: u32, strategy: u32 }
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct RawSeq { offset: u32, lit_length: u32, match_length: u32 }
#[repr(C)]
struct RawSeqStore { seq: *mut RawSeq, pos: usize, pos_in_sequence: usize, size: usize, capacity: usize }
#[repr(C)]
#[derive(Clone, Copy)]
struct LdmEntry { offset: u32, checksum: u32 }
enum Shim {}

unsafe extern "C" {
    fn ZSTD_splitBlock(block: *const c_void, size: usize, level: c_int, wksp: *mut c_void, wksp_size: usize) -> usize;
    fn ZSTD_ldm_adjustParameters(p: *mut LdmParams, cp: *const CParams);
    fn ZSTD_ldm_getTableSize(p: LdmParams) -> usize;
    fn ZSTD_ldm_getMaxNbSeq(p: LdmParams, max_chunk_size: usize) -> usize;
    fn ZSTD_ldm_skipSequences(s: *mut RawSeqStore, src_size: usize, min_match: u32);
    fn ZSTD_ldm_skipRawSeqStoreBytes(s: *mut RawSeqStore, nb_bytes: usize);
    fn shim_ldm_new(p: *const u32, sizes: *const usize, capacity: usize, start_index: u32) -> *mut Shim;
    fn shim_ldm_free(s: *mut Shim);
    fn shim_ldm_update(s: *mut Shim, buf: c_int, pos: usize, data: *const c_void, len: usize);
    fn shim_ldm_poke(s: *mut Shim, buf: c_int, pos: usize, byte: u8);
    fn shim_ldm_load_dict(s: *mut Shim, buf: c_int, pos: usize, data: *const c_void, len: usize);
    fn shim_ldm_generate(s: *mut Shim, buf: c_int, pos: usize, len: usize, reset: c_int) -> usize;
    fn shim_ldm_seqs(s: *const Shim, nb: *mut usize) -> *const RawSeq;
    fn shim_ldm_window(s: *const Shim, out: *mut u32);
    fn shim_ldm_table(s: *const Shim) -> *const LdmEntry;
    fn shim_ldm_bucket_offsets(s: *const Shim) -> *const u8;
}

// ── the pre-splitter ──────────────────────────────────────────────────────

pub fn presplit(seed: u64, iters: u64) {
    const SIZE: usize = 128 << 10;
    let mut results = std::collections::BTreeMap::<(i32, usize), u64>::new();
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        let mut block = Vec::with_capacity(SIZE + 64);
        match rng.below(4) {
            0 => block = data(&mut rng, SIZE),
            1 => { // sections, cut anywhere
                while block.len() < SIZE { let n = 1 + rng.below(SIZE); block.extend(data(&mut rng, n)); }
            }
            2 => { // sections, cut at chunk boundaries
                while block.len() < SIZE { let n = (8 << 10) * rng.range(1, 16); let mut d = data(&mut rng, n); d.resize(n, 0); block.extend(d); }
            }
            _ => { // a slow drift of the distribution
                let (a, b) = (rng.range(1, 255), rng.range(1, 255));
                let base = rng.next() as u8;
                for k in 0..SIZE { let n = (a * (SIZE - k) + b * k) / SIZE; block.push(base.wrapping_add(rng.below(n.max(1)) as u8)); }
            }
        }
        block.resize(SIZE, 0);
        for level in 0..=4 {
            let mut wksp = vec![0xA5A5_A5A5_A5A5_A5A5u64; 8208 / 8];
            let expected = unsafe { ZSTD_splitBlock(block.as_ptr().cast(), SIZE, level, wksp.as_mut_ptr().cast(), 8208) };
            let got = t::split_block(&block, level).unwrap_or_else(|e| panic!("seed {s} level {level}: {e:?}"));
            assert_eq!(got, expected, "seed {s} level {level}");
            *results.entry((level, got >> 10)).or_default() += 1;
        }
    }
    println!("presplit ok: {iters} blocks from seed {seed}, at 5 levels. (level, KB) -> count: {results:?}");
}

// ── parameters ────────────────────────────────────────────────────────────

fn arr(p: LdmParams) -> [u32; 6] { [p.enable, p.hash_log, p.bucket_size_log, p.min_match_length, p.hash_rate_log, p.window_log] }

pub fn params(seed: u64, iters: u64) {
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        let zero = |rng: &mut Rng, lo: usize, hi: usize| if rng.chance(1, 3) { 0 } else { rng.range(lo, hi) as u32 };
        let p = LdmParams {
            enable: rng.below(3) as u32, hash_log: zero(&mut rng, 6, 30), bucket_size_log: zero(&mut rng, 1, 8),
            min_match_length: zero(&mut rng, 4, 4096), hash_rate_log: zero(&mut rng, 0, 25), window_log: rng.below(32) as u32,
        };
        let cp = CParams {
            window_log: rng.range(10, 31) as u32, chain_log: rng.range(6, 30) as u32, hash_log: rng.range(6, 30) as u32, search_log: rng.range(1, 30) as u32,
            min_match: rng.range(3, 7) as u32, target_length: rng.below(131073) as u32, strategy: rng.range(1, 9) as u32,
        };
        let mut expected = p;
        unsafe { ZSTD_ldm_adjustParameters(&mut expected, &cp) };
        let got = t::ldm_adjust_parameters(arr(p), [cp.window_log, cp.chain_log, cp.hash_log, cp.search_log, cp.min_match, cp.target_length, cp.strategy]);
        assert_eq!(got, arr(expected), "seed {s}: {p:?} {cp:?}");
        for q in [expected, LdmParams { min_match_length: p.min_match_length.max(1), ..p }] {
            assert_eq!(t::ldm_get_table_size(arr(q)), unsafe { ZSTD_ldm_getTableSize(q) }, "seed {s}: {q:?}");
            let n = rng.next() as usize >> rng.range(1, 63);
            assert_eq!(t::ldm_get_max_nb_seq(arr(q), n), unsafe { ZSTD_ldm_getMaxNbSeq(q, n) }, "seed {s}: {q:?} {n}");
        }
    }
    println!("ldm params ok: {iters} iterations from seed {seed}");
}

// ── moving in a store of sequences ────────────────────────────────────────

pub fn skip(seed: u64, iters: u64) {
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        let capacity = rng.below(12);
        let size = rng.below(capacity + 1);
        let max = *rng.pick(&[3usize, 20, 300, 70_000, 5_000_000]);
        let seq: Vec<t::Raw> = (0..capacity).map(|_| (1 + rng.size(1 << 27) as u32, rng.size(max) as u32, rng.size(max) as u32)).collect();
        let mut store = t::RawStore { seq, pos: rng.below(size + 1), pos_in_sequence: 0, size };
        for step in 0..rng.range(1, 12) {
            let mut c_seq: Vec<RawSeq> = store.seq.iter().map(|q| RawSeq { offset: q.0, lit_length: q.1, match_length: q.2 }).collect();
            let mut c_store = RawSeqStore { seq: c_seq.as_mut_ptr(), pos: store.pos, pos_in_sequence: store.pos_in_sequence, size, capacity };
            let n = rng.size(max * 3);
            let before = store.clone();
            let which = rng.chance(1, 2);
            let min_match = rng.range(3, 7) as u32;
            if which {
                unsafe { ZSTD_ldm_skipSequences(&mut c_store, n, min_match) };
                t::ldm_skip_sequences(&mut store, n, min_match).unwrap();
            } else {
                unsafe { ZSTD_ldm_skipRawSeqStoreBytes(&mut c_store, n) };
                t::ldm_skip_raw_seq_store_bytes(&mut store, n).unwrap();
            }
            let expected = t::RawStore {
                pos: c_store.pos, pos_in_sequence: c_store.pos_in_sequence, size: c_store.size,
                seq: c_seq.iter().map(|q| (q.offset, q.lit_length, q.match_length)).collect(),
            };
            assert_eq!(store, expected, "seed {s} step {step}: skip{} {n} min_match {min_match} from {before:?}", if which { "Sequences" } else { "RawSeqStoreBytes" });
        }
    }
    println!("ldm skip ok: {iters} iterations from seed {seed}");
}

// ── finding the sequences ─────────────────────────────────────────────────

/// Content with repeats of all lengths at all distances.
pub fn long_repeats(rng: &mut Rng, len: usize) -> Vec<u8> {
    let mut v: Vec<u8> = Vec::with_capacity(len + 64);
    let max_copy = *rng.pick(&[200usize, 5000, 100_000, 2_000_000]);
    let max_fresh = *rng.pick(&[100usize, 5000, 100_000, 1_000_000]);
    let noise = rng.chance(1, 2);
    let copies = rng.range(1, 7);
    while v.len() < len {
        if v.len() > 64 && rng.chance(copies, 8) {
            let n = (1 + rng.size(max_copy)).min(v.len());
            let from = if rng.chance(1, 2) { rng.below(v.len() - n + 1) } else { v.len() - n - rng.size(v.len() - n) };
            v.extend_from_within(from..from + n);
            if rng.chance(1, 3) {
                for _ in 0..rng.range(1, 4) { let at = v.len() - 1 - rng.below(n); v[at] ^= 1 + (rng.next() as u8 & 0x7f); }
            }
        } else {
            let n = 1 + rng.size(max_fresh);
            if noise { for _ in 0..n.div_ceil(8) { v.extend_from_slice(&rng.next().to_le_bytes()); } } else { v.extend(data(rng, n)); }
        }
    }
    v.truncate(len);
    v
}

#[derive(Default, Debug)]
pub struct Stats { scenarios: u64, bytes: u64, calls: u64, seqs: u64, calls_ext_dict: u64, seqs_ext_dict: u64, corrections: u64, errors: u64, dicts: u64, full: u64 }

struct Pair { c: *mut Shim, r: t::Ldm, ctx: String }
impl Drop for Pair { fn drop(&mut self) { unsafe { shim_ldm_free(self.c) } } }
impl Pair {
    fn c_window(&self) -> [u32; 5] { let mut w = [0u32; 5]; unsafe { shim_ldm_window(self.c, w.as_mut_ptr()) }; w }
    fn check_window(&self, at: &str) { assert_eq!(self.r.window(), self.c_window(), "{}: window after {at}", self.ctx); }
    fn update(&mut self, buf: usize, pos: usize, d: &[u8]) {
        unsafe { shim_ldm_update(self.c, buf as c_int, pos, d.as_ptr().cast(), d.len()) };
        self.r.update(buf, pos, d);
        self.check_window("update");
    }
    fn poke(&mut self, buf: usize, pos: usize, byte: u8) {
        unsafe { shim_ldm_poke(self.c, buf as c_int, pos, byte) };
        self.r.poke(buf, pos, byte);
    }
    fn load_dict(&mut self, buf: usize, pos: usize, d: &[u8]) {
        unsafe { shim_ldm_load_dict(self.c, buf as c_int, pos, d.as_ptr().cast(), d.len()) };
        self.r.load_dict(buf, pos, d).unwrap_or_else(|e| panic!("{}: load_dict {e:?}", self.ctx));
        self.check_window("load_dict");
    }
    /// Whether it went without an error.
    fn generate(&mut self, buf: usize, pos: usize, len: usize, reset: bool, stats: &mut Stats) -> bool {
        let before = self.c_window();
        let expected = c::res(unsafe { shim_ldm_generate(self.c, buf as c_int, pos, len, reset as c_int) }).map(|_| ());
        let got = self.r.generate(pos, len, reset).map_err(|e| e as u32);
        let at = format!("generate(buf {buf}, pos {pos}, len {len}, reset {reset}), window before {before:?}");
        assert_eq!(got, expected, "{}: result of {at}", self.ctx);
        let mut nb = 0usize;
        let c_seqs = unsafe { let p = shim_ldm_seqs(self.c, &mut nb); std::slice::from_raw_parts(p, nb) };
        let r_seqs = self.r.seqs();
        let same = r_seqs.len() == nb && r_seqs.iter().zip(c_seqs).all(|(a, b)| *a == (b.offset, b.lit_length, b.match_length));
        if !same {
            let k = r_seqs.iter().zip(c_seqs).position(|(a, b)| *a != (b.offset, b.lit_length, b.match_length)).unwrap_or(nb.min(r_seqs.len()));
            panic!("{}: {at}: sequence {k} differs: got {:?}, expected {:?} ({} vs {nb} sequences)", self.ctx, r_seqs.get(k), c_seqs.get(k), r_seqs.len());
        }
        self.check_window(&at);
        let after = self.c_window();
        stats.calls += 1;
        stats.bytes += len as u64;
        if reset { stats.seqs += nb as u64; }
        if after[1] < after[0] { stats.calls_ext_dict += 1; if reset { stats.seqs_ext_dict += nb as u64; } }
        stats.corrections += u64::from(after[4] - before[4]);
        if expected.is_err() { stats.errors += 1; }
        expected.is_ok()
    }
    fn check_tables(&self, p: &LdmParams) {
        let table = unsafe { std::slice::from_raw_parts(shim_ldm_table(self.c), 1 << p.hash_log) };
        for (k, (a, b)) in self.r.table().zip(table).enumerate() {
            assert_eq!(a, (b.offset, b.checksum), "{}: entry {k} of the hash table", self.ctx);
        }
        let offsets = unsafe { std::slice::from_raw_parts(shim_ldm_bucket_offsets(self.c), 1 << (p.hash_log - p.bucket_size_log)) };
        assert!(self.r.bucket_offsets() == offsets, "{}: bucket offsets", self.ctx);
    }
}

fn scenario(s: u64, max_len: usize, stats: &mut Stats) {
    let mut rng = Rng(s);
    let mut p = LdmParams {
        enable: 1,
        hash_log: if rng.chance(1, 12) { rng.range(17, 24) } else { rng.range(6, 16) } as u32,
        bucket_size_log: rng.range(1, 8) as u32,
        min_match_length: match rng.below(4) { 0 => rng.range(4, 12), 1 => *rng.pick(&[16usize, 32, 63, 64, 65, 128]), 2 => rng.range(4, 300), _ => rng.range(4, 4096) } as u32,
        hash_rate_log: if rng.chance(1, 8) { rng.range(0, 25) } else { rng.range(0, 10) } as u32,
        window_log: 0,
    };
    let cp = CParams { window_log: rng.range(10, 27) as u32, chain_log: 6, hash_log: 6, search_log: 1, min_match: 4, target_length: 0, strategy: rng.range(1, 9) as u32 };
    if rng.chance(1, 6) { p.hash_log = 0; p.hash_rate_log = 0; }
    if rng.chance(1, 6) { p.hash_rate_log = 0; }
    if rng.chance(1, 6) { p.bucket_size_log = 0; }
    if rng.chance(1, 6) { p.min_match_length = 0; }
    unsafe { ZSTD_ldm_adjustParameters(&mut p, &cp) };
    if p.hash_log > 24 { p.hash_log = 24; }

    let mut len = match rng.below(5) { 0 => rng.size(5000), 1 => rng.size(300_000), 2 => rng.size(max_len), _ => rng.range(max_len / 4, max_len) } + 1;
    while (len as u64 * u64::from(p.min_match_length)) >> p.hash_rate_log > 100 << 20 { len /= 2; }
    let content = long_repeats(&mut rng, len);

    let layout = rng.below(5);
    let dict_len = if layout == 1 || layout == 2 || rng.chance(1, 8) { rng.size(len / 2) } else { 0 };
    let ring = if layout == 4 { (rng.size(len) + 1).max(16) } else { 0 };
    let room = len + 64;
    let sizes = if layout == 4 { [ring, 0, dict_len] } else { [room, room, room] };
    let start_index = match rng.below(8) {
        0 => (3500u32 << 20).wrapping_sub(rng.below(len + (2 << 20)) as u32).wrapping_add(rng.below(1 << 20) as u32),
        1 => 2 + rng.size(3400 << 20) as u32,
        _ => 0,
    };
    let reset = rng.chance(3, 4);
    let capacity = if rng.chance(1, 10) { rng.below(6) } else { len / p.min_match_length as usize + 1 };
    let max_update = *rng.pick(&[1000usize, 128 << 10, 1 << 20, 5 << 20, usize::MAX >> 1]);
    let pokes = if rng.chance(1, 8) { rng.range(1, 200) } else { 0 };
    let piece = *rng.pick(&[0usize, 128 << 10, 128 << 10, 1]);
    let ctx = format!("seed {s}: {p:?} len {len} layout {layout} dict {dict_len} ring {ring} start_index {start_index} reset {reset} capacity {capacity} pokes {pokes}");
    let pa = arr(p);
    let mut pair = Pair { c: unsafe { shim_ldm_new(pa.as_ptr(), sizes.as_ptr(), capacity, start_index) }, r: t::Ldm::new(pa, sizes, capacity, start_index), ctx };
    stats.scenarios += 1;

    let (mut buf, mut pos) = (if layout == 4 { 0 } else { 1 }, 0usize);
    let mut done = 0usize;
    if dict_len > 0 {
        stats.dicts += 1;
        if layout == 2 { pair.load_dict(buf, 0, &content[..dict_len]); pos = dict_len; } else { pair.load_dict(2, 0, &content[..dict_len]); }
        done = dict_len;
    }
    'all: while done < len {
        let mut n = (1 + rng.size(max_update.min(len - done) - 1)).min(len - done);
        match layout {
            3 if rng.chance(1, 3) => { buf = rng.below(3); pos = rng.below(room - n + 1); }
            4 => { n = n.min(ring); if pos + n > ring { pos = 0; } }
            _ => {}
        }
        if pos + n > sizes[buf] { pos = 0; }
        pair.update(buf, pos, &content[done..done + n]);
        let end = pos + n;
        for _ in 0..pokes {
            let b = rng.below(3);
            if sizes[b] > 0 { pair.poke(b, rng.below(sizes[b]), rng.next() as u8); }
        }
        while pos < end {
            let m = match piece { 0 => end - pos, 1 => 1 + rng.size(end - pos - 1), k => k.min(end - pos) };
            if !pair.generate(buf, pos, m, reset, stats) { break 'all; }
            pos += m;
        }
        done += n;
    }
    pair.check_tables(&p);
}

pub fn run(seed: u64, iters: u64, max_len: usize) {
    let mut stats = Stats::default();
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        if i % 200 == 0 { eprintln!("ldm iter {i} (seed {s})"); }
        scenario(s, max_len, &mut stats);
    }
    println!("ldm ok: {iters} scenarios from seed {seed}, up to {max_len} bytes: {stats:?}");
}

pub fn bench(len: usize) {
    let mut rng = Rng(42);
    for (name, content) in [("repeats", long_repeats(&mut rng, len)), ("text", { let mut v = Vec::new(); while v.len() < len { v.extend(data(&mut Rng(2 + v.len() as u64 % 3), 300_000)); } v.truncate(len); v })] {
        let mut p = LdmParams { enable: 1, hash_log: 0, bucket_size_log: 0, min_match_length: 0, hash_rate_log: 0, window_log: 0 };
        let cp = CParams { window_log: 27, chain_log: 6, hash_log: 6, search_log: 1, min_match: 4, target_length: 0, strategy: 2 };
        unsafe { ZSTD_ldm_adjustParameters(&mut p, &cp) };
        let pa = arr(p);
        let sizes = [0, len, 0];
        let capacity = len / 64 + 1;
        for _ in 0..3 {
            let c = unsafe { shim_ldm_new(pa.as_ptr(), sizes.as_ptr(), capacity, 0) };
            let mut r = t::Ldm::new(pa, sizes, capacity, 0);
            unsafe { shim_ldm_update(c, 1, 0, content.as_ptr().cast(), len) };
            r.update(1, 0, &content);
            let t0 = std::time::Instant::now();
            unsafe { shim_ldm_generate(c, 1, 0, len, 1) };
            let t1 = std::time::Instant::now();
            r.generate(0, len, true).unwrap();
            let t2 = std::time::Instant::now();
            println!("{name}: {p:?}: C {:.1} MB/s, Rust {:.1} MB/s, {} sequences", len as f64 / 1e6 / (t1 - t0).as_secs_f64(), len as f64 / 1e6 / (t2 - t1).as_secs_f64(), r.seqs().len());
            unsafe { shim_ldm_free(c) };
        }
    }
    let block = data(&mut Rng(7), 128 << 10);
    let block = &block[..128 << 10];
    for level in 0..=4 {
        let mut wksp = vec![0u64; 8208 / 8];
        let n = 2000;
        let t0 = std::time::Instant::now();
        let mut a = 0;
        for _ in 0..n { a += unsafe { ZSTD_splitBlock(std::hint::black_box(block).as_ptr().cast(), block.len(), level, wksp.as_mut_ptr().cast(), 8208) }; }
        let t1 = std::time::Instant::now();
        let mut b = 0;
        for _ in 0..n { b += t::split_block(std::hint::black_box(block), level).unwrap(); }
        let t2 = std::time::Instant::now();
        println!("split level {level}: C {:.2} us, Rust {:.2} us ({a} {b})", (t1 - t0).as_secs_f64() * 1e6 / n as f64, (t2 - t1).as_secs_f64() * 1e6 / n as f64);
    }
}

// ── ZSTD_ldm_blockCompress ────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy)]
struct SeqDef { off_base: u32, lit_length: u16, ml_base: u16 }
enum ShimBlk {}
unsafe extern "C" {
    fn shim_blk_new(cp: *mut u32, use_row: c_int, dict: *const c_void, dict_size: usize, src: *const c_void, src_size: usize, seqs: *const RawSeq, nb: usize) -> *mut ShimBlk;
    fn shim_blk_free(s: *mut ShimBlk);
    fn shim_blk_max_block(s: *const ShimBlk) -> usize;
    fn shim_blk_run(s: *mut ShimBlk, pos: usize, block_size: usize) -> usize;
    fn shim_blk_seqs(s: *const ShimBlk, nb: *mut usize) -> *const SeqDef;
    fn shim_blk_literals(s: *const ShimBlk, nb: *mut usize) -> *const u8;
    fn shim_blk_state(s: *const ShimBlk, out: *mut u32);
    fn shim_blk_store(s: *const ShimBlk) -> *const RawSeqStore;
}

unsafe fn slice_of<'a, T>(p: *const T, n: usize) -> &'a [T] { if n == 0 { &[] } else { unsafe { std::slice::from_raw_parts(p, n) } } }

pub fn blocks(seed: u64, iters: u64, strategies: &[u32], max_len: usize) {
    let (mut nb_blocks, mut nb_seqs, mut nb_raw, mut nb_dict) = (0u64, 0u64, 0u64, 0u64);
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        let mut rng = Rng(s);
        if i % 200 == 0 { eprintln!("ldmblocks iter {i} (seed {s})"); }
        let len = match rng.below(3) { 0 => rng.size(20_000), 1 => rng.size(max_len), _ => rng.range(max_len / 4, max_len) } + 1;
        let dict_len = if rng.chance(1, 3) { 8 + rng.size(len) } else { 0 }; // less than 8 bytes are not loaded
        let content = long_repeats(&mut rng, dict_len + len);
        let (dict, src) = content.split_at(dict_len);
        let mut cp = [
            rng.range(10, 24) as u32, rng.range(6, 18) as u32, rng.range(6, 18) as u32, rng.range(1, 7) as u32, rng.range(3, 7) as u32,
            *rng.pick(&[0u32, 1, 2, 8, 32, 64, 256, 999]), *rng.pick(strategies),
        ];
        let use_row = rng.chance(1, 2);

        // The long distance matches of the whole input, or made-up sequences.
        let raw: Vec<t::Raw> = if rng.chance(2, 3) {
            let mut p = LdmParams {
                enable: 1, hash_log: rng.range(6, 16) as u32, bucket_size_log: rng.range(1, 6) as u32,
                min_match_length: *rng.pick(&[4u32, 8, 16, 32, 64, 200]), hash_rate_log: rng.range(0, 7) as u32, window_log: 0,
            };
            let c = CParams { window_log: cp[0], chain_log: 6, hash_log: 6, search_log: 1, min_match: 4, target_length: 0, strategy: cp[6] };
            unsafe { ZSTD_ldm_adjustParameters(&mut p, &c) };
            let mut l = t::Ldm::new(arr(p), [0, len, dict_len], len / p.min_match_length as usize + 1, 0);
            if dict_len > 0 { l.load_dict(2, 0, dict).unwrap(); }
            l.update(1, 0, src);
            l.generate(0, len, true).unwrap();
            l.seqs()
        } else {
            let (max_ll, max_ml) = (*rng.pick(&[0usize, 10, 1000, 70_000, 300_000]), *rng.pick(&[10usize, 1000, 70_000, 300_000]));
            let mut v = Vec::new();
            let mut at = 0usize;
            let stop = rng.below(len + len / 4 + 1);
            while at < stop {
                let (ll, ml) = (rng.size(max_ll), 4 + rng.size(max_ml));
                at += ll + ml;
                let beyond = rng.below(2);
                v.push((1 + rng.size((at - ml + dict_len).max(1).min(1 << cp[0]) - 1 + beyond) as u32, ll as u32, ml as u32));
            }
            v
        };
        let c_raw: Vec<RawSeq> = raw.iter().map(|q| RawSeq { offset: q.0, lit_length: q.1, match_length: q.2 }).collect();

        let c = unsafe { shim_blk_new(cp.as_mut_ptr(), use_row as c_int, dict.as_ptr().cast(), dict.len(), src.as_ptr().cast(), src.len(), c_raw.as_ptr(), c_raw.len()) };
        let ctx = format!("seed {s}: cp {cp:?} row {use_row} dict {dict_len} src {len} raw sequences {}", raw.len());
        let mut r = t::LdmBlocks::new(cp, use_row, dict, src, &raw).unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
        let max_block = unsafe { shim_blk_max_block(c) };
        let full_blocks = rng.chance(1, 2);
        let mut pos = 0usize;
        nb_raw += raw.len() as u64;
        nb_dict += u64::from(dict_len > 0);
        while pos < len {
            let n = if full_blocks { max_block } else { 1 + rng.size(max_block - 1) }.min(len - pos);
            if std::env::var_os("LDM_TRACE").is_some() { eprintln!("{ctx}: block at {pos} of {n} (max {max_block})"); }
            let last_ll = c::res(unsafe { shim_blk_run(c, pos, n) }).unwrap_or_else(|e| panic!("{ctx}: C error {e}"));
            let got = r.run(pos, n).unwrap_or_else(|e| panic!("{ctx}: block at {pos} of {n}: {e:?}"));
            let expected = unsafe {
                let mut nb = 0usize;
                let seqs = slice_of(shim_blk_seqs(c, &mut nb), nb).iter().map(|q| (q.off_base, q.lit_length, q.ml_base)).collect();
                let literals = slice_of(shim_blk_literals(c, &mut nb), nb).to_vec();
                let mut st = [0u32; 6];
                shim_blk_state(c, st.as_mut_ptr());
                let store = &*shim_blk_store(c);
                t::BlockOut {
                    seqs, literals, last_ll, long_length: if st[0] == 0 { None } else { Some((st[0], st[1])) }, rep: [st[2], st[3], st[4]], next_to_update: st[5],
                    store: t::RawStore {
                        seq: slice_of(store.seq, store.capacity).iter().map(|q| (q.offset, q.lit_length, q.match_length)).collect(),
                        pos: store.pos, pos_in_sequence: store.pos_in_sequence, size: store.size,
                    },
                }
            };
            if got != expected {
                let k = got.seqs.iter().zip(&expected.seqs).position(|(a, b)| a != b).unwrap_or(got.seqs.len().min(expected.seqs.len()));
                panic!("{ctx}: block at {pos} of {n}: sequence {k}: got {:?}, expected {:?} ({} vs {}); last_ll {} vs {}; rep {:?} vs {:?}; long {:?} vs {:?}; next_to_update {} vs {}; literals same {}; store same {} (pos {} vs {}, in sequence {} vs {})",
                    got.seqs.get(k), expected.seqs.get(k), got.seqs.len(), expected.seqs.len(), got.last_ll, expected.last_ll, got.rep, expected.rep,
                    got.long_length, expected.long_length, got.next_to_update, expected.next_to_update, got.literals == expected.literals, got.store == expected.store,
                    got.store.pos, expected.store.pos, got.store.pos_in_sequence, expected.store.pos_in_sequence);
            }
            nb_blocks += 1;
            nb_seqs += got.seqs.len() as u64;
            pos += n;
        }
        unsafe { shim_blk_free(c) };
    }
    println!("ldm blocks ok: {iters} inputs from seed {seed}, strategies {strategies:?}, up to {max_len} bytes: {nb_blocks} blocks, {nb_seqs} sequences, {nb_raw} raw sequences, {nb_dict} with a prefix");
}
