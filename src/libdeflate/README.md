# bun_libdeflate

A port of [libdeflate](https://github.com/ebiggers/libdeflate) (commit `92e6a0db`, MIT: see `LICENSE`) to safe Rust. It compresses to
DEFLATE, zlib and gzip and decompresses DEFLATE and gzip, always a whole buffer at a time. (`zlib_decompress.c` is not
ported: nothing in Bun gives libdeflate a zlib stream.)

Two rules hold for every change:

- **The compressor writes the bytes libdeflate writes**, at every level (0 to 12) and for every input.
- **The decompressor accepts what libdeflate accepts** and reports the same error, bytes read and bytes written.

Both are what make it possible to check the crate against the C library byte for byte.

The crate forbids `unsafe` and denies indexing, `unwrap`, `expect`, `panic!` and `unreachable!`. An index that the
algorithm keeps in bounds is still looked up with `get`, and the `None` that never comes is passed up with `?`: a
decompressor reports it as bad data, a compressor as a result that does not fit.

## Files

| File                               | libdeflate                                      |                                              |
| ---------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| `compressor.rs`, `decompressor.rs` | `gzip_*.c`, `zlib_compress.c`                   | The public types, the gzip and zlib wrappers |
| `decompress.rs`                    | `deflate_decompress.c`, `decompress_template.h` | Decode tables and the decoding loops         |
| `compress.rs`                      | `deflate_compress.c`                            | Blocks, the output bit stream, levels 0 to 9 |
| `near_optimal.rs`                  | `deflate_compress.c`                            | Levels 10 to 12                              |
| `huffman.rs`                       | `deflate_compress.c`                            | Length-limited canonical codes               |
| `ht_`, `hc_`, `bt_matchfinder.rs`  | the headers of the same names                   | Level 1, levels 2 to 9, levels 10 to 12      |

The two checksums come from zlib, through `bun_zlib::crc32_bytes` and `adler32_bytes`.

## Memory that is only reserved stays untouched

C code can write into memory that was never initialized. Safe Rust cannot, and a match copies from the output, so the
output has to be initialized. Filling a whole reservation with zeros first would be wrong in three ways:

- The size of a reservation can come from the stream (the length in a gzip trailer), which may lie.
- A WebSocket client reserves 128 KiB for a message that is usually a few hundred bytes.
- A compressor reserves the worst case, about the size of the input, and normally uses a fraction of it.

So a `Vec` is lengthened as the output grows:

- `Inflate::run` can stop between two symbols and go on in a longer output (`Progress::NeedsOutput`). `VecSink` starts
  with 4 KiB and doubles, up to 256 KiB a step. A step that is written right after it is zeroed is still in the cache.
  Within the capacity a longer output is asked for early, so that the fast loop always has room. Where it would take a
  reallocation, the output is first used to its last byte: a `Vec` reserved at exactly the right size never moves.
- `OutputBitstream` knows the exact size of a block before it writes it, and asks its `Sink` for that much.
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
