# HPACK's Huffman code

`huffman.rs` in this directory decodes and codes the strings of a header block (RFC 7541 §5.2). On a
CPU with AVX-512 VBMI it hands runs of short codes to a kernel,
`src/jsc/bindings/highway_hpack.cpp`, through `bun_highway::hpack_huffman_decode_short`. Nothing
else calls that kernel. This note says how the three work, what they cost and what else was tried.

## The scalar decoder

A Huffman decoder is a chain: where a code starts depends on how long the one before it was. Each
table lookup waits for the one before it, about 10 cycles, and that is where the time goes. So a
lookup should yield as many symbols as a table that fits the L1 cache can give.

A lookup takes the next 14 bits. They hold two codes of up to 7 bits: lower case, digits, upper
case. An entry has 2 bytes, so the table has 32 KB:

- the length of the codes, which is what the next lookup waits for, in a byte of its own,
- the last symbol. Every symbol with a code of up to 14 bits is ASCII, so the top bit of that byte
  says whether there is another symbol before it.

That other symbol has a code of up to 8 bits. It comes from a table of 256 bytes, by the first 8
bits, and nothing waits for it. Both are written as single bytes, the first one first, also if there
is none: then the only symbol goes over it. So no branch and no select depends on how many there
are.

8 bytes of input are loaded at a time and serve four lookups with no check for the end. A code of
more than 14 bits is found by comparing with the last code of each length. The last bytes, under 8,
go through the same table with a check per lookup, and what is left of them has to be padding.

## The kernel

It takes the lookups off the chain by doing them for every place a code could start.

1. Take 64 bits of input and look at all 64 bit offsets at once, as if a code started at each.
   `vpmultishiftqb` yields the 8 bits from every offset on. That is enough to tell the length and
   the symbol of a code of up to 8 bits: all of `[0-9A-Za-z]` and ` %&*,-./:;=_`, 99.2% of the bytes
   of the header values in the corpus of http2jp/hpack-test-case.
2. `jump[offset] = offset + length` is where the next code starts. Applying that table to itself
   (`vpermb`) gives the tables for 2, 4, 8 and 16 codes ahead. None of this depends on where the
   first code starts, so the blocks of a long string are worked out side by side.
3. Lane `i` of `starts` is `i` jumps from the first code: each jump table is applied to the lanes
   that have its bit set in `i`. The symbols at those offsets are the output, 12 at most.

Between one block and the next, the chain is a shift and a mask: byte `first` of the 16-jump table.

Offsets 56 to 63 jump to themselves. That keeps a jump table at 64 entries, one `vpermb`, and a walk
that leaves the first 56 bits stops at the offset where it left. A block is therefore 7 bytes. An
offset where no short code starts also jumps to itself: a longer code, or the padding. The walk
stops there, and so does the kernel.

It reports no errors. It stops before a code of more than 8 bits, before the padding, before a code
that the input ends in the middle of, and when the output has no room for a block (16 bytes, of
which it may fill fewer: the rest is overwritten with whatever the shuffle left there). `huffman.rs`
goes on from the bit it stopped at: it decodes the long code and tries the kernel again, or checks
the padding. So what is accepted, what is refused and with which error does not depend on the CPU.

### When it is called

A call costs about 15 ns before the first symbol, which pays off from about a dozen symbols on.
`huffman.rs` does not call it

- for under 5 bytes of input,
- where a code of more than 8 bits comes next,
- once its calls on this string have yielded under 12 symbols on average, which is what happens in
  text that is dense in such codes, like JSON.

That leaves one call wasted on such text, and never a second one: a call that yields under 12
symbols is the last one on that string. It costs 10 to 19 ns whatever the length. On Emerald Rapids,
a string that starts with a short code and goes on with codes of 10 to 13 bits takes 40 ns instead
of 29 at 5 bytes, 60 instead of 44 at 12 and 127 instead of 108 at 40.

### Which CPUs

AVX-512 VBMI: Intel from Ice Lake on (not Alder Lake and later desktop parts), AMD from Zen 4 on.
Highway's targets `AVX3_DL`, `AVX3_ZEN4`, `AVX3_SPR` and `AVX10_2`. Elsewhere the kernel is a stub
and is not called.

Without a 64-entry byte shuffle, one jump table costs more than the lookups it replaces: 4 `pshufb`
and as many blends per 16 lanes. NEON has that shuffle (`TBL`/`TBX` with four registers), which
Highway has no operation for. It has not been tried.

## The coder

No SIMD here, but the same problem: where a code goes depends on the lengths of all the codes before
it. A loop that writes 32 bits whenever it has that many does so about every 5 bytes. When exactly
depends on the text, so that branch is mispredicted, and so is a loop over the last 1 to 4 bytes.

