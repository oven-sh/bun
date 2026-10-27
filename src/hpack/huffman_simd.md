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
that the input ends in the middle of, and when the output has no room for a block. `huffman.rs` goes
on from the bit it stopped at: it decodes the long code and calls the kernel again, or checks the
padding. So what is accepted, what is refused and with which error does not depend on the CPU, with
one exception: a string that is both longer than allowed and malformed may be refused as either.

## Which CPUs

AVX-512 VBMI: Intel from Ice Lake on (not Alder Lake and later desktop parts), AMD from Zen 4 on.
Highway's targets `AVX3_DL`, `AVX3_ZEN4`, `AVX3_SPR` and `AVX10_2`. Elsewhere the kernel is a stub
and is not called.

Without a 64-entry byte shuffle, one jump table costs more than the lookups it replaces: 4 `pshufb`
and as many blends per 16 lanes. NEON has that shuffle (`TBL`/`TBX` with four registers), which
Highway does not expose. It has not been tried.

## Numbers

Xeon (Sapphire Rapids) at 2.1 GHz, compiled with `-march=nehalem` like every x64 build.

The whole decoder on http2jp/hpack-test-case, per field:

| wire                                     | scalar | kernel | ls-hpack |
| ---------------------------------------- | ------ | ------ | -------- |
| nghttp2's: Huffman and the dynamic table | 58 ns  | 43 ns  | 78 ns    |
| go-hpack's: Huffman, nearly all literals | 116 ns | 79 ns  | 111 ns   |

Prototypes of both on the 10,654 strings that its requests and responses send as literals, 26 bytes
on average, per string:

|                                      | scalar     | kernel     |
| ------------------------------------ | ---------- | ---------- |
| in a loop                            | 77 ns      | 40 ns      |
| 8 at a time, 1 MB touched in between | 299 cycles | 155 cycles |
| 8 at a time, 8 MB touched in between | 842 cycles | 317 cycles |

The scalar decoder's table is 32 KB. The kernel's tables are 448 bytes.

## What else was tried

Measured on the same strings, against the scalar code of the time.

| what                                                   | result                                  |
| ------------------------------------------------------ | --------------------------------------- |
| encoded length, `pshufb` rows (SSE4)                   | 20 ns against 12.5: slower              |
| encoded length, `vpermi2b` (AVX-512 VBMI)              | 5.3 ns against 12.5                     |
| encoder, `pshufb` rows, lanes merged to 32 bits (SSE4) | 55 ns against 54                        |
| encoder, the same with 64-bit lanes (AVX2)             | 45 ns                                   |
| encoder, `vpermi2b`, 64-bit lanes (AVX-512 VBMI)       | 38 ns                                   |
| encoder, scalar, one pass, four codes per write        | 40.5 ns: this is what `huffman.rs` does |
| the whole crate compiled for AVX-512                   | no change, encoder or decoder           |
| wyhash replaced by one multiplication                  | no change                               |

The encoder's codes have to be joined bit by bit whatever finds them, and header strings are too
short for the lookups to matter.
