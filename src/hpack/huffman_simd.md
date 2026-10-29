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

That leaves one call wasted on such text, and never a second one: a call that yields under 12
symbols is the last one on that string. It costs 10 to 19 ns whatever the length. On Emerald Rapids,
a string that starts with a short code and goes on with codes of 10 to 13 bits takes 40 ns instead of
29 at 5 bytes, 60 instead of 44 at 12 and 127 instead of 108 at 40.

Looking ahead before the call does not pay. One lookup ahead finds a long code that is the second or
third symbol (`W/"5F3C..."` takes 47 ns instead of 59) and costs text 1.5%, a user agent 7%. Not
calling where the next 57 bits have 7 ones in a row costs text 14 to 22%. Not calling for under 10
bytes saves 1 to 10 ns at 5, 6, 8 and 9 bytes and costs 5 at 7, which is one block of the kernel.

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
"Before" is the decoder this replaced: 32 bits at a time, long codes bit by bit. Both looked up 13
bits at a time then: see "The table of the scalar decoder".

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

With entries of 4 bytes, the scalar decoder's loop had to write a short code and a long code in two
places. With one `write` after the `if` for both, the compiler loaded the four bytes of an entry one
by one and put the two symbols together again: 23 instructions a lookup instead of 17. Sapphire
Rapids hid most of that. On Cascade Lake text took 10 to 25% longer.

## The table of the scalar decoder

The numbers above are from a table of 13 bits with 4 bytes per entry. 13 bits do not hold two codes
of 7 bits, which is what upper case has, so `SAMEORIGIN` took a lookup per character and longer than
in the C code that this crate replaced, which looks up 16 bits in 256 KB.

14 bits do. With entries of 4 bytes that is 64 KB, twice the L1 cache of most CPUs, so an entry has
2 bytes now and the table is as big as it was:

- the length of the codes, which is what the next lookup waits for, in a byte of its own,
- the last symbol. Every symbol with a code of up to 14 bits is ASCII, so the top bit of that byte
  says whether there is another symbol before it.

That other symbol has a code of up to 8 bits. It comes from a table of 256 bytes, by the first 8
bits, and nothing waits for it. Both are written as single bytes, the first one first, also if there
is none: then the only symbol goes over it. So no branch and no select depends on how many there are.

One field with a name from the static table, without the kernel, in ns. "13" is the table as it was,
"64 KB" is 14 bits with entries of 4 bytes, "C" is ls-hpack 2.3.5.

|                                             | Cascade Lake |      |       |      | Emerald Rapids |      |       |       |
| ------------------------------------------- | ------------ | ---- | ----- | ---- | -------------- | ---- | ----- | ----- |
| value                                       | 13           | now  | 64 KB | C    | 13             | now  | 64 KB | C     |
| 8 characters with codes of up to 8 bits     | 62           | 55   | 58    | 71   | 44             | 37   | 40    | 51    |
| 32                                          | 122          | 106  | 122   | 156  | 96             | 84   | 94    | 136   |
| 100                                         | 285          | 244  | 298   | 410  | 251            | 223  | 255   | 397   |
| 1000                                        | 2445         | 2111 | 2660  | 3868 | 2166           | 1913 | 2205  | 3996  |
| 100, all with codes of 7 bits               | 380          | 202  | 202   | 303  | 350            | 195  | 190   | 293   |
| 1000, all with codes of 5 bits              | 1823         | 1842 | 1818  | 1680 | 1670           | 1746 | 1664  | 1684  |
| 100, all with codes of 8 bits               | 379          | 379  | 376   | 229  | 351            | 366  | 352   | 248   |
| 200, 1 in 5 with a code of 10 to 19 bits    | 788          | 645  | 758   | 1710 | 678            | 584  | 639   | 1768  |
| 200, all with codes of 14 bits              | 1111         | 757  | 751   | 798  | 651            | 697  | 680   | 925   |
| 200, all with codes of 15 bits              | 1271         | 938  | 1139  | 804  | 718            | 749  | 761   | 941   |
| `SAMEORIGIN`                                | 61           | 49   | 46    | 51   | 38             | 27   | 26    | 34    |
| `GET, POST, PUT, DELETE, OPTIONS`           | 122          | 88   | 86    | 97   | 96             | 65   | 64    | 87    |
| `Mon, 21 Oct 2013 20:13:21 GMT`             | 89           | 81   | 80    | 85   | 66             | 59   | 58    | 71    |
| `text/html; charset=utf-8`                  | 74           | 71   | 69    | 78   | 49             | 49   | 49    | 64    |
| the values in http2jp/hpack-test-case       | 106          | 96   | 100   | 138  | 76             | 70   | 73    | 111   |
| 100 characters, 8 MB touched in between     | 4654         | 3978 | 5951  | 8833 | 5473           | 5329 | 6347  | 10457 |
| the values in hpack-test-case, 8 MB touched | 2655         | 1987 | 2691  | 3207 | 2960           | 2994 | 3160  | 3994  |

