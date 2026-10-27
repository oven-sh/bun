# entropy encoders: status at 12:27 UTC, 2026-10-27

## Deliverables (finished, in their last tested state)
- `zstd/compress/hist.rs` (132 lines), `zstd/compress/fse.rs` (678), `zstd/compress/huf.rs` (1162)
- Test: `harness/src/entropy.rs`, `harness/entropy_shim.c` (the inline functions of fse.h), `harness/build.rs` (compiles the
  shim with clang-23), `harness/src/main.rs` (commands `entropy`, `entropy-bench`), wrappers at the end of `zstd/testing.rs`
  (`pub mod entropy`, `pub mod entropy_bench`; testing.rs also got `clippy::indexing_slicing` allowed and was rustfmt'ed).
- No other file of the crate differs from the real one (`common/bitstream.rs` was changed for an experiment and restored;
  `diff` with the real one is empty).

## Verified
- `cargo fmt --check`: ok. `cargo clippy`: the only finding in the three files is dead code
  (`FseRepeat::Check`/`Valid` never constructed). In the real crate, without testing.rs, most items will be dead code.
- Differential run on the final code, overflow checks and debug assertions on: seeds 100..105 x 90000 iterations, 6 processes,
  no failure. 172.9 M comparisons in all, of which 135 M are the cheap `fse_logs` ones. Per seed:
  hist 540000, fse_logs 22500000, fse 674465, fse_tables 2644542, fse_bad_norm 90000, huf_table 2171995, huf_read 90000,
  huf_repeat 110228. Logs: `harness/logs/entropy-10*.log`.
- Each comparison checks the return value (which error too), the whole destination buffer up to its capacity (not only the
  returned size), the tables (Huffman: all 257 words, from the same random or zero start; FSE: converted to the C layout),
  `repeat`, `maxSymbolValue`.
- Line coverage (an earlier build, 20000 iterations): every line reached but those listed under "not reached".

## How to run
```
. ~/.bun-dev-env && cd /root/zstd-ref/work/entropy/harness
RUSTFLAGS="--cap-lints=warn" cargo build --release
./target/release/zstd_harness entropy <seed> <iterations> [all|hist|fse_logs|fse|fse_tables|fse_bad_norm|huf_table|huf_read|huf_repeat]
ENTROPY_TRACE=1 ...   # prints the seed of each case
# speed, C against Rust. Its own target dir: the `bench` profile writes to target/release and would replace the checked build.
CARGO_TARGET_DIR=$PWD/target-bench RUSTFLAGS="--cap-lints=warn" cargo build --profile bench
./target-bench/release/zstd_harness entropy-bench
```

## Not reached by the tests (all are broken-invariant or unreachable paths)
- `normalize_m2`: `to_distribute == 0` (cannot happen once `min_table_log` has passed), `weight < 1` -> Generic, and my guard
  against an endless loop (`no norm > 0` -> Generic).
- `read_ctable`: `table_log > 12` (`huf_read_stats` refuses it first).
- `optimal_table_log`: `build_ctable` failing inside the search.

## Open
- Speed, not correctness (see the report): Huffman encoding 1.08-1.20x the C time (C without BMI2), histogram 1.08x,
  `build_ctable` 1.07-1.28x, `write_ctable` 1.25x, `write_ncount` 1.35x (50 ns), `FseCTable::build` 1.0x,
  three-state FSE encoding 1.34x, which falls to 1.20x with a 3-line change to `BitCStream::flush` in
  `common/bitstream.rs` (not my file): `let pos = self.pos.min(self.end);` write at `pos`, `self.pos = pos + nb_bytes;`.
  LLVM then drops the bounds check on the write. The same trick is in `HufCStream::flush_bits`.
- The last speed numbers for `build_ctable` and the Huffman encoder were measured on a machine under load (load average 17).
