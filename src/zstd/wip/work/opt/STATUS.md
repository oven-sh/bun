# opt (zstd_opt.c -> compress/opt.rs): status at 12:30 UTC

Deliverable: /root/zstd-ref/work/opt/zstd/compress/opt.rs. Complete port, public API of the stub unchanged.
No clippy finding in opt.rs, rustfmt clean (the fmt diffs of `cargo fmt --check` are all in the scratch-only testing.rs).

## Verified against C (no difference found in any run of the final code)
Harness = zstd-lazy's fixed one, extended. Whole frames (several blocks, up to 400 KB), strategies 7,8,9. Compared: all
sequences, and after the frame hashTable, chainTable, hashTable3, window limits, nextToUpdate, rep, the 4 frequency
tables and the 8 sums / base prices of optState_t.
- Long runs, 100,000 iterations each, still running when this was written, no failure so far. Last progress lines:
  seqs iter 84000 (seed 101084303);seqs iter 82000 (seed 102082306);seqs iter 84000 (seed 201084603);seqs iter 82000 (seed 202082606);seqs iter 88000 (seed 301088903);
  (r0a, r0b: no dict; r1a, r1b: none/prefix = extDict; r2a: attached CDict = dictMatchState). Logs: runs/*.log
- Finished runs: modes 0, 1, 2: 3000 + 1000 + 800 + 1500 iterations each.
- "x" mode (shim_frame2 in harness/shim.c: block-level API, exact unadjusted cParams incl. targetLength 0, random LDM
  rawSeqs through ZSTD_referenceExternalSequences, poked dictionary entropy tables with HUF_repeat_valid,
  literalCompressionMode 0/1/2, input in two non-contiguous chunks, none/prefix/attached CDict):
  3000 + 3000 + 800 + 1500 iterations, about 2/3 with LDM sequences and 1/2 with entropy tables.
- Line + branch coverage of opt.rs under those runs: every line is hit but the ones listed below.

## Not covered by any test
- zop_predef prices (3 early returns): cannot be reached, a first block of <= 8 bytes never enters the match loop.
- raw_literals_cost with 0 literals: never called so.
- lit_length_price(ZSTD_BLOCKSIZE_MAX): reachable (128 KB block without a sequence whose last 9+ bytes match). A data
  kind for it was added to seqs.rs (noise + copied tail) but did not hit it in 6000 iterations.
- `inr < iend` false, `nb_matches < ZSTD_OPT_NUM` false, and btultra2's 2nd to 4th conditions false.
- Index overflow correction, windows > 22 bits.

## How to run
cd harness && RUSTFLAGS="--cap-lints=warn" cargo build --release
./target/release/zstd_harness seqs <seed> <iters> 7,8,9 <0|1|2|3> [x]
  0 no dict, 1 none/prefix, 2 attached CDict, 3 all three; x = shim_frame2 extras
ZSTD_REF=asserts|trace picks a C lib built by cbuild/build.sh (asserts on / DEBUGLEVEL 8 in zstd_opt.c).

## Notes for the integrator
- btultra2 (ZSTD_initStats_ultra) moves ms.window.base: BlockSrc.base must be derived from ms.window again for each block.
- The template seqs.rs sets cParams by 101+i, which swaps chainLog and hashLog (ids are windowLog, hashLog, chainLog).
  The fixed harness is immune because it reads the applied cParams back from C.
- MAX_LIT (255) is missing from common/mod.rs: private const in opt.rs.
