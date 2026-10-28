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

The reference is built with `-ffp-contract=off`, and with `cref.patch`, which fixes an out of bounds write in the encoder
(memory corruption is not something safe Rust can imitate), two bugs that make streams which do not decode to the input
(`enc-far-dict`, fixed on upstream's master, and `enc-offset-dict`), and a call that is refused for no reason (`api`).

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
| `dec-gen <seed> <iterations> <evil>` | streams written bit by bit from the grammar of RFC 7932 (`grammar.rs`), with a model of the output. One prefix code in eight needs a table that takes all the room there is for it, or nearly. `evil`: one chance in this many, at each opportunity, to break a rule; 0 for valid streams only. `STATS=1` prints which rule gave which error |
| `dec-distances` | every value that the symbol of a simple distance code can be given, valid or not, for all 64 pairs of NPOSTFIX and NDIRECT, with and without a large window, which ends the alphabet where distances no longer fit. 152,704 streams of a literal and a copy, with extra bits that are all 0 or all 1. Prints how many gave which result |
| `dec-empty-commands` | 2^24 commands without output, which end in `_ERROR_FORMAT_BLOCK_SWITCH`: once for the commands, once for the distances. For the literals, `test/js/node/zlib/brotli-streams.test.ts` has a stream of 19 bytes |
| `dec-stream <seed> <iterations> <max length>` | `StreamingDecoder` against the loop around the C decoder that it replaced, without large windows |
| `enc-fuzz <seed> <iterations> <max length> <mask of qualities>` | random data, parameters, dictionaries and schedules |
| `enc-ring <seed> <iterations> <max length> <mask>` | lengths and pieces that end near the sizes of the ring buffer. Qualities 2 and up, which have one |
| `enc-hash <seed> <iterations> <max length> <mask>` | more than 65536 positions in one bucket of a hasher. Qualities 2 and up |
| `enc-tail <seed> <iterations> <mask>` | blocks that straddle the end of the ring buffer after a short first write: the byte after the end of the input is in the tail. In half of them a near match that beats a far one is only looked at if that byte followed it. Qualities 2 and up |
| `enc-marks <seed> <iterations> <mask> <position>...` | lengths, ends of pieces and flushes near the given positions, for thresholds inside the encoder |
| `enc-words <seed> <iterations> <max length> <mask>` | words of the static dictionary after each of the 121 transforms |
| `enc-every-word <mask> <all>` | all 13,504 words of the static dictionary, as they are, with the first letter in upper case and all in upper case, each an input of its own. If `all` is not 0: after each of the 121 transforms |
| `enc-lengths <seed> <iterations> <max length> <mask>` | runs of literals, copies and distances whose lengths are at the edges of the ranges of their codes |
| `enc-dict <seed> <iterations> <max length> <mask>` | compound dictionaries: long copies from them, copies that go on in the next dictionary or in the next block of input, more matches than a search has room for |
| `enc-far-dict <seed> <mask>` | 36 MiB with a window of 32 MiB: a copy from an attached dictionary, then what is as far back in the input as that copy's distance. Version 1.2.1 of the C encoder takes that for a match at the last distance at quality 4 (H55) |
| `enc-reach <seed> <mask>` | dictionaries of almost 64 MiB in all, so that distances get to the largest one that there is a code for, 2^26 - 4 and the number of direct codes: copies from the dictionaries at that distance and up to 2 more or less, and words of the static dictionary, which comes after them, that are the last within reach or next to it. Only words that the quality in question finds, which is tried first. Qualities 2 to 4 do not search attached dictionaries, 2 and 3 find no words. About 10 s for each quality, 1.1 GB of memory |
| `enc-offset-dict <seed> <iterations> <mask>` | a stream offset and a dictionary: a copy from the dictionary that ends with a block of input, and then what the dictionary has that many bytes earlier. The C encoder goes on with the copy. Qualities 5 and up |
| `enc-blocks <seed> <iterations> <max length> <mask>` | stretches of many different kinds: many blocks, block types and histograms to cluster |
| `enc-parts <seed> <iterations> <max length> <mask>` | a stream in parts, each by an encoder of its own with a stream offset, with dictionaries, and more input than the window holds. After a copy from a dictionary comes what could be taken for more of it. The whole has to decode. Also dictionaries that one encoder or decoder hands on to the next |
| `enc-dense <seed> <iterations> <mask>` | streams with flushes before the points at which the table of a hasher changes: 1 KiB at qualities 5 to 9, 16 and 32 KiB at 5 and 6. The start fills few, many or nearly all buckets, the rest is made of pieces of it, each found only if its bucket kept its block |
| `enc-rolling <seed> <iterations> <mask>` | the rolling hasher of large windows, qualities 3 to 9: flushed blocks of about 32 bytes that repeat chunks from so far back that only it knows them, at every alignment. One seed in 8 puts the block at the end of the ring buffer, 64 MiB in: 1,080 seeds have every combination of quality 3 to 5, 28 to 36 bytes before the end and 30 to 34 bytes |
| `enc-stitch <seed> <iterations> <mask>` | qualities 10 and 11: a copy from as far back as the window allows that is only found by way of the last positions of the block before, which the hasher adds when the next block is there |
| `enc-commands <seed> <iterations> <mask>` | qualities 5 to 9: all 704 command symbols in one meta-block of fewer than 1024 commands, which share a histogram, so that its code takes the largest tree there is. Every copy is from the last distance or the one before, which the encoder tries without its table. About 9 seeds in 10 get all 704: those fail if `MAX_HUFFMAN_TREE_SIZE` is one less |
| `enc-utf8 <seed> <iterations> <mask>` | qualities 10 and 11 write to the stream whether more than three quarters of a meta-block are UTF-8. The input is the first or the last character of a length, or what is just not a character, again and again, or it is UTF-8 to about three quarters. In one input in eight a flush cuts a character, the ring buffer still holds the rest of it from a lap before, and with it more than three quarters would be UTF-8; or exactly three quarters are, and a letter from a lap before comes after the end |
| `enc-chain <seed> <iterations> <mask>` | qualities 5 to 9 with windows of up to 64 KiB, whose hashers keep chains of positions in banks of slots. The one long match is the last node that the search looks at, or the one before or after it; records that all start with keys from one bank, so that slots are taken over while chains still lead to them; a match as far back as the window allows; a match that is only found if a node keeps the low 16 bits of a distance of 65536 or more, instead of ending the chain; few different bytes. A third of the inputs start with more positions than a bank has slots, a fifth have dictionaries |
| `enc-merge <mask>` | whether a meta-block ends with a block of input: the numbers of literals and of commands go past their limits in steps of one |
| `race <seed> <iterations> <max length> <mask>` | Rust only: another thread changes the input while the encoder or the decoder reads it, as JavaScript can. No panic, no hang, no error that stands for a bug. Best in a debug build. A failure cannot be repeated by its seed |
| `enc-flint <mask>` | the start of a stream with an offset: every combination of three operations with little input and little room for output. None may be refused, and the stream has to decode |
| `enc-states <seed> <iterations> <mask>` | calls in any order, with any amount of input and room, whether or not the call before was completed or refused |
| `enc-select <seed> <length>` | every quality with every window size and size hints on both sides of 1 MiB: all that decides which hasher is used |
| `enc-big <seed> <bytes> <param>=<value>...` | one long stream, through both decoders too. The position wraps at 3 GiB and then every 2 GiB. Around every other GiB (the odd ones for an odd seed) each piece of the input repeats what came one of two distances before it, but for one byte. After the wrap the hasher has forgotten that, so the copies depend on the last distances: the same distance as for the piece before is the newest of them, the other one the second. Around the other GiBs, with a window of 16 to 20 bits, some pieces end with a flush and depend on the byte after the end of the input as in `enc-tail`: the ring buffer's counter wraps at 2 GiB, and qualities 2 to 4 see whether it still knows that this is not the first lap. So an odd seed has both |
| `enc-lap <seed> <bytes> <param>=<value>...` | random data with a period of 2 GiB, for a window of more than 24 bits (`2=25 6=1`). The C encoder writes a stream that decodes to something else: its rolling hasher finds the current position in its table, left there by the lap before, and takes it for a match at distance 0. Only Rust's stream has to be right |
| `enc-files <mask> <lgwin>`, `enc-one <file> <param>=<value>...` | files |
| `api <seed> <iterations>` | values out of range, calls at the wrong time, metadata and dictionaries of every size, dictionaries of 2 GiB in all for the decoder and for the encoder, and a copy that goes past their end (Rust only: the reference does not check the sum, and crashes on that copy), more than 1 GiB and more than 2 GiB in one call: always the same cases, which take 3.5 GB of memory. The seed and the iterations are for `SpareCapacity` |
| `oom <seed> <iterations> <max length>` | fails each allocation in turn, or 150 of them if there are more, in the encoder, the decoder and `StreamingDecoder`. An allocation that cannot fail is reported with its source line. A quarter of the cases flush after every piece. One seed in 16 takes no notice of `<max length>`: at quality 5 or 6, 900 bytes, a flush, then 36,000 bytes at once |
| `oom-sites` | the first and the last allocation of every line of the crate that allocates fail, in 84 streams that between them get to all parts of the codec. `oom` picks at random, and seldom an allocation that happens once in thousands. Prints the lines |
| `oom-cold` | the same for the first call in a process, which builds the tables that later calls share; a process for each allocation |
| `gen-corpus <dir> <n>`, `replay-dec <dir>` | seeds for the libFuzzer targets; runs a `fuzz_dec` corpus (for coverage) |
| `bench-dec` / `bench-enc <file> <quality> <lgwin> <repetitions>`, `bench-small <file> <length> <quality> <lgwin> <repetitions>`, `bench-first <file> <length> <quality>` | speed, see below. `ONLY=c` or `ONLY=rust` leaves the other one out of `bench-dec` and `bench-enc`. `bench-first` measures Rust, or C with `ONLY=c` |
| `mem-scan <mask> <max length>` | how much memory the two allocate: most at a time, what a stream holds before its last call, and how many allocations, over a grid of qualities, windows, lengths, kinds of data and ways of calling. A block that grows counts twice while it does |
| `perf-scan <seed> <iterations> <max length>` | looks for inputs and ways of calling for which Rust is much slower than C. `ALL=1` prints every case |
| `stack` | the smallest thread stack with which each quality works |

## Uninitialised memory in the reference

Below quality 5, when a match runs to the end of the input that is there, the search at the next position looks at the byte
after it. Right after the first lap of the ring buffer, and after a first write shorter than a block, that byte can be one
that the reference never wrote, so what it puts out depends on what `malloc` returned. The harness gives the reference zeroed
memory, which is what the Rust encoder behaves like, except for measurements and in `BrotliEncoderCompress`, which takes no
allocator. `C_FILL=165` fills new memory with that byte instead:
`C_FILL=165 harness enc-tail 18 1 28` shows the difference.

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
what the tail of the ring buffer holds after the first lap matters, but only `enc-tail` sees it, and which byte it is only
where a match depends on nothing else; lengths exactly at the edge
of a code's range need `enc-lengths`; most of the search in the static dictionary needs `enc-words`; a copy from a compound
dictionary is only taken up again in the next block in `enc-dict`; the queue of pairs of histograms only fills up with more
than 8000 blocks (`enc-blocks`); that a chain of the hashers of small windows ends at a gap of 65536 positions or more is
only seen where the hasher left out a position, in a long stretch of literals (`enc-chain`); the largest distance with a
code takes 64 MiB of dictionaries, and the encoder has stopped looking for words by then unless it kept finding some
(`enc-reach`); random prefix codes never need the largest table, so one that is an entry too small goes unnoticed
(`dec-gen` has such codes now); real text does not tell where exactly a character stops being UTF-8 (`enc-utf8`); no file or
random input has more than two thirds of the command symbols in one histogram (`enc-commands`). A change
that survives a few hundred iterations of `enc-fuzz` is not thereby harmless.
