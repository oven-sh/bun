# fast / dfast port: status (12:27 UTC)

## Deliverable
- `/root/zstd-ref/work/fast/zstd/compress/fast.rs`
- `/root/zstd-ref/work/fast/zstd/compress/double_fast.rs`

Complete, `cargo fmt --check` clean, no clippy finding in either file. `double_fast.rs` uses four `pub(super)` helpers
of `fast.rs` (`FAST_HASH_FILL_STEP`, `Located`, `count_backwards`, `restore_rep`): take both files together.

## IMPORTANT: the copy of double_fast.rs in the real repo is a deliberately broken mutant
The copy taken into `/root/repos/oven-sh/bun/src/zstd/compress/double_fast.rs` was taken while my mutation test was
rewriting the file in place. It has `match_index_s >= prefix_lowest_index` (line 423) where the right code, as in C, is
`match_index_s > prefix_lowest_index`. That is the dfast + attached CDict mismatch of the end-to-end test. Copy both
files again from the paths above. (`fast.rs` in the repo only differs by `let buf = src.buf;`, see below.)

## Verified against C (all pass)
Harness: `cd /root/zstd-ref/work/fast/harness && RUSTFLAGS="--cap-lints=warn" cargo build --release`
(NOT `--profile bench`, which writes the same `target/release` without overflow checks).
- `zstd_harness seqs <seed> <iters> 1,2 <0|1>`: template test, fixed (several blocks, param ids, rep[2], short last
  block). 330,000 iterations for each of dict 0 and 1 on the first version, and 320,000 each on the final files.
- `zstd_harness stream <seed> <iters>`: mine (`c/shim.c`, `src/stream.rs`, `TestMs` in `zstd/testing.rs`). Calls the C
  functions directly on hand-made `ZSTD_MatchState_t`: all 6 block compressors and both fill functions with all 4
  (purpose, load method) pairs; attached dictionaries (dictMatchState), loaded dictionaries (contiguous or not), chunks
  that are contiguous / elsewhere / overwrite the same buffer (ring buffer), blocks of any size from 1 byte, start
  indices up to 3.6e9, repeat offsets at the limits. After every call compares sequences, literals, rep, return value,
  long length and both tables. 220,000+ iterations on the final files (about 80,000 dictMatchState blocks per strategy).
- `zstd_harness frames <seed> <iters> 1,2 <0|1|2>`: copy of the harness of work/lazy (real CDict machinery).
  100,000 iterations of mode 2, 40,000 of mode 1.
- Line coverage of the two files by `stream`: everything but the 4 `end < 8` early returns of the fill functions.
- 45 hand-made mutants (boundary conditions in every function): all caught by `stream`.

## Open
- Speed (bench profile, 23 MB of Rust source, `zstd_harness bench <file> <cp,...>`): Rust takes 1.4x (level 1), 1.27x
  (level 2), 1.2x (levels 3, 4) the time of C; dictMatchState 1.15-1.35x. See the hand-back for where the time goes.
- Nothing open for correctness.
