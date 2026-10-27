# Decoding HPACK's Huffman code with SIMD

The kernel is `src/jsc/bindings/highway_hpack.cpp`, its safe wrapper is
`bun_highway::hpack_huffman_decode_short`, and its only caller is `huffman.rs` in this directory.

## The problem

A Huffman decoder is a chain: where a code starts depends on how long the one before it was.
`huffman.rs` walks that chain with one table lookup per two codes, and each lookup has to wait for
the one before it. The time goes into waiting, about 9 cycles per lookup.

## The idea

Take the lookups off the chain by doing them for every place a code could start.

1. Take 64 bits of input and look at all 64 bit offsets at once, as if a code started at each.
   `vpmultishiftqb` yields the 8 bits from every offset on. That is enough to tell the length and
   the symbol of a code of up to 8 bits: all of `[0-9A-Za-z]` and ` %&*,-./:;=_` and the space,
   98.6% of the bytes in the header corpus of http2jp/hpack-test-case.
2. `jump[offset] = offset + length` is where the next code starts. Applying that table to itself
   (`vpermb`) gives the tables for 2, 4, 8 and 16 codes ahead. None of this depends on where the
   first code starts, so the blocks of a long string are worked out side by side.
3. Lane `i` of `starts` is `i` jumps from the first code: each jump table is applied to the lanes
   that have its bit set in `i`. The symbols at those offsets are the output, 12 at most.

Between one block and the next, the chain is a shift and a mask: byte `first` of the 16-jump table.

## Where a walk stops

Offsets 56 to 63 jump to themselves. That keeps a jump table at 64 entries, one `vpermb`, and a walk
that leaves the first 56 bits stops at the offset where it left. A block is therefore 7 bytes.

An offset where no short code starts also jumps to itself: a longer code, or the padding. The walk
stops there, and so does the kernel.

## What the kernel does not do

It reports no errors. It stops before a code of more than 8 bits, before the padding, before a code
that the input ends in the middle of, and when the output has no room for a block (16 bytes, of
which it may fill fewer: the rest is overwritten with whatever the shuffle left there). `huffman.rs`
goes on from the bit it stopped at: it decodes the long code and tries the kernel again, or checks
the padding. So what is accepted, what is refused and with which error does not depend on the CPU.

## When it is called

A call costs about 15 ns before the first symbol, which pays off from about a dozen symbols on.
`huffman.rs` does not call it

- for under 5 bytes of input,
- where a code of more than 8 bits comes next,
- once its calls on this string have yielded under 12 symbols on average, which is what happens in
  text that is dense in such codes, like JSON.

That leaves one call wasted on such text.

## Which CPUs

AVX-512 VBMI: Intel from Ice Lake on (not Alder Lake and later desktop parts), AMD from Zen 4 on.
Highway's targets `AVX3_DL`, `AVX3_ZEN4`, `AVX3_SPR` and `AVX10_2`. Elsewhere the kernel is a stub
and is not called.

Without a 64-entry byte shuffle, one jump table costs more than the lookups it replaces: 4 `pshufb`
and as many blends per 16 lanes. NEON has that shuffle (`TBL`/`TBX` with four registers), which
Highway has no operation for. It has not been tried.

## Numbers

Xeon (Sapphire Rapids) at 2.1 GHz, compiled like a release build (`-march=nehalem`, LTO). One field
with a name from the static table and a Huffman coded value, 512 different values per row, in ns.
"Before" is the decoder this replaced: 32 bits at a time, the same 13-bit table, long codes bit by
bit.

| value                                    | before | scalar | kernel |
| ---------------------------------------- | ------ | ------ | ------ |
| 4 characters with codes of up to 8 bits  | 44     | 40     | 40     |
| 8                                        | 54     | 50     | 36     |
| 16                                       | 76     | 68     | 41     |
| 32                                       | 130    | 114    | 58     |
| 100                                      | 369    | 307    | 127    |
| 1000                                     | 3789   | 2852   | 1034   |
| 65, 1 in 40 with a code of 10 to 19 bits | 250    | 205    | 144    |
| 65, 1 in 10                              | 287    | 214    | 212    |
| 65, 1 in 2                               | 492    | 370    | 385    |
| 200, all with codes of 14 bits           | 826    | 820    | 826    |
| 200, all with codes of 28 bits           | 4452   | 1879   | 1955   |
| 30 bytes from 0x80 up                    | 1202   | 509    | 516    |
| `gzip, deflate, br`                      | 64     | 52     | 40     |
| `{"a":1,"b":[true,null],"c":"x"}`        | 131    | 122    | 131    |
| the values in http2jp/hpack-test-case    | 108    | 92     | 65     |

With cold caches the kernel is further ahead. Prototypes of both, 8 strings at a time with 1 MB
touched in between: 299 cycles a string against 155. With 8 MB: 842 against 317. The scalar decoder's
table is 32 KB, the kernel's tables are 448 bytes.

## What else was tried

On the 10,654 strings that hpack-test-case sends as literals, 26 bytes on average, per string,
against the scalar code of the time.

| what                                                   | result                     |
| ------------------------------------------------------ | -------------------------- |
| encoded length, `pshufb` rows (SSE4)                   | 20 ns against 12.5: slower |
| encoded length, `vpermi2b` (AVX-512 VBMI)              | 5.3 ns against 12.5        |
| encoder, `pshufb` rows, lanes merged to 32 bits (SSE4) | 55 ns against 54           |
| encoder, the same with 64-bit lanes (AVX2)             | 45 ns                      |
| encoder, `vpermi2b`, 64-bit lanes (AVX-512 VBMI)       | 38 ns                      |
| encoder, scalar, one pass, four codes per write        | 40.5 ns: what is used now  |
| the whole crate compiled for AVX-512                   | no change either way       |
| wyhash replaced by one multiplication                  | no change                  |
| calling the kernel unless 7 ones in a row come up      | `p,` has 7 ones in a row   |

The encoder's codes have to be joined bit by bit whatever finds them, and header strings are too
short for the lookups to matter.
