use bun_collections::VecExt as _;
use bun_core::MutableString;
use bun_http_types::Encoding::Encoding;

use bun_brotli::BrotliReaderArrayList;
use bun_zlib::ZlibReaderArrayList;
use bun_zstd::ZstdReaderArrayList;

// PORT NOTE: the `*ReaderArrayList<'a>` types carry a `&'a mut Vec<u8>` borrow
// of the output buffer (and a `&'a [u8]` of the input). The Zig held them by
// value with the `ArrayListUnmanaged` aliased into the reader (raw ptr/len/cap
// triple). In Rust we erase the borrow to `'static` and uphold the same
// invariant the Zig code relied on: the reader never outlives the
// `body_out_str`/`buffer` it was constructed with — both are owned by the
// surrounding `HTTPClient` request lifecycle and the `Decompressor` is dropped
// (or reset to `None`) in `InternalState::deinit` before either buffer is
// freed. All construction goes through `update_buffers`, which is the single
// place the lifetime is erased.
#[derive(Default)]
pub enum Decompressor {
    Zlib(Box<ZlibReaderArrayList<'static>>),
    Brotli(Box<BrotliReaderArrayList<'static>>),
    Zstd(Box<ZstdReaderArrayList<'static>>),
    #[default]
    None,
}

/// Erase the lifetimes of an `(input, output)` pair to `'static` for storage
/// in a `*ReaderArrayList` variant.
///
/// # Safety
/// MODULE INVARIANT: the `Decompressor` is owned by the surrounding
/// `HTTPClient` request lifecycle and is dropped (or reset to `None`) in
/// `InternalState::deinit` *before* either `compressed_body` or `body_out_str`
/// is freed. Callers MUST pass exactly that pair so the erased borrows never
/// dangle. The output `Vec` MUST be uniquely borrowed by the active reader
/// (the only other access is the immediate re-seat on the next chunk, which
/// overwrites `list_ptr`).
#[inline(always)]
unsafe fn seat<'a>(input: &'a [u8], out: &'a mut Vec<u8>) -> (&'static [u8], &'static mut Vec<u8>) {
    // SAFETY: (`Interned::assume` — Population B, holder-backed) `input` is
    // `InternalState::compressed_body` (or the caller's body chunk), owned by
    // the surrounding `HTTPClient` request and freed in `InternalState::deinit`
    // strictly after the `Decompressor` is dropped/reset. NOT process-lifetime;
    // `assume` makes the holder explicit and grep-able. The output `Vec<u8>` is
    // a `&'static mut` forge — sibling `static-widen-mut` pattern, routed
    // through `detach_lifetime_mut` so the unsafe stays centralised in
    // `bun_ptr`.
    unsafe {
        (
            bun_ptr::Interned::assume(input).as_bytes(),
            bun_ptr::detach_lifetime_mut(out),
        )
    }
}

/// Decompression-bomb guard for response bodies inflated on the HTTP thread:
/// a hostile server must not be able to expand a tiny compressed payload into
/// an unbounded allocation.
const MAX_DECOMPRESSED_BODY_SIZE: usize = 1024 * 1024 * 1024;

/// Whether `buffer` starts with an RFC1950 zlib header (zlib-wrapped deflate),
/// as opposed to raw deflate. A valid header is CMF/FLG where CMF has CM=8 in
/// the low nibble and CINFO 0..=7 in the high nibble, and `(CMF << 8 | FLG)` is
/// a multiple of 31 — covering every window from 256 B to 32 KiB.
fn has_zlib_header(buffer: &[u8]) -> bool {
    buffer.len() >= 2
        && (buffer[0] & 0x0f) == 8
        && (buffer[0] >> 4) <= 7
        && (((buffer[0] as u16) << 8) | buffer[1] as u16).is_multiple_of(31)
}

impl Decompressor {
    // PORT NOTE: Zig `deinit` called `that.deinit()` on the active reader and
    // reset to `.none`. The boxed readers' `Drop` impls call `end()`, so an
    // explicit `Drop` is unnecessary. Callers that want a mid-lifecycle reset
    // assign `*self = Decompressor::None`.

    // TODO(port): narrow error set
    pub fn update_buffers(
        &mut self,
        encoding: Encoding,
        buffer: &[u8],
        body_out_str: &mut MutableString,
    ) -> Result<(), bun_core::Error> {
        if !encoding.is_compressed() {
            return Ok(());
        }

        if matches!(self, Decompressor::None) {
            // SAFETY: `buffer`/`body_out_str` are the request's compressed_body
            // and caller-owned output; both outlive `self` (see `seat` contract).
            let (input, out) = unsafe { seat(buffer, &mut body_out_str.list) };
            match encoding {
                Encoding::Gzip | Encoding::Deflate => {
                    let mut reader = ZlibReaderArrayList::init_with_options_and_list_allocator(
                        input,
                        out,
                        // PORT NOTE: Zig passed `body_out_str.allocator` and
                        // `bun.http.default_allocator`; dropped per §Allocators.
                        bun_zlib::Options {
                            // gzip: MAX_WBITS | 16. zlib-wrapped deflate: 0 (inflate
                            // reads the window from the header). Raw deflate: -MAX_WBITS.
                            window_bits: if encoding == Encoding::Gzip {
                                bun_zlib::MAX_WBITS | 16
                            } else if has_zlib_header(buffer) {
                                0
                            } else {
                                -bun_zlib::MAX_WBITS
                            },
                            ..Default::default()
                        },
                    )?;
                    reader.max_output_size = MAX_DECOMPRESSED_BODY_SIZE;
                    *self = Decompressor::Zlib(reader);
                    return Ok(());
                }
                Encoding::Brotli => {
                    let mut reader = BrotliReaderArrayList::new_with_options(
                        input,
                        out,
                        // PORT NOTE: Zig passed `body_out_str.allocator`; dropped per §Allocators.
                        &Default::default(),
                    )?;
                    reader.max_output_size = MAX_DECOMPRESSED_BODY_SIZE;
                    *self = Decompressor::Brotli(reader);
                    return Ok(());
                }
                Encoding::Zstd => {
                    let mut reader = ZstdReaderArrayList::init_with_list_allocator(
                        input,
                        out,
                        // PORT NOTE: Zig passed `body_out_str.allocator` and
                        // `bun.http.default_allocator`; dropped per §Allocators.
                    )?;
                    reader.max_output_size = MAX_DECOMPRESSED_BODY_SIZE;
                    *self = Decompressor::Zstd(reader);
                    return Ok(());
                }
                _ => unreachable!("Invalid encoding. This code should not be reachable"),
            }
        }

        match self {
            Decompressor::Zlib(reader) => {
                debug_assert!(reader.zlib.avail_in == 0);
                reader.zlib.next_in = buffer.as_ptr();
                reader.zlib.avail_in = buffer.len() as u32;

                let initial = body_out_str.list.len();
                // PORT NOTE: Zig `expandToCapacity()` set `len = capacity` so the
                // zlib output pointers could write into the spare region while
                // `read_all` later truncated back to `total_out`. `read_all`'s
                // grow-on-avail_out==0 path reads `list_ptr.len()` to compute the
                // resume offset, so this `set_len(capacity)` is load-bearing —
                // skipping it leaves `len == initial` and the next grow rewinds
                // `next_out` to `ptr + initial`, overwriting freshly-inflated
                // bytes (observed as mid-stream gzip/deflate corruption when a
                // streamed body chunk decompresses past the reused buffer's
                // capacity).
                if body_out_str.list.capacity() == initial {
                    body_out_str.list.reserve(4096);
                }
                // PORT NOTE: Zig `reader.list = body_out_str.list` aliased the
                // ArrayListUnmanaged header by value. The Rust reader keeps a
                // `&mut Vec<u8>` instead; re-seat it in case the response buffer
                // was swapped between chunks. After re-seating, derive
                // `next_out`/`avail_out` from `reader.list_ptr` (NOT
                // `body_out_str.list`) — taking a fresh `&mut body_out_str.list`
                // would invalidate the just-stored `&'static mut` under stacked
                // borrows.
                // SAFETY: see `seat` contract — same buffer pair as initial seat.
                let (_, out) = unsafe { seat(buffer, &mut body_out_str.list) };
                reader.list_ptr = out;
                // SAFETY: zlib writes the tail; `read_all` truncates to `total_out` before any read.
                // `additional = 0`: the conditional reserve above already grew the buffer; `reserve(0)` is a no-op.
                // `list_ptr.len() == initial` here (reserve does not change len), so the helper's internal `prev` matches.
                let (next_out, avail_out) = unsafe { reader.list_ptr.reserve_expand_tail(0) };
                reader.zlib.next_out = next_out;
                reader.zlib.avail_out = avail_out as u32;
                // we reset the total out so we can track how much we decompressed this time
                reader.zlib.total_out = initial as _;
            }
            Decompressor::Brotli(reader) => {
                let initial = body_out_str.list.len();
                // SAFETY: see `seat` contract — same buffer pair as initial seat.
                let (input, out) = unsafe { seat(buffer, &mut body_out_str.list) };
                reader.input = input;
                reader.total_in = 0;
                // PORT NOTE: Zig aliased the ArrayList header; re-seat list_ptr instead.
                reader.list_ptr = out;
                reader.total_out = initial;
            }
            Decompressor::Zstd(reader) => {
                let initial = body_out_str.list.len();
                // SAFETY: see `seat` contract — same buffer pair as initial seat.
                let (input, out) = unsafe { seat(buffer, &mut body_out_str.list) };
                reader.input = input;
                reader.total_in = 0;
                // PORT NOTE: Zig aliased the ArrayList header; re-seat list_ptr instead.
                reader.list_ptr = out;
                reader.total_out = initial;
            }
            Decompressor::None => {
                unreachable!("Invalid encoding. This code should not be reachable")
            }
        }

        Ok(())
    }

    // TODO(port): narrow error set
    pub fn read_all(&mut self, is_done: bool) -> Result<(), bun_core::Error> {
        match self {
            Decompressor::Zlib(zlib) => zlib.read_all(is_done)?,
            Decompressor::Brotli(brotli) => brotli.read_all(is_done)?,
            Decompressor::Zstd(reader) => reader.read_all(is_done)?,
            Decompressor::None => {}
        }
        Ok(())
    }
}

// ported from: src/http/Decompressor.zig
