# HPACK's Huffman code

`huffman.rs` in this directory decodes and codes the strings of a header block (RFC 7541 §5.2). On a
CPU with AVX-512 VBMI it hands runs of short codes to a kernel,
`src/jsc/bindings/highway_hpack.cpp`, through `bun_highway::hpack_huffman_decode_short`. Nothing
else calls that kernel. This note says how the three work, what they cost and what not to try again.

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

That leaves one call wasted on a string of such text, 10 to 19 ns whatever the length. Where such
text follows plain text in one string, the average takes a few calls to come down. Such a call costs
about 20 ns, which is more than 12 symbols gain, so the calls before it count as 64 symbols ahead at
most. That is six calls if each yields one symbol, and eight on average in JSON, where a call yields
four. The limit has a price where plain text comes back after some 100 characters of JSON. The table
at the end has what 32, 96 and no limit cost.

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
out the same way, with the padding. So for text with codes of up to 8 bits its branches depend on
the length of the text and not on the text. One group in five of random printable characters is
coded again.

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
A row has up to 16,384 different values (4,194 of 1000 bytes): the branch predictor learns 512 of
them, and then code with branches that depend on the text looks up to 25% faster than it is. "C" is
ls-hpack 2.3.5, which is what Bun used before this crate, with its table of 65,536 pairs and its
decoder that looks up 16 bits in 256 KB, put into the same benchmark. Xeon (Emerald Rapids) at 2.1
GHz, compiled like a release build (`-march=nehalem`, LTO), the lowest of 3 runs.

`decode/skip`: kernel / scalar / C.

| length    | 1            | 8            | 32              | 64              | 127             | 128             | 1000                |
| --------- | ------------ | ------------ | --------------- | --------------- | --------------- | --------------- | ------------------- |
| text      | 21 / 21 / 22 | 34 / 35 / 53 | 48 / 81 / 148   | 75 / 146 / 281  | 129 / 273 / 533 | 127 / 278 / 537 | 856 / 1951 / 4053   |
| url       | 20 / 20 / 21 | 40 / 35 / 50 | 61 / 75 / 133   | 100 / 140 / 262 | 181 / 267 / 504 | 180 / 270 / 495 | 1243 / 1877 / 3716  |
| digits    | 21 / 20 / 21 | 31 / 27 / 41 | 50 / 62 / 104   | 72 / 119 / 192  | 114 / 244 / 372 | 119 / 239 / 368 | 771 / 1825 / 2717   |
| base64    | 20 / 20 / 21 | 36 / 34 / 52 | 66 / 80 / 147   | 110 / 145 / 277 | 197 / 274 / 553 | 197 / 276 / 544 | 1386 / 1968 / 4148  |
| upper     | 20 / 20 / 21 | 38 / 35 / 38 | 55 / 83 / 101   | 85 / 153 / 189  | 138 / 285 / 362 | 142 / 290 / 358 | 947 / 2019 / 2746   |
| json      | 22 / 23 / 24 | 50 / 39 / 52 | 115 / 102 / 136 | 204 / 196 / 281 | 384 / 375 / 548 | 387 / 379 / 543 | 2714 / 2743 / 4004  |
| printable | 21 / 22 / 23 | 45 / 39 / 50 | 99 / 86 / 152   | 164 / 155 / 350 | 335 / 324 / 852 | 338 / 330 / 898 | 2913 / 2919 / 11509 |
| raw       | 16 / 16 / 19 | 15 / 17 / 18 | 15 / 16 / 20    | 16 / 17 / 30    | 19 / 19 / 48    | 19 / 19 / 38    | 52 / 52 / 210       |

`encode/add`: Rust / C. Values of 1 byte come again while they are in the table, so most of those
are references.

| length    | 1       | 8        | 32       | 64        | 127       | 128       | 1000        |
| --------- | ------- | -------- | -------- | --------- | --------- | --------- | ----------- |
| text      | 17 / 47 | 43 / 71  | 67 / 109 | 92 / 135  | 162 / 199 | 161 / 197 | 979 / 1020  |
| url       | 15 / 43 | 43 / 77  | 66 / 105 | 95 / 132  | 170 / 199 | 161 / 195 | 992 / 1093  |
| digits    | 16 / 40 | 44 / 72  | 67 / 93  | 94 / 115  | 166 / 172 | 165 / 173 | 1005 / 926  |
| base64    | 19 / 45 | 43 / 73  | 67 / 111 | 95 / 134  | 166 / 199 | 166 / 203 | 985 / 1045  |
| upper     | 17 / 46 | 44 / 77  | 68 / 103 | 93 / 117  | 169 / 176 | 168 / 176 | 1020 / 955  |
| json      | 18 / 45 | 45 / 89  | 73 / 122 | 114 / 171 | 218 / 262 | 218 / 259 | 1412 / 1448 |
| printable | 20 / 47 | 48 / 89  | 73 / 127 | 109 / 178 | 218 / 267 | 208 / 267 | 1614 / 1582 |
| raw       | 15 / 42 | 38 / 111 | 47 / 142 | 53 / 164  | 81 / 212  | 84 / 220  | 374 / 1031  |