`encode` adds one code at a time to what is left too, but writes after every 7 bytes, whatever they
are: 8 bytes, of which as many count as are full. 7 codes of 8 bits, the longest in plain text, and
the 7 bits that may be left from before are 63 bits. If the lengths add up to more than 64 bits, the
7 bytes are coded again from what was left before them and written byte by byte. The last bytes go
out the same way, with the padding. So its branches depend on the length of the text and not on the
text.

What is left is one shift by a variable count per code, which waits for the one before it. From 128
bytes on, where that wait begins to show, `encode_groups` takes 7 bytes at a time.

1. Neighbours are joined by a multiplication: `code(a) * (1 << len(b)) | code(b)`. `1 << len` comes
   from `SHIFTS`, 1 KB.
2. The pairs are joined by shifts, by lengths that are added up on the side.
3. They are written as above.

A group of more than 57 bits is written in two halves, of 4 and 3 bytes, if each has 57 bits at
most: `{"a":1,` has 60, and one group in three of random printable characters has too many.
Otherwise it is written byte by byte. Four printable characters are enough for that: `{{{~` has 58
bits, `\{{!` 59.

The length is counted in a pass of its own before that, so a string that is sent as it is costs no
more than the count and a copy.

## Numbers

`scripts/bench-hpack-rust.sh` runs `benches/hpack.rs`: one field with a name from the static table,
in ns, through `Encoder::encode` and `Decoder::next`. With `--scalar` it leaves the kernel out.
Every row has 16,384 different values (4,194 of 1000 bytes): the branch predictor learns 512 of
them, and then code with branches that depend on the text looks up to 25% faster than it is. "C" is
ls-hpack 2.3.5, which is what Bun used before this crate, with its table of 65,536 pairs and its
decoder that looks up 16 bits in 256 KB, put into the same benchmark. Xeon (Emerald Rapids) at 2.1
GHz, compiled like a release build (`-march=nehalem`, LTO), the lowest of 3 runs, for C of 2 and in
`encode/add` of up to 9.

`decode/skip`: kernel / scalar / C.

| length    | 1            | 8            | 32              | 63              | 64              | 100             | 1000                |
| --------- | ------------ | ------------ | --------------- | --------------- | --------------- | --------------- | ------------------- |
| text      | 20 / 20 / 23 | 33 / 35 / 54 | 52 / 82 / 146   | 80 / 144 / 278  | 76 / 149 / 274  | 107 / 237 / 449 | 850 / 2010 / 4093   |
| url       | 21 / 21 / 22 | 40 / 35 / 52 | 62 / 76 / 137   | 101 / 131 / 255 | 99 / 139 / 273  | 148 / 216 / 390 | 1236 / 1872 / 3724  |
| digits    | 20 / 20 / 21 | 33 / 27 / 44 | 50 / 63 / 105   | 69 / 120 / 190  | 69 / 118 / 192  | 104 / 204 / 291 | 759 / 1843 / 2708   |
| base64    | 20 / 20 / 23 | 35 / 34 / 56 | 65 / 79 / 152   | 109 / 142 / 281 | 111 / 142 / 287 | 160 / 221 / 434 | 1367 / 1980 / 4302  |
| upper     | 20 / 20 / 23 | 38 / 34 / 40 | 54 / 84 / 102   | 76 / 150 / 183  | 83 / 153 / 201  | 112 / 231 / 295 | 918 / 2003 / 2771   |
| json      | 22 / 22 / 25 | 50 / 40 / 51 | 120 / 102 / 140 | 202 / 196 / 273 | 212 / 196 / 274 | 309 / 300 / 438 | 2740 / 2743 / 4057  |
| printable | 22 / 22 / 24 | 45 / 38 / 51 | 97 / 87 / 160   | 176 / 158 / 352 | 181 / 162 / 348 | 259 / 251 / 626 | 2939 / 3070 / 11327 |
| raw       | 16 / 16 / 19 | 16 / 16 / 20 | 16 / 16 / 20    | 16 / 18 / 39    | 17 / 16 / 30    | 17 / 17 / 33    | 50 / 51 / 208       |

`encode/add`: Rust / C. Values of 1 byte come again while they are in the table, so most of those
are references.

