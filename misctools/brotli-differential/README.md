# Differential tests of `bun_brotli` against the C library

Drives `src/brotli` and google/brotli v1.2.1 in lock step, in one process, and compares every call: return value, input
consumed, output produced, the bytes, `has_more_output`, the encoder's `is_finished`, the decoder's error code.

```sh
git init brotli-ref && git -C brotli-ref remote add origin https://github.com/google/brotli
git -C brotli-ref fetch --depth 1 origin db24a98aed38a16de78cc05ca15cdd8dc2a0d92d && git -C brotli-ref checkout FETCH_HEAD
CC=clang AR=llvm-ar ./build-cref.sh       # builds cref/libbrotliref.a
RUSTFLAGS=--cap-lints=warn cargo build    # overflow checks and debug assertions on; add --release for speed
target/debug/harness enc-fuzz 1 1000 4194304 4095
```

The reference is built with `-ffp-contract=off`, and with `cref.patch`, which fixes an out of bounds write in the encoder:
memory corruption is not something safe Rust can imitate.

Every iteration is derived from its seed, so `<subcommand> <seed> 1 ...` reproduces a failure, as long as the files that some
of the data is taken from are the same: brotli's test data and sources, `src/js/node` and `docs/runtime` of this repository.
`TRACE=1` prints every encoder call. Failing inputs are saved in the temporary directory.

Numbers are decimal, or hexadecimal after `0x`. Trailing arguments can be left out. A mask of qualities has bit `q` set for
quality `q`: `0xFFF` for all of them.

| subcommand | what it does |
| --- | --- |
| `testdata` | the streams of brotli's own test data |
| `dec-fuzz <seed> <iterations> <max length>` | streams of the C encoder: intact, then damaged |
| `dec-garbage <seed> <iterations>` | random bytes |
| `dec-gen <seed> <iterations> <evil>` | streams written bit by bit from the grammar of RFC 7932 (`grammar.rs`), with a model of the output. `evil`: one chance in this many, at each opportunity, to break a rule; 0 for valid streams only. `STATS=1` prints which rule gave which error |
| `dec-empty-commands` | 2^24 commands without output, the only way to `_ERROR_FORMAT_BLOCK_SWITCH` |
| `dec-stream <seed> <iterations> <max length>` | `StreamingDecoder` against the loop around the C decoder that it replaced |
| `enc-fuzz <seed> <iterations> <max length> <mask of qualities>` | random data, parameters, dictionaries and schedules |
| `enc-ring <seed> <iterations> <max length> <mask>` | lengths and pieces that end near the sizes of the ring buffer. Qualities 2 and up, which have one |
| `enc-hash <seed> <iterations> <max length> <mask>` | more than 65536 positions in one bucket of a hasher. Qualities 2 and up |
| `enc-tail <seed> <iterations> <mask>` | blocks that straddle the end of the ring buffer after a short first write: the byte after the end of the input is in the tail. Qualities 2 and up |
| `enc-marks <seed> <iterations> <mask> <position>...` | lengths, ends of pieces and flushes near the given positions, for thresholds inside the encoder |
| `enc-words <seed> <iterations> <max length> <mask>` | words of the static dictionary after each of the 121 transforms |
| `enc-lengths <seed> <iterations> <max length> <mask>` | runs of literals, copies and distances whose lengths are at the edges of the ranges of their codes |
| `enc-big <seed> <bytes> <param>=<value>...` | one long stream, through both decoders too. The position wraps at 3 GiB and then every 2 GiB |
| `enc-files <mask> <lgwin>`, `enc-one <file> <param>=<value>...` | files |
| `api <seed> <iterations>` | values out of range, calls at the wrong time, metadata and dictionaries of every size, an input of more than 1 GiB: always the same cases, which take 2.5 GB of memory. The seed and the iterations are for `SpareCapacity` |
| `oom <seed> <iterations> <max length>` | fails each allocation in turn, or 150 of them if there are more. An allocation that cannot fail is reported with its source line |
| `oom-cold` | the same for the first call in a process, which builds the tables that later calls share; a process for each allocation |
| `gen-corpus <dir> <n>`, `replay-dec <dir>` | seeds for the libFuzzer targets; runs a `fuzz_dec` corpus (for coverage) |
| `bench-dec` / `bench-enc <file> <quality> <lgwin> <repetitions>`, `bench-small <file> <length> <quality> <lgwin> <repetitions>`, `bench-first <file> <length> <quality>` | speed, see below. `ONLY=c` or `ONLY=rust` leaves the other one out of `bench-dec` and `bench-enc`. `bench-first` measures Rust, or C with `ONLY=c` |
| `perf-scan <seed> <iterations> <max length>` | looks for inputs and ways of calling for which Rust is much slower than C. `ALL=1` prints every case |
| `stack` | the smallest thread stack with which each quality works |