The other rows, for text: `encode/skip` takes 14, 20, 40, 69, 140, 134 and 984 ns (C 48 to 175, and
960). `decode/add` takes up to 10 ns more than `decode/skip`. A field that is in the table takes 13
to 20 ns to encode up to 128 characters (C 38 to 63) and 81 at 1000 (211), and 6 ns to decode (13 to
21). Two runs of a row differ by up to 5%. Behind C, all at 1000 characters: `encode/add` of digits
by 8%, of upper case letters by 7%, of printable characters by 2%, and `encode/skip` of text by 2%.
127 and 128 are the two sides of `GROUPS_MIN_LEN`.

`encode/never` sends one value again and again, like a token, and takes what `encode/skip` takes:
this coder has no branch that depends on the text. The C code has, and once the branch predictor
knows the value it takes three quarters of its time, so that a field of 200 to 3000 characters takes
1.15 to 1.37 of C's time here.

The rest is from harnesses that are not in the repository: they touch memory between two calls, or
hold code that did not ship. The tables above are from a loop, with everything in the L1 cache. A
server has run other code since the last header block. With 64 KB touched before every block, a
block of real header fields takes 1.3 to 1.4 times as long without the kernel (the table has 32 KB)
and 1.15 to 1.25 times with it (its constants have 640 bytes), and what the kernel saves on a block
of up to 1 KB doubles. Tables of 10 to 13 bits are slower either way. The C code had tables of 256
and 512 KB.

### Why groups, and why from 128 bytes on

`encode_groups` is 30 lines, about 700 bytes of code and 1 KB of table. One string literal of text, other
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

## What else was tried

1.00 is what ships. Emerald Rapids unless it says otherwise.

| the decoder                                                     | result                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 13 bits, entries of 4 bytes with both symbols (32 KB)           | text 1.13 to 1.19, upper case 1.2 to 1.9, codes of 5 bits alone 0.96 to 0.99 |
| 14 bits, such entries (64 KB)                                   | text 1.05 to 1.26, upper case 0.94 to 1.00, 8 MB touched 1.06 to 1.50        |
| count and length in one byte                                    | the mask is on the chain: about 1.17                                         |
| one bounds check per 8 bytes of input instead of one per lookup | no change: the time goes into waiting                                        |
| no call of the kernel if the code after the next lookup is long | `W/"5F3C..."` 0.80, text 1.015, a user agent 1.07                            |
| none if the next 57 bits have 7 ones in a row                   | text 1.14 to 1.22: `p,` has 7 ones in a row                                  |
| none for under 10 bytes                                         | 1 to 10 ns less at 5, 6, 8 and 9 bytes, 5 more at 7, one block of the kernel |
| no limit on how far ahead its calls count as                    | 200 plain characters and 260 of JSON 1.19, 1000 and 1300 1.3                 |
| a limit of 32 symbols, or of 96                                 | 500, 60 of JSON, 500: 1.20, or 200 and 260: 1.07                             |
| a call that yields under 12 symbols is the last                 | a URL or base64 of 1000 characters 1.16, 500, 30 of JSON, 500: 1.37          |
| the whole crate compiled for AVX-512                            | no change                                                                    |
| the tables aligned to a cache line, or 1 or 34 bytes into one   | no change, but the same code linked at another address differs by up to 5%   |

| the coder                                                         | characters | result                                                                          |
| ----------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------- |
| 32 bits whenever it has 32, the last bytes in a loop              | up to 63   | 0.93 for 1, 1.05 for 2, 1.25 for 3, 1.6 to 1.9 from 4 on                        |
| `encode_groups` from 28 bytes on                                  | 28 to 63   | 1.05 in a loop, 1.1 to 1.2 with 8 MB touched                                    |
| no `encode_groups`                                                | 1000       | 1.08 to 1.12, printable 1.04, JSON 0.98                                         |
| `encode_groups` without the two halves                            | 1000       | JSON and printable 1.15 to 1.3                                                  |
| the structure of the C code: table of pairs, 64 bits, split write | 1000       | 1.3                                                                             |
| table of pairs, 3 pairs joined by shifts, write without a branch  | 1000       | 1.08; 1.6 with 8 MB touched                                                     |
| groups of 8                                                       | 1000       | upper case and printable text do not fit 57 bits: slower than 32 bits at a time |
| code, length and shift in arrays of their own                     | 1000       | 0.93, but 1.01 to 1.05 at 8 to 24 characters                                    |
| no pass for the length until a group could make the code longer   | 1000       | 0.95, but 2.9 if such groups come last and the string is sent as it is          |

How `encode_groups` is compiled matters as much as what it does. What costs 4 to 35% each: the byte
by byte case inlined into the loop (it is `#[cold]` and takes its state by value), the halves
computed in each arm of the `if` instead of before it, `as_chunks`, which divides by 7 even for 3
bytes, and lengths added up as `u32` instead of `u8`.

SIMD for the coder (prototypes in SSE4, AVX2 and AVX-512 VBMI) came to 0.70 to 1.02 of a loop that
writes 32 bits at a time, and `encode` takes 0.66 of that loop: the codes have to be joined bit by
bit whatever finds them. Starting to code before the length is known gains on one CPU, nothing on
another, and costs 1.3 to 2 for a string that is sent as it is.