| length    | 1       | 8        | 32       | 63        | 64        | 100       | 1000        |
| --------- | ------- | -------- | -------- | --------- | --------- | --------- | ----------- |
| text      | 18 / 48 | 44 / 78  | 66 / 111 | 94 / 134  | 95 / 133  | 136 / 176 | 982 / 1021  |
| url       | 15 / 42 | 44 / 75  | 68 / 106 | 91 / 134  | 96 / 131  | 134 / 173 | 982 / 1108  |
| digits    | 15 / 40 | 44 / 71  | 71 / 94  | 94 / 121  | 94 / 116  | 136 / 150 | 1030 / 932  |
| base64    | 19 / 49 | 43 / 76  | 70 / 116 | 96 / 138  | 93 / 133  | 135 / 171 | 983 / 1023  |
| upper     | 17 / 48 | 44 / 77  | 70 / 105 | 92 / 125  | 93 / 119  | 138 / 154 | 1003 / 942  |
| json      | 19 / 44 | 47 / 87  | 74 / 121 | 112 / 166 | 112 / 165 | 176 / 225 | 1407 / 1453 |
| printable | 21 / 49 | 47 / 90  | 72 / 133 | 108 / 171 | 107 / 169 | 166 / 229 | 1612 / 1543 |
| raw       | 16 / 42 | 38 / 110 | 47 / 143 | 53 / 165  | 53 / 163  | 74 / 199  | 369 / 1003  |

The other rows, for text: `encode/skip` takes 14, 20, 39, 70, 68, 102 and 927 ns. `decode/add` takes
up to 11 ns more than `decode/skip`. A field that is in the table takes 13 to 19 ns to encode up to
100 characters (C 39 to 56) and 80 at 1000 (213), and 6 ns to decode (13 to 21). Two runs of a row
differ by up to 5%. Behind C in `encode/add`: 1000 digits by 10%, upper case letters by 7%,
printable characters by 4%.

The rest is from harnesses that are not in the repository: they need the C code, or touch memory
between two calls. One string literal of text through the coder, other strings every time, against
C, the worse of two runs:

| characters                | 1    | 8    | 16   | 32   | 63   | 64   | 100  | 1000 | 4000 |
| ------------------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| in a loop                 | 1.11 | 0.93 | 0.77 | 0.85 | 1.00 | 1.00 | 1.08 | 1.24 | 1.26 |
| 512 KB touched in between | 0.80 | 0.84 | 0.43 | 0.79 | 0.82 | 0.79 | 0.88 | 1.11 | 1.20 |
| 8 MB touched in between   | 0.52 | 0.58 | 0.46 | 0.40 | 0.40 | 0.42 | 0.37 | 0.32 | 0.39 |

In a loop the C code has its table of pairs in the cache, and the literal by itself is behind it: by
up to 1.26 for text, and by 1.4 for hexadecimal digits from 32 and upper case from 64 characters on
(Cascade Lake: text 1.25, those 1.35 to 1.6). The rest of `Encoder::encode` makes up for that in the
table above. With 8 MB the C code has a cache miss for every other character. With 512 KB it depends
on how much of its table is still in the L2 cache: its times differ by up to 1.6 between two runs.
The scalar decoder with 8 MB touched in between: 100 characters 0.51 of C, the values of
hpack-test-case 0.75; on Cascade Lake 0.45 and 0.62. The kernel is further ahead, with tables of 448
bytes: prototypes of it and of a decoder with a table of 32 KB took 155 against 299 cycles a string
with 1 MB touched in between, 317 against 842 with 8 MB.

Xeon (Cascade Lake) at 2.8 GHz, which has no kernel, 512 values per row, the decoder against C: text
of 8 to 1000 characters 0.77 to 0.55, the values of hpack-test-case 0.70, `SAMEORIGIN` 0.96, a date
0.95, 1 code in 5 of 10 to 19 bits 0.38, codes of 7 bits alone 0.67, of 14 bits 0.95. Behind C:
codes of 5 bits alone 1.10, of 15 bits 1.33, of 8 bits 1.79, since two of those need 16 bits of
lookup.

Written byte by byte, 7 bytes take longer than in a loop that writes 32 bits whenever it has 32.
With 4 codes of 15 bits in half of the groups, which is about the most that a string can have and
still be sent coded, a literal of 14 to 56 bytes takes 1.10 to 1.14 of the time of that loop. With
such codes in a quarter of the groups it takes 1.07 to 1.10, in a tenth 1.01 to 1.02. At 70 bytes it
takes 1.11, 1.09 and 1.03 of what `encode_groups` takes, whose halves hold such codes. Of the 9,222
different strings of hpack-test-case that are sent coded, 6 have such a group, one each.

### Why groups, and why from 128 bytes on

`encode_groups` is 35 lines, 750 bytes of code and 1 KB of table. One string literal of text, other
strings every time, against the loop of `encode` alone, on Emerald Rapids:

