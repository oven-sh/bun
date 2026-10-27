//! The block compressors and the table fillers of `fast` and `dfast`, call by call, against the C functions
//! (`c/shim.c`), on match states made by hand: dictionaries that are loaded, attached (dictMatchState) or none, input
//! in chunks that are contiguous or not or that overwrite earlier input, blocks of any size, indices that start high.
//! After each call the sequences, the literals, the repeat offsets and the tables are compared.
use crate::data::{Rng, data};
use bun_zstd::testing::TestMs;
use std::ffi::c_void;

pub enum Shim {}
#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
pub struct State {
    base: u64, dict_base: u64, next_src: u64,
    dict_limit: u32, low_limit: u32, loaded_dict_end: u32, next_to_update: u32, dict_mode: u32, pad: u32,
}
#[repr(C)]
#[derive(Clone, Copy, Debug)]
struct SeqDef { off_base: u32, lit_length: u16, ml_base: u16 }

unsafe extern "C" {
    fn shim_new(cp: *const u32, max_block: usize) -> *mut Shim;
    fn shim_free(s: *mut Shim);
    fn shim_state(s: *const Shim, st: *mut State);
    fn shim_hash_table(s: *const Shim) -> *const u32;
    fn shim_chain_table(s: *const Shim) -> *const u32;
    fn shim_bump(s: *mut Shim, index: u32);
    fn shim_load_dict(s: *mut Shim, src: *const c_void, size: usize, dtlm: i32, tfp: i32, force: i32, before: *mut State) -> i32;
    fn shim_attach(s: *mut Shim, dict: *const Shim) -> i32;
    fn shim_update(s: *mut Shim, src: *const c_void, size: usize) -> i32;
    fn shim_pre_block(s: *mut Shim, src: *const c_void, size: usize);
    fn shim_block(s: *mut Shim, rep: *mut u32, src: *const c_void, size: usize) -> usize;
    fn shim_nb_seq(s: *const Shim) -> usize;
    fn shim_seqs(s: *const Shim) -> *const SeqDef;
    fn shim_lit_len(s: *const Shim) -> usize;
    fn shim_lits(s: *const Shim) -> *const u8;
    fn shim_long_type(s: *const Shim) -> u32;
    fn shim_long_pos(s: *const Shim) -> u32;
}

/// The same match state on both sides.
struct Pair { c: *mut Shim, r: TestMs, cp: [u32; 7] }
impl Pair {
    fn new(cp: [u32; 7], max_block: usize) -> Self { Self { c: unsafe { shim_new(cp.as_ptr(), max_block) }, r: TestMs::new(cp, max_block), cp } }
    fn state(&self) -> State { let mut st = State::default(); unsafe { shim_state(self.c, &mut st) }; st }
    fn sync(&mut self, st: &State) { self.r.set_state(st.dict_limit, st.low_limit, st.loaded_dict_end, st.next_to_update); }
    fn check_tables(&self, what: &str) {
        let (hash, chain) = self.r.tables();
        let c_hash = unsafe { std::slice::from_raw_parts(shim_hash_table(self.c), 1 << self.cp[2]) };
        let c_chain = unsafe { std::slice::from_raw_parts(shim_chain_table(self.c), 1 << self.cp[1]) };
        if let Some(at) = hash.iter().zip(c_hash).position(|(a, b)| a != b) { panic!("{what}: hash table differs at {at}: got {}, expected {}", hash[at], c_hash[at]); }
        if let Some(at) = chain.iter().zip(c_chain).position(|(a, b)| a != b) { panic!("{what}: chain table differs at {at}: got {}, expected {}", chain[at], c_chain[at]); }
    }
    /// Returns the state after the load.
    fn load_dict(&mut self, dict: &[u8], full: bool, for_cdict: bool, force: bool) -> State {
        let mut before = State::default();
        let filled = unsafe { shim_load_dict(self.c, dict.as_ptr().cast(), dict.len(), full as i32, for_cdict as i32, force as i32, &mut before) };
        if filled != 0 {
            self.sync(&before);
            let base = (before.base as usize).wrapping_sub(dict.as_ptr() as usize);
            self.r.fill(dict, base, dict.len(), full, for_cdict).unwrap_or_else(|e| panic!("fill: error {e:?}"));
            self.check_tables("fill");
        }
        self.state()
    }
}
impl Drop for Pair { fn drop(&mut self) { unsafe { shim_free(self.c) } } }

#[derive(Default)]
pub struct Stats { pub blocks: [[u64; 3]; 2], pub seqs: [[u64; 3]; 2], pub fills: [[u64; 4]; 2] }