A lookup takes more instructions than it did: 23 to 27 instead of 17 on x64, 19 to 25 instead of 15
on arm64. They are not what the loop waits for, so they cost nothing where strings differ from call
to call, as above. With one string decoded over and over, which the branch predictor learns, on
Sapphire Rapids: text 1.00 to 1.04 of the time, a URL 1.10, digits 1.02 to 1.11, base64 0.87 to 0.90,
upper case 0.58 to 0.63.

arm64 has not been timed. Counted under qemu, text takes 13.3 instructions a symbol instead of 9.8,
upper case 13.3 instead of 17.6, codes of 14 bits 26 instead of 54. llvm-mca gives a window of four
lookups the same number of cycles as before on Neoverse N1, V1 and V2, Ampere-1 and Apple M1, 4% more
on Cortex-A76, and 19% more on Cortex-A55, which runs instructions in order.

What did not work, each on text with 1 code in 5 of more than 8 bits or on codes of 5 bits only,
against the table of 13 bits.

| what                                                            | result                                |
| --------------------------------------------------------------- | ------------------------------------- |
| unpacking an entry into the old struct, `if count == 2`         | a branch: 1.5                         |
| count and length in one byte                                    | the mask is on the chain: 1.17        |
| picking the first symbol with `if`, the flag in the symbol      | a branch again: 1.5                   |
| one bounds check per 8 bytes of input instead of one per lookup | no change: the time goes into waiting |

## The coder

No SIMD here, but the same problem: where a code goes depends on the lengths of all the codes before
it. The plain loop takes one byte at a time and writes 32 bits whenever it has that many, which is
about every 5 bytes. When exactly depends on the text, so that branch is mispredicted, and so is the
loop that writes the last 1 to 4 bytes.

`encode` adds one code at a time to what is left too, but writes after every 7 bytes, whatever they
are: 8 bytes, of which as many count as are full. 7 codes of 8 bits, the longest in plain text, and
the 7 bits that may be left from before are 63 bits. If the lengths add up to more than 64 bits, the
7 bytes are coded again from what was left before them and written byte by byte. The last bytes go
out the same way, with the padding. So its branches depend on the length of the text and not on the
text.

What is left is one shift by a variable count per code, which waits for the one before it. Without
BMI2, which no x64 build of Bun assumes, that is three micro-operations on Intel up to Ice Lake. From
64 bytes on, `encode_groups` takes 7 bytes at a time.

1. Neighbours are joined by a multiplication: `code(a) * (1 << len(b)) + code(b)`. `1 << len` comes
   from `SHIFTS`, 1 KB, the only table this adds.
2. The pairs are joined by shifts, by lengths that are added up on the side.
3. They are written as above.