| characters                | 64   | 96   | 128  | 160  | 192  | 256  | 512  | 1000 | 4000 |
| ------------------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| in a loop                 | 1.02 | 1.00 | 1.00 | 0.96 | 0.93 | 0.93 | 0.91 | 0.92 | 0.90 |
| 512 KB touched in between | 1.10 | 1.07 | 1.06 | 1.02 | 1.01 | 0.98 | 0.94 | 0.92 | 0.91 |
| 8 MB touched in between   | 1.25 | 1.23 | 1.24 | 1.27 | 1.23 | 1.26 | 1.19 | 1.03 | 0.97 |

Digits and upper case give the first row again. What the groups buy is the column of 1000 bytes of
`encode/add`. With the loop alone, and all three in one binary, text takes 1.07 of the time of the C
code instead of 0.96, base64 1.05 instead of 0.97, digits 1.17 instead of 1.08, upper case 1.15
instead of 1.06. What they cost is 150 to 250 ns for a string of 128 to 512 bytes that finds nothing
in the cache. Under 128 bytes they gain nothing in that table, so there they are not used.

On Cascade Lake they matter less: 0.97 to 1.00 for text of 64 to 4000 characters in a loop. With 8
MB touched in between it is 1.14 to 1.22 at 64 and 100 characters, 1.06 to 1.12 at 200 and 1.02 at
500 and 1000. Printable characters are the exception, with 0.97 at 64, 0.93 at 100 and 0.84 to 0.87
from 1000 on, in a loop. `Encoder::encode` takes 0.88 of the time of the C code at 200 characters
there and 1.00 to 1.08 from 500 to 4000.

### CPUs that were not measured

What can be said without them is about the work, not about mispredicted branches. llvm-mca 18 takes
every branch as predicted.

The coder: the loop of `encode` over whole groups has 10.6 instructions per byte on x64 and 10.1 on
arm64. A loop that writes 32 bits at a time has 13.8 and 13.4 with its writes. Under qemu, arm64
runs 104 instructions for a literal of 1 character (that loop 98), 218 for 8 (249), 584 for 32 (692)
and 1064 for 63 (1280). Cycles per byte in llvm-mca, whose Intel models are left out because they
come to 4.3 where Emerald Rapids takes 2.2:

|                            | Zen 1, 2 | Zen 3, 4 | Cortex-A55 | A76  | Neoverse N1 | N2, V1, V2 | Ampere-1 |
| -------------------------- | -------- | -------- | ---------- | ---- | ----------- | ---------- | -------- |
| `encode`                   | 2.65     | 2.01     | 9.1        | 3.44 | 2.44        | 2.43       | 2.58     |
| `encode_groups`            | 3.15     | 1.94     | 9.0        | 4.01 | 2.40        | 2.15       | 2.86     |
| 32 bits whenever it has 32 | 3.46     | 2.31     | 19.8       | 4.91 | 3.01        | 2.21       | 3.68     |

The decoder: a lookup takes 23 to 27 instructions on x64 and 19 to 25 on arm64. With entries of 4
bytes that hold both symbols it would take 17 and 15. They are not what the loop waits for, so they
cost nothing where strings differ from call to call, as above. With one string decoded over and
over, which the branch predictor learns, on Sapphire Rapids, against a table of 13 bits with such
entries: text 1.00 to 1.04 of the time, a URL 1.10, digits 1.02 to 1.11, base64 0.87 to 0.90, upper
case 0.58 to 0.63. arm64 has not been timed. Counted under qemu, against that table, text takes 13.3
instructions a symbol instead of 9.8, upper case 13.3 instead of 17.6, codes of 14 bits 26 instead
of 54. llvm-mca gives a window of four lookups the same number of cycles on Neoverse N1, V1 and V2,
Ampere-1 and Apple M1, 4% more on Cortex-A76, and 19% more on Cortex-A55, which runs instructions in
order.

## What else was tried

1.00 is what ships. Emerald Rapids unless it says otherwise.