fn splice(rng: &mut Rng, from: &[u8], to: &mut [u8], times: usize) {
    if from.is_empty() || to.is_empty() { return; }
    for _ in 0..times {
        let n = rng.size(from.len().min(to.len()));
        let at = rng.below(from.len() - n + 1);
        let dst = rng.below(to.len() - n + 1);
        to[dst..dst + n].copy_from_slice(&from[at..at + n]);
    }
}

fn one(rng: &mut Rng, stats: &mut Stats) {
    let strategy = rng.range(1, 2) as u32;
    let si = strategy as usize - 1;
    let window_log = *rng.pick(&[10u32, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20]);
    let log = |rng: &mut Rng| if rng.chance(1, 4) { rng.range(6, 9) } else { rng.range(8, 17) } as u32;
    let min_match = rng.range(3, 7) as u32;
    let target_length = *rng.pick(&[0u32, 0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 32, 100, 999]);
    let cp = [window_log, log(rng), log(rng), 1, min_match, target_length, strategy];
    let mut block_max = (1usize << window_log).min(128 << 10);
    if rng.chance(1, 3) { block_max = block_max.min(1 << rng.range(10, 17)); }

    let total = { let m = *rng.pick(&[60usize, 600, 6000, 40_000, 40_000, 300_000]); rng.range(1, m) };
    let mut corpus = data(rng, total);
    let kind = rng.below(5); // 0, 1: no dictionary. 2: loaded. 3, 4: attached.
    let dict_len = if kind >= 2 { let m = *rng.pick(&[12usize, 100, 2000, 30_000, 200_000]); rng.range(1, m) } else { 0 };
    let mut dict = data(rng, dict_len);
    if rng.chance(1, 2) { let t = rng.range(1, 6); splice(rng, &corpus, &mut dict, t); }
    if rng.chance(3, 4) { let t = rng.range(1, 12); splice(rng, &dict, &mut corpus, t); }
    if rng.chance(1, 2) { let t = rng.range(1, 8); let copy = corpus.clone(); splice(rng, &copy, &mut corpus, t); }

    let mut pair = Pair::new(cp, block_max);
    if rng.chance(1, 4) {
        let index = *rng.pick(&[100u32, 70_000, 1 << 24, 1 << 31, 3_600_000_000]);
        unsafe { shim_bump(pair.c, rng.range(2, index as usize) as u32) };
    }

    // Each region is a buffer of its own. `cur` is the one of the current segment of the window, `ext` of the older.
    let mut regions: Vec<Vec<u8>> = Vec::new();
    let mut cur: Option<usize> = None;
    let mut cur_end = 0usize;
    let mut ext: Option<usize> = None;
    let mut rep = [1u32, 4, 8];

    let mut dict_pair: Option<Pair> = None;
    let mut dms_state = State::default();
    let mut attached = false;
    if kind == 2 {
        let room = if rng.chance(1, 2) { rng.size(total) + rng.below(20) } else { 0 };
        let mut mem = dict.clone();
        mem.resize(dict.len() + room, 0);
        regions.push(mem);
        let full = rng.chance(1, 3);
        let force = rng.chance(1, 4);
        let filled_before = pair.state();
        let _ = filled_before;
        pair.load_dict(&regions[0][..dict.len()], full, false, force);
        stats.fills[si][full as usize] += 1;
        cur = Some(0);
        cur_end = dict.len();
    } else if kind >= 3 {
        let mut dcp = cp;
        dcp[1] = log(rng);
        dcp[2] = log(rng);
        if rng.chance(1, 8) { dcp[4] = rng.range(3, 7) as u32; }
        let mut d = Pair::new(dcp, 16);
        let full = rng.chance(4, 5);
        dms_state = d.load_dict(&dict, full, true, false);
        stats.fills[si][2 + full as usize] += 1;
        attached = unsafe { shim_attach(pair.c, d.c) } != 0;
        dict_pair = Some(d);
        if rng.chance(1, 3) { rep = [rng.range(1, dict.len()) as u32, rng.range(1, dict.len()) as u32, rng.range(1, dict.len()) as u32]; }
    }
    if kind < 3 && rng.chance(1, 4) {
        let mut r = |rng: &mut Rng| { let m = *rng.pick(&[10usize, 1000, 100_000, u32::MAX as usize]); rng.range(1, m) as u32 };
        rep = [r(rng), r(rng), r(rng)];
    }

    let mut consumed = 0usize;
    while consumed < corpus.len() {
        let left = corpus.len() - consumed;
        let n = if rng.chance(1, 3) { left } else { rng.range(1, left) };
        let chunk = &corpus[consumed..consumed + n];
        consumed += n;

        // Where the chunk goes.
        let choice = rng.below(10);
        let (region, at) = match cur {
            Some(r) if choice < 6 && cur_end + n <= regions[r].len() => (r, cur_end),
            Some(r) if choice >= 8 && n <= regions[r].len() => (r, if rng.chance(1, 2) { 0 } else { rng.below(regions[r].len() - n + 1) }),
            _ => {
                let room = if rng.chance(2, 3) { rng.size(left - n + 64) } else { 0 };
                let lead = if rng.chance(1, 4) { rng.below(40) } else { 0 };
                regions.push(vec![0; lead + n + room]);
                (regions.len() - 1, lead)
            }
        };
        regions[region][at..at + n].copy_from_slice(chunk);
        let ptr = regions[region].as_ptr();
        let contiguous = unsafe { shim_update(pair.c, ptr.add(at).cast(), n) } != 0;
        if !contiguous { ext = cur; cur = Some(region); }
        assert_eq!(cur, Some(region));
        cur_end = at + n;

        let mut pos = at;
        while pos < cur_end {
            let size = (cur_end - pos).min(if rng.chance(1, 4) { rng.range(1, block_max) } else { block_max });
            unsafe { shim_pre_block(pair.c, ptr.add(pos).cast(), size) };
            let st = pair.state();
            pair.sync(&st);
            attached &= st.dict_mode == 2 || (st.dict_mode == 1 && st.loaded_dict_end != 0);
            let buf = &regions[region][..];
            let dict_buf: &[u8] = ext.map_or(&[], |r| &regions[r][..]);
            let base = (st.base as usize).wrapping_sub(buf.as_ptr() as usize);
            let dict_base = (st.dict_base as usize).wrapping_sub(dict_buf.as_ptr() as usize);
            let dms = if st.dict_mode == 2 {
                let d = dict_pair.as_ref().unwrap();
                Some((&d.r, &dict[..], (dms_state.base as usize).wrapping_sub(dict.as_ptr() as usize), (dms_state.next_src as usize).wrapping_sub(dict.as_ptr() as usize)))
            } else { None };

            // Repeat offsets at the limit of what is valid.
            if rng.chance(1, 5) {
                let curr = (ptr as usize + pos).wrapping_sub(st.base as usize) as u32;
                let reach = if st.dict_mode == 2 {
                    let dict_size = (dms_state.next_src - dms_state.base) as u32 - dms_state.dict_limit;
                    (curr - st.dict_limit + dict_size).saturating_sub(rng.below(3) as u32)
                } else {
                    let lowest_valid = if rng.chance(1, 2) { st.low_limit } else { st.dict_limit };
                    let from = if rng.chance(1, 2) { curr } else { curr + size as u32 };
                    let low = if st.loaded_dict_end == 0 && from - lowest_valid > 1 << window_log { from - (1 << window_log) } else { lowest_valid };
                    (curr - low + rng.size(64) as u32).saturating_sub(2)
                };
                if reach != 0 { rep[rng.below(2)] = reach; }
            }
            let (mut rep_c, mut rep_r) = (rep, rep);
            let expected = unsafe { shim_block(pair.c, rep_c.as_mut_ptr(), ptr.add(pos).cast(), size) };
            let what = format!("block {pos}..{} of region {region} (mode {}, {st:?})", pos + size, st.dict_mode);
            let got = pair.r.block(&mut rep_r, st.dict_mode, buf, base, dict_buf, dict_base, pos, pos + size, dms)
                .unwrap_or_else(|e| panic!("{what}: error {e:?}"));

            let c_seqs: Vec<(u32, u16, u16)> = unsafe { std::slice::from_raw_parts(shim_seqs(pair.c), shim_nb_seq(pair.c)) }
                .iter().map(|s| (s.off_base, s.lit_length, s.ml_base)).collect();
            let r_seqs = pair.r.sequences();
            if r_seqs != c_seqs {
                let i = r_seqs.iter().zip(&c_seqs).position(|(a, b)| a != b).unwrap_or(r_seqs.len().min(c_seqs.len()));
                panic!("{what}: sequence {i} differs: got {:?}, expected {:?} ({} vs {})", r_seqs.get(i), c_seqs.get(i), r_seqs.len(), c_seqs.len());
            }
            assert_eq!(got, expected, "{what}: last literals");
            assert_eq!(rep_r, rep_c, "{what}: rep");
            let c_lits = unsafe { std::slice::from_raw_parts(shim_lits(pair.c), shim_lit_len(pair.c)) };
            assert!(pair.r.literals() == c_lits, "{what}: literals");
            let long = unsafe { (shim_long_type(pair.c), shim_long_pos(pair.c)) };
            if long.0 != 0 || pair.r.long_length().0 != 0 { assert_eq!(pair.r.long_length(), long, "{what}: long length"); }
            pair.check_tables(&what);
            assert_eq!(pair.state().next_to_update, st.next_to_update);

            stats.blocks[si][st.dict_mode as usize] += 1;
            stats.seqs[si][st.dict_mode as usize] += c_seqs.len() as u64;
            if rng.chance(7, 8) { rep = rep_c; }
            pos += size;
        }
    }
    let _ = attached;
}