A group of more than 57 bits is written in two halves, of 4 and 3 bytes, if each has 57 bits at most:
`{"a":1,` has 60, and one group in three of random printable characters has too many. Otherwise,
which takes bytes that are not ASCII or several `\`, it is written byte by byte.

The length is still counted in a pass of its own, so a string that is sent as it is costs what it
did.

One string literal of characters with codes of up to 8 bits, on Emerald Rapids, in ns. Every row has
16,384 different strings: the branch predictor learns 512 of them, and then the plain loop and the C
code look up to 25% faster than they are. Each coder was compiled at four alignments, of which this
is the middle. "C" is ls-hpack 2.3.5 with its table of 65,536 pairs, which is what Bun used before
this crate. The last two rows are `encode` against the plain loop, other strings every time.

| characters                | 1    | 2    | 3    | 4    | 6    | 8    | 12   | 16   | 24   | 32   | 48   | 63   |
| ------------------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| the plain loop            | 6.3  | 7.8  | 10.1 | 13.6 | 18.0 | 19.4 | 26.3 | 33.2 | 44.2 | 57.8 | 85.8 | 109  |
| `encode`                  | 6.8  | 7.4  | 8.1  | 8.7  | 10.2 | 12.4 | 15.3 | 19.9 | 26.7 | 33.6 | 47.2 | 60.9 |
| C                         | 6.1  | 6.7  | 8.1  | 12.6 | 13.5 | 13.7 | 21.9 | 26.3 | 33.6 | 40.5 | 48.4 | 63.3 |
| 512 KB touched in between | 1.02 | 1.00 | 0.98 | 0.94 | 0.89 | 0.90 | 0.85 | 0.86 | 0.80 | 0.75 | 0.70 | 0.69 |
| 8 MB touched in between   | 0.97 | 1.00 | 0.99 | 1.00 | 1.01 | 0.97 | 0.96 | 1.00 | 0.96 | 0.96 | 0.90 | 0.98 |

The last row is good to 5%. One character takes 0.5 ns longer than with the plain loop, for the wider
write. `Encoder::encode` of a field with such a value takes 17 ns for 1 character either way, 35
instead of 41 for 8, 59 instead of 84 for 32 and 84 instead of 135 for 63. `encode` is 440 bytes more
code than the plain loop.

Other CPUs were not measured. What can be said without them is about the work, not about the
mispredicted branches, which are the point. The loop over whole groups has 10.6 instructions per byte
on x64 and 10.1 on arm64; the plain loop with its writes has 13.8 and 13.4. Under qemu, arm64 runs
104 instructions for a literal of 1 character (the plain loop 98), 218 for 8 (249), 584 for 32 (692)
and 1064 for 63 (1280). llvm-mca 18, which takes every branch as predicted, gives these cycles per
byte. Its Intel models come to 4.3 cycles per byte for `encode`, where Emerald Rapids takes 2.2, so
they are left out.

|                | Zen 1, 2 | Zen 3, 4 | Cortex-A55 | A76  | Neoverse N1 | N2, V1, V2 | Ampere-1 |
| -------------- | -------- | -------- | ---------- | ---- | ----------- | ---------- | -------- |
| the plain loop | 3.46     | 2.31     | 19.8       | 4.91 | 3.01        | 2.21       | 3.68     |
| `encode`       | 2.65     | 2.01     | 9.1        | 3.44 | 2.44        | 2.43       | 2.58     |

What else was tried for short strings, against the plain loop.

| what                                                        | result                                                                                                  |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| the plain loop, only its last bytes written at once         | 0.65 to 0.9 up to 4 characters, 0.95 above                                                              |
| 7 codes joined on the side, then added to what is left      | 1.11 to 1.27 for 1 character, 0.63 to 0.75 from 8 on                                                    |
| one loop over the bytes that writes where the index says so | 0.64 to 0.75 from 8 on; 16 instructions per byte, 18 to 38% more cycles than the plain loop in llvm-mca |

`Encoder::encode` of one field with a name from the static table and a value that is not in the
dynamic table, in ns. "Before" is the plain loop alone.

|                               | Cascade Lake |      |      | Emerald Rapids |      |      |
| ----------------------------- | ------------ | ---- | ---- | -------------- | ---- | ---- |
| value                         | before       | now  | C    | before         | now  | C    |
| 64 characters of up to 8 bits | 198          | 137  | 187  | 123            | 86   | 132  |
| 100                           | 282          | 185  | 236  | 184            | 128  | 162  |
| 200                           | 503          | 311  | 352  | 333            | 215  | 250  |
| 500                           | 1180         | 713  | 711  | 766            | 473  | 514  |
| 1000                          | 2362         | 1361 | 1329 | 1500           | 926  | 998  |
| 4000                          | 9221         | 5157 | 5007 | 5916           | 3553 | 3530 |
| 300, 1 in 20 of 10 to 15 bits | 781          | 452  | 492  | 538            | 314  | 377  |
| 1000 printable, at random     | 3308         | 2066 | 2081 | 2383           | 1480 | 1560 |
| 1000 bytes, sent as they are  | 457          | 456  | 1998 | 340            | 339  | 1601 |

Why 64: groups are more code and 6 more cache lines of table. One string literal, other strings every
time, against the plain loop alone:

| characters                                        | 64   | 100  | 200  | 500  | 1000 | 4000 |
| ------------------------------------------------- | ---- | ---- | ---- | ---- | ---- | ---- |
| Cascade Lake, in a loop                           | 0.71 | 0.70 | 0.67 | 0.67 | 0.64 | 0.64 |
| 512 KB touched in between (L1 is cold)            | 0.80 | 0.80 | 0.75 | 0.69 | 0.67 | 0.65 |
| 8 MB touched in between (L2 is cold too)          | 1.05 | 1.01 | 0.93 | 0.85 | 0.76 | 0.66 |
| Emerald Rapids, in a loop                         | 0.69 | 0.62 | 0.63 | 0.59 | 0.59 | 0.58 |
| 512 KB touched in between                         | 0.89 | 0.84 | 0.76 | 0.66 | 0.63 | 0.58 |
| 8 MB touched in between, on a host with a slow L3 | 1.28 | 1.22 | 1.16 | 1.01 | 0.84 | 0.65 |

The last row is 140 to 200 ns, once per string. The C code takes two to four times as long as the
loop there, up to 2000 characters: it has a cache miss for every other character.

And against the loop of `encode` alone, on Emerald Rapids:

| characters                | 64   | 100  | 200  | 500  | 1000 | 4000 |
| ------------------------- | ---- | ---- | ---- | ---- | ---- | ---- |
| in a loop                 | 1.02 | 1.00 | 0.97 | 0.92 | 0.92 | 0.90 |
| 512 KB touched in between | 1.10 | 1.07 | 1.00 | 0.95 | 0.92 | 0.91 |
| 8 MB touched in between   | 1.21 | 1.28 | 1.18 | 1.11 | 1.03 | 0.97 |

So there the groups pay only from 500 characters on. They are for Intel up to Ice Lake, where a shift
by `cl` is three micro-operations. That comparison has not been measured.

What else was tried for long strings, 1000 characters, against the plain loop alone, on Emerald
Rapids.

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