| the decoder                                                     | result                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 13 bits, entries of 4 bytes with both symbols (32 KB)           | text 1.13 to 1.19, upper case 1.2 to 1.9, codes of 5 bits alone 0.96 to 0.99 |
| 14 bits, such entries (64 KB)                                   | text 1.05 to 1.26, upper case 0.94 to 1.00, 8 MB touched 1.06 to 1.50        |
| such entries, one `write` for short and long codes              | 23 instructions a lookup instead of 17; on Cascade Lake 1.10 to 1.25         |
| unpacking an entry of 2 bytes into a struct, `if count == 2`    | a branch: about 1.5                                                          |
| count and length in one byte                                    | the mask is on the chain: about 1.17                                         |
| picking the first symbol with `if`, the flag in the symbol      | a branch again: about 1.5                                                    |
| one bounds check per 8 bytes of input instead of one per lookup | no change: the time goes into waiting                                        |
| lookups without a check at the start of the last bytes          | no change at 7 bytes, 1.25 at 8                                              |
| no call of the kernel if the code after the next lookup is long | `W/"5F3C..."` 0.80, text 1.015, a user agent 1.07                            |
| none if the next 57 bits have 7 ones in a row                   | text 1.14 to 1.22: `p,` has 7 ones in a row                                  |
| none for under 10 bytes                                         | 1 to 10 ns less at 5, 6, 8 and 9 bytes, 5 more at 7, one block of the kernel |
| the whole crate compiled for AVX-512                            | no change                                                                    |
| the tables aligned to a cache line, or 1 or 34 bytes into one   | no change, but the same code linked at another address differs by up to 5%   |

| the coder                                                         | characters | result                                                                          |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| 32 bits whenever it has 32, the last bytes in a loop              | up to 63   | 0.93 for 1, 1.05 for 2, 1.25 for 3, 1.6 to 1.9 from 4 on                        |
| the same, the last bytes written at once                          | up to 63   | 0.94 for 1, 1.3 to 1.7 from 5 on                                                |
| 7 codes joined on the side, then added to what is left            | up to 63   | 1.03 to 1.18 for 1, 1.1 to 1.25 from 8 on                                       |
| one loop over the bytes that writes where the index says so       | up to 63   | 1.1 to 1.3 from 8 on, 16 instructions per byte                                  |
| `encode_groups` from 28 bytes on                                  | 28 to 63   | 1.05 in a loop, 1.1 to 1.2 with 8 MB touched                                    |
| byte by byte, but a write only where the next code does not fit   | up to 127  | JSON and printable 0.95 to 0.98, 4 codes of 15 bits in half of the groups 1.04  |
| no `encode_groups`, with that arm                                 | 1000       | 1.08 to 1.12, printable 1.04, JSON 0.98                                         |
| `encode_groups` without the two halves                            | 1000       | JSON and printable 1.15 to 1.3                                                  |
| 32 bits whenever it has 32                                        | 1000       | 1.7; 1.55 on Cascade Lake                                                       |
| the structure of the C code: table of pairs, 64 bits, split write | 1000       | 1.3                                                                             |
| table of pairs, 3 pairs joined by shifts, write without a branch  | 1000       | 1.08; 1.6 with 8 MB touched                                                     |
| 4, 6, 7 or 8 codes joined by shifts on the side                   | 1000       | 1.25 to 1.45                                                                    |
| groups of 8                                                       | 1000       | upper case and printable text do not fit 57 bits: slower than 32 bits at a time |
| code, length and shift in arrays of their own                     | 1000       | 0.93, but 1.01 to 1.05 at 8 to 24 characters                                    |
| the three in one entry of 8 bytes                                 | 1000       | 1.3: loaded as one word and taken apart                                         |
| no pass for the length until a group could make the code longer   | 1000       | 0.95, but 2.9 if such groups come last and the string is sent as it is          |
| lengths added up 8 at a time, or 8 bytes per load                 | 1000       | 0.97; 1.08 to 1.21 for the pass on Cascade Lake                                 |

How `encode_groups` is compiled matters as much as what it does. What costs 4 to 35% each: the byte
by byte case inlined into the loop (it is `#[cold]` and takes its state by value), the halves
computed in each arm of the `if` instead of before it, `as_chunks`, which divides by 7 even for 3
bytes, and lengths added up as `u32` instead of `u8`.

SIMD for the coder, on the 10,654 strings that hpack-test-case sends as literals, 26 bytes on
average, on Sapphire Rapids, against 32 bits at a time: the length with `pshufb` rows (SSE4) 1.6,
with `vpermi2b` (AVX-512 VBMI) 0.42; the codes with `pshufb` rows and 32-bit lanes (SSE4) 1.02, with
64-bit lanes (AVX2) 0.83, with `vpermi2b` 0.70. `encode` takes 0.66 of that loop on text of 1 to 60
characters. The codes have to be joined bit by bit whatever finds them, and header strings are too
short for the lookups to matter. Starting to code before the length is known, against the same loop:
hpack-test-case 0.78 on Sapphire Rapids and 1.0 on Cascade Lake, a string that is sent as it is 1.3
to 2, one of 1 to 3 bytes 1.1 to 1.3. wyhash replaced by one multiplication in `Encoder::encode`: no
change.