pub fn run(seed: u64, iters: u64) {
    let mut stats = Stats::default();
    for i in 0..iters {
        let s = seed.wrapping_mul(1_000_003).wrapping_add(i);
        if i % 2000 == 0 { eprintln!("stream iter {i} (seed {s})"); }
        if std::env::var("ONLY").is_ok_and(|o| o != s.to_string()) { continue; }
        CURRENT.store(s, std::sync::atomic::Ordering::Relaxed);
        one(&mut Rng(s), &mut stats);
    }
    println!("stream ok: {iters} iterations from seed {seed}");
    for (si, name) in ["fast", "dfast"].iter().enumerate() {
        println!("  {name}: blocks noDict/extDict/dictMatchState {:?}, sequences {:?}, fills CCtx-fast/CCtx-full/CDict-fast/CDict-full {:?}",
            stats.blocks[si], stats.seqs[si], stats.fills[si]);
    }
}

pub static CURRENT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// bench <file> <level>: the time both sides take to find the sequences of the file, in blocks of 128 KB, with the
/// parameters of the level (which has to be of the `fast` or `dfast` strategy), without and with an attached dictionary.
pub fn bench(path: &str, cp: [u32; 7]) {
    use std::time::{Duration, Instant};
    let all = std::fs::read(path).unwrap();
    for with_dms in [false, true] {
        let (dict, src) = if with_dms { all.split_at(100_000.min(all.len() / 2)) } else { all.split_at(0) };
        let mut cp = cp;
        if with_dms { cp[0] = 27; }
        let (mut best_c, mut best_r) = (Duration::MAX, Duration::MAX);
        let mut nb_seq = 0usize;
        for _ in 0..5 {
            let mut pair = Pair::new(cp, 128 << 10);
            let mut d = Pair::new(cp, 16);
            let mut dms_state = State::default();
            if with_dms {
                dms_state = d.load_dict(dict, true, true, false);
                unsafe { shim_attach(pair.c, d.c) };
            }
            unsafe { shim_update(pair.c, src.as_ptr().cast(), src.len()) };
            let (mut time_c, mut time_r) = (Duration::ZERO, Duration::ZERO);
            let (mut rep_c, mut rep_r) = ([1u32, 4, 8], [1u32, 4, 8]);
            nb_seq = 0;
            let mut pos = 0;
            while pos < src.len() {
                let size = (src.len() - pos).min(128 << 10);
                unsafe { shim_pre_block(pair.c, src.as_ptr().add(pos).cast(), size) };
                let st = pair.state();
                pair.sync(&st);
                let base = (st.base as usize).wrapping_sub(src.as_ptr() as usize);
                let dms = (st.dict_mode == 2).then(|| (&d.r, dict, (dms_state.base as usize).wrapping_sub(dict.as_ptr() as usize), (dms_state.next_src as usize).wrapping_sub(dict.as_ptr() as usize)));
                let t = Instant::now();
                let a = unsafe { shim_block(pair.c, rep_c.as_mut_ptr(), src.as_ptr().add(pos).cast(), size) };
                time_c += t.elapsed();
                let t = Instant::now();
                let b = pair.r.block(&mut rep_r, st.dict_mode, src, base, &[], 0, pos, pos + size, dms).unwrap();
                time_r += t.elapsed();
                assert_eq!(a, b);
                nb_seq += unsafe { shim_nb_seq(pair.c) };
                pos += size;
            }
            best_c = best_c.min(time_c);
            best_r = best_r.min(time_r);
        }
        let mbs = |d: Duration| src.len() as f64 / 1e6 / d.as_secs_f64();
        println!("cp {cp:?} dms {with_dms}: {} bytes, {nb_seq} sequences: C {:.0} MB/s, Rust {:.0} MB/s ({:.2}x the time)",
            src.len(), mbs(best_c), mbs(best_r), best_r.as_secs_f64() / best_c.as_secs_f64());
    }
}
