# lazy (zstd_lazy.c -> compress/lazy.rs): status

## Deliverable
`/root/zstd-ref/work/lazy/zstd/compress/lazy.rs` (same file saved as `/root/zstd-ref/work/lazy/lazy.v2.rs`).
Needs `#![feature(hint_prefetch)]` in lib.rs (safe `core::hint::prefetch_read`). `cargo fmt --check` ok, `cargo clippy`: no
finding in lazy.rs. Public API of the stub unchanged, plus `pub(crate) const ZSTD_ROW_HASH_TAG_BITS` (from zstd_lazy.h; params/cctx
need it for `maxRowHashLog`). Private `prefetch_l1` at the top of the file, to be moved to util.rs.
`lazy.v1.rs` = the same without any prefetch (builds without the feature).

## Structure
- `ZSTD_compressBlock_lazy_generic` and `..._extDict_generic` are ONE fn `compress_block_lazy_generic<SEARCH_METHOD, DEPTH, DICT_MODE>`
  (`#[inline(never)]`, 21 instances). The only differences in C are kept: the initial `ip += ...`, the saved rep offsets (noDict) and the
  lazy-skipping threshold (`step > 8` with step one less in extDict).
- The 4 copies of the repcode check are `rep_length<DICT_MODE>` (0 = no match). `DictSegment` = what an index below dictLimit leads to
  (older segment, or the dms with `base - dictIndexDelta`).
- Search fns are `#[inline(never)]` const-generic: `hc_find_best_match<MLS, DICT>`, `bt_find_best_match<MLS, DICT>`,
  `row_find_best_match<MLS, ROW_ENTRIES, DICT>`; `search_max` switches on mls/rowLog at each call as C does.
- `dummy32` is done by aliasing the two slots (`smaller_ptr = larger_ptr`) so the final clear writes only the other one.
- If `iend < 8` (or 16 with rows) as a position in the buffer, `ilimit` would be negative: early return (no search, no hashing, rep unchanged).

## Tests (all against C, sequences AND final match state)
Harness: `/root/zstd-ref/work/lazy/harness` (+ `shim.c`, reads cctx internals), driver `/root/zstd-ref/work/lazy/zstd/testing.rs` (`frame`).
Scratch-only: `zstd/compress/opt.rs::update_tree` is a throw-away noDict port, only to load dictionaries for btlazy2.
    cd /root/zstd-ref/work/lazy/harness && RUSTFLAGS="--cap-lints=warn" cargo build --release
    ./target/release/zstd_harness seqs <seed> <iters> 3,4,5,6 <mode>
mode 0 no dict, 1 prefix (extDict), 2 attached CDict (dictMatchState), 3 through ZSTD_compressStream2's wrapping input buffer
(extDict with dict_buf == buf), mixed with none/prefix/CDict. Frames are multi-block (up to 400 KB, windowLog 10..22).
Compared after each frame: every sequence (ll, ml, repcode/offset), hash/chain/tag tables, hashCache, nextToUpdate, hashSaltEntropy,
lazySkipping, lowLimit, dictLimit, loadedDictEnd, rep, whether the dms is still attached.
    ./target/release/zstd_harness bench <file> <0|1|2>     (build with --profile bench for real numbers)

## Verified (no mismatch, no error, no overflow panic; harness has overflow checks + debug assertions on)
- First version (no prefetch, plain mask loop), complete runs: mode 0: 320,000 frames; mode 1: 320,000; mode 2: 320,000 (134,306 with a CDict attached).
- Final file (prefetch, mask by chunks of 16), runs stopped by a time limit, not by a failure (logs/final_*.log): mode 0: >=152,000; mode 1: >=140,000;
  mode 2: >=306,000 (2 seeds); mode 3: >=284,000 (2 seeds). Plus 3,000 to 8,000 of each mode on other seeds.
- Line coverage (llvm-cov) over modes 0-3: every line of lazy.rs is hit except `?` error paths, `_ => Err(BUG)` and the never-false `off_base != 0`.
  `insert_dubt1` with `curr < dict_limit` and the extDict "offset beyond the window" test are only reached by mode 3.

## Not tested
- Index overflow correction (ZSTD_window_correctOverflow / reduceIndex, DUBT mark preservation): not in this file, not exercised.
- Reusing a context for several frames (hash salt != first value, stale tag table). hashSaltEntropy is compared, the salted second frame is not run.
- CDict copied rather than attached; ldm + lazy (`ZSTD_ldm_blockCompress` calling these); aarch64 only inspected as asm, not run.

## Speed (7 MB of source text, sequences only, Rust as % of C; logs/bench0.txt)
greedy HC 115, greedy row 108, lazy HC 96, lazy row 88, lazy2 HC 100, lazy2 row L10 77-82, L12 75-78, btlazy2 97-98.
Without prefetch the row finder was 97/78/62/59.
Open: the rest of the row gap. Known causes seen in the asm of `row_find_best_match`:
1. the first 16 tag bytes are assembled from pieces (byte 0 is also loaded as the scalar `head` in an earlier block, and SLP reuses it) instead of
   one movdqu: about 15 extra shuffles per search, on aarch64 too. In isolation the fn compiles to movdqu+pcmpeqb+pmovmskb.
   Tried without success: `.max(1)` on nb_attempts; loading the chunk as u128 (slower).
2. `match_buffer` is zeroed on each call (64 to 256 bytes); 3. two bounds checks per 4-byte read in the candidate loop (`read_le32(ip + ml - 3)` could
   be kept in a variable that changes with `ml`); 4. the rare "skip > 384 positions" path is inlined and costs registers (could be `#[cold]`).
Tried and rejected: prefetch emulated by real loads (`black_box`: +5% at best; early filtering load of the candidates' first 4 bytes: slower).