## Uninitialised memory in the reference

Below quality 5, when a match runs to the end of the input that is there, the search at the next position looks at the byte
after it. Right after the first lap of the ring buffer, and after a first write shorter than a block, that byte can be one
that the reference never wrote, so what it puts out depends on what `malloc` returned. The harness gives the reference zeroed
memory, which is what the Rust encoder behaves like, except for measurements and in `BrotliEncoderCompress`, which takes no
allocator. `C_FILL=165` fills new memory with that byte instead:
`C_FILL=165 harness enc-tail 5 1 28` shows the difference.

## Speed

The build above favours Rust. For a fair comparison both sides need the flags that Bun is built with, on x64:

```sh
OUT=$PWD/cref-bench CFLAGS="-O3 -march=nehalem" CC=clang AR=llvm-ar ./build-cref.sh
BROTLI_CREF=$PWD/cref-bench RUSTFLAGS="--cap-lints=warn -Ctarget-cpu=nehalem" cargo build --release
```

## libFuzzer

`fuzz_dec` and `fuzz_enc` use the same comparisons as the oracle, with coverage feedback from both libraries:

```sh
OUT=$PWD/cref-fuzz CFLAGS="-O2 -fsanitize=fuzzer-no-link" CC=clang AR=llvm-ar ./build-cref.sh
BROTLI_CREF=$PWD/cref-fuzz RUSTFLAGS="--cap-lints=warn -Cpasses=sancov-module -Cllvm-args=-sanitizer-coverage-level=4 \
  -Cllvm-args=-sanitizer-coverage-inline-8bit-counters -Cllvm-args=-sanitizer-coverage-pc-table \
  -Cllvm-args=-sanitizer-coverage-trace-compares -Ccodegen-units=1 -Cdebug-assertions=on -Coverflow-checks=on" \
  cargo build --release --target x86_64-unknown-linux-gnu --features libfuzzer --bin fuzz_dec --bin fuzz_enc
target/debug/harness gen-corpus seeds 3000
target/x86_64-unknown-linux-gnu/release/fuzz_dec -fork=8 -ignore_crashes=1 -max_len=16384 corpus-dec seeds/dec
target/x86_64-unknown-linux-gnu/release/fuzz_enc -fork=8 -ignore_crashes=1 -max_len=4096 corpus-enc seeds/enc
```

`--target` keeps the flags away from build scripts.

## Do the tests see anything?

Break `src/brotli` on purpose in a copy and see which subcommand notices. What was learned that way: long runs and short
periods do not fill a bucket of a hasher (`enc-hash` does); a hasher is only prepared a second time after 3 GiB (`enc-big`);
what the tail of the ring buffer holds after the first lap matters, but only `enc-tail` sees it; lengths exactly at the edge
of a code's range need `enc-lengths`; most of the search in the static dictionary needs `enc-words`. A change that survives a
few hundred iterations of `enc-fuzz` is not thereby harmless.
