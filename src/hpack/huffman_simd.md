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
   99.2% of the bytes of the header values in the corpus of http2jp/hpack-test-case.
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

That leaves one call wasted on such text. It shows most on a short string: 5 to 8 bytes that start
with a short code and go on with codes of 10 to 13 bits take 40 to 53 ns instead of 30 to 41.

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
| 4 characters with codes of up to 8 bits  | 45     | 38     | 38     |
| 8                                        | 56     | 51     | 36     |
| 16                                       | 89     | 63     | 41     |
| 32                                       | 139    | 104    | 58     |
| 100                                      | 385    | 274    | 126    |
| 1000                                     | 3706   | 2480   | 1037   |
| 65, 1 in 40 with a code of 10 to 19 bits | 261    | 194    | 144    |
| 65, 1 in 10                              | 293    | 208    | 217    |
| 65, 1 in 2                               | 474    | 307    | 325    |
| 200, all with codes of 14 bits           | 824    | 725    | 736    |
| 200, all with codes of 28 bits           | 4419   | 1790   | 1824   |
| 30 bytes from 0x80 up                    | 1175   | 491    | 491    |
| `gzip, deflate, br`                      | 62     | 46     | 39     |
| `{"a":1,"b":[true,null],"c":"x"}`        | 131    | 107    | 119    |
| the values in http2jp/hpack-test-case    | 109    | 85     | 65     |

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
| encoder, scalar, one pass, four codes per write        | 40.5 ns, see below         |
| the whole crate compiled for AVX-512                   | no change either way       |
| wyhash replaced by one multiplication                  | no change                  |
| calling the kernel unless 7 ones in a row come up      | `p,` has 7 ones in a row   |

The encoder's codes have to be joined bit by bit whatever finds them, and header strings are too
short for the lookups to matter.

The scalar one-pass encoder was in the crate for a day and was taken out again. It starts coding
before it knows whether the code will be shorter than the text. On Sapphire Rapids it made the
corpus 22% faster. On Cascade Lake the corpus took as long as before. On both, a string that is
sent as it is took 1.3 to 2 times as long, and one of 1 to 3 bytes 1.1 to 1.3 times.

The scalar decoder's loop writes a short code and a long code in two places. With one `write` after
the `if` for both, the compiler loads the four bytes of a table entry one by one and puts the two
symbols together again: 23 instructions a lookup instead of 17. Sapphire Rapids hides most of that.
On Cascade Lake text took 10 to 25% longer.

## The coder

No SIMD here, but the same problem: where a code goes depends on the lengths of all the codes before
it. `encode` takes one byte at a time and writes 32 bits whenever it has that many. Whether it has
depends on the text, so that branch is mispredicted, and without BMI2, which no x64 build of Bun
assumes, each code costs a shift by a variable count: three micro-operations on Intel up to Ice Lake.

From 64 bytes on, `encode_groups` takes 7 bytes at a time.

1. Neighbours are joined by a multiplication: `code(a) * (1 << len(b)) + code(b)`. `1 << len` comes
   from `SHIFTS`, 1 KB, the only table this adds.
2. The pairs are joined by shifts, by lengths that are added up on the side.
3. 8 bytes are written, of which as many count as are full. No branch depends on the text.

7 codes of 8 bits, the longest in plain text, and the 7 bits that may be left from the group before
are 63 bits. A group of more than 57 bits is written in two halves, of 4 and 3 bytes, if each has
57 bits at most: `{"a":1,` has 60, and one group in three of random printable characters has too
many. Otherwise, which takes bytes that are not ASCII or several `\`, it is written byte by byte.

The length is still counted in a pass of its own, so a string that is sent as it is costs what it
did. Under 64 bytes nothing changes but for one comparison.

`Encoder::encode` of one field with a name from the static table and a value that is not in the
dynamic table, in ns. "Before" is the loop alone, "C" is ls-hpack 2.3.5 with its table of 65,536
pairs, which is what Bun used before this crate.

|                               | Cascade Lake |      |      | Emerald Rapids |      |      |
| ----------------------------- | ------------ | ---- | ---- | -------------- | ---- | ---- |
| value                         | before       | now  | C    | before         | now  | C    |
| 64 characters of up to 8 bits | 197          | 134  | 180  | 123            | 86   | 132  |
| 100                           | 283          | 187  | 222  | 184            | 128  | 162  |
| 200                           | 502          | 313  | 351  | 333            | 215  | 250  |
| 500                           | 1179         | 709  | 698  | 766            | 473  | 514  |
| 1000                          | 2361         | 1336 | 1287 | 1500           | 926  | 998  |
| 4000                          | 9213         | 5118 | 4924 | 5916           | 3553 | 3530 |
| 300, 1 in 20 of 10 to 15 bits | 780          | 440  | 467  | 538            | 314  | 377  |
| 1000 printable, at random     | 3292         | 2039 | 2011 | 2383           | 1480 | 1560 |
| 1000 bytes, sent as they are  | 462          | 467  | 2098 | 340            | 339  | 1601 |

Why 64: groups are faster from 21 bytes on if everything is in the cache, by 5 to 15% up to 48 and
by 30% at 64. They are more code and 6 more cache lines of table. One string literal on Emerald
Rapids, other strings every time, against the loop alone:

| characters                               | 64   | 100  | 200  | 500  | 1000 | 4000 |
| ---------------------------------------- | ---- | ---- | ---- | ---- | ---- | ---- |
| in a loop                                | 0.69 | 0.62 | 0.63 | 0.59 | 0.59 | 0.58 |
| 512 KB touched in between (L1 is cold)   | 0.89 | 0.84 | 0.76 | 0.66 | 0.63 | 0.58 |
| 8 MB touched in between (L2 is cold too) | 1.28 | 1.22 | 1.16 | 1.01 | 0.84 | 0.65 |

The last row is 140 to 200 ns, once per string. The C code takes twice as long as the loop there, up
to 2000 characters: it has a cache miss for every other character.

What else was tried for long strings, 1000 characters, against the loop alone, on Emerald Rapids.

| what                                                              | in a loop                                                              | 8 MB touched |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------ |
| the structure of the C code: table of pairs, 64 bits, split write | 0.77                                                                   |              |
| table of pairs, 3 pairs joined by shifts, write without a branch  | 0.64                                                                   | 1.38         |
| 4, 6, 7 or 8 codes joined by shifts alone                         | 0.74 to 0.86                                                           |              |
| groups of 8: upper case and printable text do not fit 57 bits     | 1.02 to 1.16 there                                                     |              |
| code, length and shift in arrays of their own, for all lengths    | 0.55, but 1.01 to 1.05 at 8 to 24 characters                           |              |
| the three in one entry of 8 bytes                                 | 0.77: loaded as one word and taken apart                               |              |
| no pass for the length until a group could make the code longer   | 0.56, but 2.9 if such groups come last and the string is sent as it is |              |
| lengths added up 8 at a time, or 8 bytes per load                 | 0.57; 1.08 to 1.21 for the pass on Cascade Lake                        |              |

How the loop is compiled matters as much as what it does. What cost 4 to 35% each: the byte by byte
case inlined into the loop (it is `#[cold]` and takes its state by value now), the halves computed
in each arm of the `if` instead of before it, `as_chunks`, which divides by 7 even for 3 bytes, and
lengths added up as `u32` instead of `u8`.
