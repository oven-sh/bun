# bun_libdeflate

A port of [libdeflate](https://github.com/ebiggers/libdeflate) (commit `92e6a0db`, MIT: see `LICENSE`) to safe Rust. It compresses to
DEFLATE, zlib and gzip and decompresses DEFLATE and gzip, always a whole buffer at a time. (`zlib_decompress.c` is not
ported: nothing in Bun gives libdeflate a zlib stream.)

Two rules hold for every change:

- **The compressor writes the bytes libdeflate writes**, at every level (0 to 12) and for every input.
- **The decompressor accepts what libdeflate accepts** and reports the same error, bytes read and bytes written.

`describe("libdeflate")` in `test/js/node/zlib/zlib.test.js` pins what the C library did with a set of inputs and streams.
The rules also mean that any change can be checked against the C library itself: build it at that commit and give both
the same inputs, at every level, with output sizes around the size of the result.

The crate forbids `unsafe` and denies indexing, `unwrap`, `expect`, `panic!` and `unreachable!`. An index that the
algorithm keeps in bounds is still looked up with `get`, and the `None` that never comes is passed up with `?`: a
decompressor reports it as bad data, a compressor as a result that does not fit.

## Files

Names are libdeflate's wherever the thing is libdeflate's, so that the two can be read side by side.

| File                               | libdeflate                                         |                                              |
| ---------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| `compressor.rs`, `decompressor.rs` | `gzip_*.c`, `zlib_compress.c`                      | The public types, the gzip and zlib wrappers |
| `deflate_decompress.rs`            | `deflate_decompress.c`, `decompress_template.h`    | Decode tables and the decoding loops         |
| `deflate_compress.rs`              | `deflate_compress.c`                               | Blocks, the output bit stream, levels 0 to 9 |
| `near_optimal.rs`                  | `deflate_compress.c`                               | Levels 10 to 12                              |
| `huffman.rs`                       | `deflate_compress.c`                               | Length-limited canonical codes               |
| `ht_`, `hc_`, `bt_matchfinder.rs`  | the headers of the same names                      | Level 1, levels 2 to 9, levels 10 to 12      |
| `matchfinder.rs`                   | `matchfinder_common.h`                             | What the three share                         |
| `constants.rs`                     | `deflate_constants.h`, `gzip_`, `zlib_constants.h` | Numbers fixed by the formats                 |
| `output.rs`, `error.rs`            |                                                    | Where a result goes, and what can go wrong   |

The two checksums come from zlib, through `bun_zlib::crc32_bytes` and `adler32_bytes`.

## Memory that is only reserved stays untouched

C code can write into memory that was never initialized. Safe Rust cannot, and a match copies from the output, so the
output has to be initialized. Filling a whole reservation with zeros first would be wrong in three ways:

- The size of a reservation can come from the stream (the length in a gzip trailer), which may lie.
- A WebSocket client reserves 128 KiB for a message that is usually a few hundred bytes.
- A compressor reserves the worst case, about the size of the input, and normally uses a fraction of it.

So a `Vec` is lengthened as the result grows (`Output`):

- The compressor knows the size of a block before it writes it, and asks for just that.
- The decompressor does not know, so it asks for as much again as there is, at least 512 bytes and at most 256 KiB. A
  step that is written right after it is zeroed is still in the cache. The first step is small for the sake of short
  messages, and costs a few more steps on the way to 4 KiB.
- It asks early where that takes no reallocation, so that the fast loop always has room. Where it would take one, the
  output is first used to its last byte: a `Vec` reserved at exactly the right size never moves.
- The sequence store, the match cache and the optimum nodes are `Vec`s with their full capacity reserved, filled by
  `push` or sized to the block. A compressor for level 12 reserves 9 MB and a small input touches little of it.

## The bit buffer of the decompressor

`bitbuf` holds the next bits of the input, lowest first. The low byte of `bitsleft` says how many of them may be
consumed. A refill loads a whole word and ORs it in above those bits:

```
bitbuf |= word << bitsleft
in_pos += 7 - ((bitsleft >> 3) & 7)
bitsleft |= 56
```

Only the bytes that fit whole count as read, so `bitsleft` ends up between 56 and 63. The bits above it are real input
too, and a later refill ORs the same bits over them. They may be used to look up the next table entry early, not
consumed.

The low byte of a table entry is the number of bits to consume, so `bitsleft -= entry` does it without masking. That
leaves garbage in the upper bytes of `bitsleft`, which is why it is read as `bitsleft as u8`. Shifts use `wrapping_shr`
and `wrapping_shl`, which take the low six bits of the count: an entry's count is under 64, so bits 6 and 7 are zero.

Near the end of the input a refill goes byte by byte and supplies zero bytes past the end, counting them in
`overread_count`. Looking ahead does that on valid streams. It is an error only if more than a word of them is needed, or
if at the end of the stream (or at an uncompressed block) fewer whole bytes are left in the buffer than were made up.

## Decode table entries

A table is indexed by the next `table_bits` bits. A codeword that is longer has a pointer there to a subtable, which
follows the main table in the same array and is indexed by the bits after those. "Remaining" below is the codeword
length for an entry in the main table, and that minus `table_bits` in a subtable.

Litlen entries:

| Bits                          | literal     | length                 | end of block | subtable pointer             |
| ----------------------------- | ----------- | ---------------------- | ------------ | ---------------------------- |
| 31 `HUFFDEC_LITERAL`          | 1           | 0                      | 0            | 0                            |
| 30-16                         | the literal | base length            |              | index of the subtable        |
| 15 `HUFFDEC_EXCEPTIONAL`      | 0           | 0                      | 1            | 1                            |
| 14 `HUFFDEC_SUBTABLE_POINTER` | 0           | 0                      | 0            | 1                            |
| 13 `HUFFDEC_END_OF_BLOCK`     | 0           | 0                      | 1            | 0                            |
| 11-8                          |             | remaining              |              | index bits of the subtable   |
| 4-0                           | remaining   | remaining + extra bits | remaining    | index bits of the main table |

Offset entries are like length entries and subtable pointers, with the base offset in bits 31-16. Precode entries have
the symbol in bits 20-16 and the codeword length in bits 2-0, and never need a subtable.

The extra bits of a length or offset come right after its codeword and are consumed with it. They are cut out of a copy
of the bit buffer taken before: the low `entry & 0xFF` bits, shifted right by the `remaining` in bits 11-8.

## The fast loop of the decompressor

Nearly all the time of a decompression goes into `fastloop`. A round of it decodes what a round of libdeflate's loop
decodes. How it is written is about three things that C does not have to care about, or cares about less.

**Registers.** Release builds keep the frame pointer, which leaves x86-64 fourteen registers, and without BMI2 a shift by
a variable takes `cl`. The loop needs about that many, and what matters is which values the compiler then keeps on the
stack. The output's pointer and length cost next to nothing there. `bitbuf`, `bitsleft` and `entry` are each the input of
the next step, so storing and reloading one of them slows down every symbol. That is why:

- The loop is a function of its own, not inlined, and keeps its state in local variables.
- The copies that need a loop (`copy_long_or_overlapping_match`) are out of line and cold.
- The input is a slice that shrinks from the front (`rest`), a pointer and a length, not a slice and an index. The
  compiler also sees from `rest.len() > FASTLOOP_MAX_BYTES_READ` that no refill in the round can fail.
- `FULL_LITLEN_TABLE` makes the size of the litlen table a constant when it is the full size, as it is for most text: one
  register less, and no bounds checks on the lookups, since 2047 is less than `LITLEN_ENOUGH`.
- The mask for the extra bits is looked up (`BITMASKS`).
- There is one check for room, at the top of the loop, and the caller works out again which side ran out. The check is
  also made before the first refill. So where C always does a first round, the refill can leave too little input for
  one, and the other loop decodes that round, to the same result.

**Where the jumps fall.** Skylake and its descendants up to Cascade Lake do not keep a jump in the cache of decoded
instructions if it crosses a 32-byte boundary or ends on one (the fix for erratum SKX102, "JCC"). The bounds checks give
this loop more jumps than C's has, so on such a CPU its speed depends a good deal on nothing but its address.

- `#[rustc_align(64)]` keeps changes elsewhere in Bun from moving it.
- To compare two versions of the loop, build both with `-Cllvm-args=-x86-branches-within-32B-boundaries`, which pads the
  jumps away from the boundaries. That takes out the luck, and is about what other CPUs see. Then see what the better one
  does without it, in a release build of Bun, and nudge it if it is unlucky.
- Use the other flags of a release build: `-Ctarget-cpu=nehalem -Cforce-frame-pointers=yes -Crelocation-model=static`.

**Copying a match** without pointers. A match may overlap its own output: with offset 1 and length 100 it repeats one byte.

- `copy_step` copies 40 bytes as 16, 16 and 8, each loaded whole and then stored, with one bounds check for all of them.
  That is right if the offset is 16 or more, and also if the match is no longer than its offset, since then the bytes
  that come out wrong are beyond its end. Nearly every match is one or the other, and at most 40 bytes long.
- A longer match with an offset of 40 or more is that again and again.
- Any other repeats its first `offset` bytes. They are loaded once and stored every `offset` bytes. Nothing that was just
  written is read back, which would have to wait for the write. For an offset under 8 a word is first filled with whole
  repeats, by a multiplication.

A copy may write up to `COPY_STEP - 1` bytes past the end of the match, which `FASTLOOP_MAX_BYTES_WRITTEN` allows for.
