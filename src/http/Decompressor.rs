use bun_http_types::Encoding::Encoding;
use bun_string::MutableString;

use bun_zlib::ZlibReaderArrayList;
use bun_brotli::BrotliReaderArrayList;
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
/// MODULE INVARIANT (single point of unsafe): the `Decompressor` is owned by
/// the surrounding `HTTPClient` request lifecycle and is dropped (or reset to
/// `None`) in `InternalState::deinit` *before* either `compressed_body` or
/// `body_out_str` is freed. Every call site in [`Decompressor::update_buffers`]
/// passes exactly that pair, so the erased borrows never dangle. The output
/// `Vec` is uniquely borrowed by the active reader (the only other access is
/// the immediate re-seat on the next chunk, which overwrites `list_ptr`).
#[inline(always)]
fn seat<'a>(input: &'a [u8], out: &'a mut Vec<u8>) -> (&'static [u8], &'static mut Vec<u8>) {
    // SAFETY: see MODULE INVARIANT above.
    unsafe { (bun_ptr::detach_lifetime(input), &mut *(out as *mut Vec<u8>)) }
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
            let (input, out) = seat(buffer, &mut body_out_str.list);
            match encoding {
                Encoding::Gzip | Encoding::Deflate => {
                    let reader = ZlibReaderArrayList::init_with_options_and_list_allocator(
                        input,
                        out,
                        // PORT NOTE: Zig passed `body_out_str.allocator` and
                        // `bun.http.default_allocator`; dropped per §Allocators.
                        bun_zlib::Options {
                            // zlib.MAX_WBITS = 15
                            // to (de-)compress deflate format, use wbits = -zlib.MAX_WBITS
                            // to (de-)compress deflate format with headers we use wbits = 0 (we can detect the first byte using 120)
                            // to (de-)compress gzip format, use wbits = zlib.MAX_WBITS | 16
                            window_bits: if encoding == Encoding::Gzip {
                                bun_zlib::MAX_WBITS | 16
                            } else if buffer.len() > 1 && buffer[0] == 120 {
                                0
                            } else {
                                -bun_zlib::MAX_WBITS
                            },
                            ..Default::default()
                        },
                    )?;
                    *self = Decompressor::Zlib(reader);
                    return Ok(());
                }
                Encoding::Brotli => {
                    let reader = BrotliReaderArrayList::new_with_options(
                        input,
                        out,
                        // PORT NOTE: Zig passed `body_out_str.allocator`; dropped per §Allocators.
                        Default::default(),
                    )?;
                    *self = Decompressor::Brotli(reader);
                    return Ok(());
                }
                Encoding::Zstd => {
                    let reader = ZstdReaderArrayList::init_with_list_allocator(
                        input, out,
                        // PORT NOTE: Zig passed `body_out_str.allocator` and
                        // `bun.http.default_allocator`; dropped per §Allocators.
                    )?;
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
                let (_, out) = seat(buffer, &mut body_out_str.list);
                reader.list_ptr = out;
                // expandToCapacity:
                // SAFETY: capacity bytes are allocated; zlib initializes
                // `[initial, capacity)` before `read_all`'s defer truncates
                // `len` back to `total_out`, so no uninitialized byte is ever
                // observed at the truncated length.
                unsafe { reader.list_ptr.set_len(reader.list_ptr.capacity()) };
                // SAFETY: `initial <= len <= capacity`; the offset is within the
                // allocation and `read_all` only writes into `[initial, capacity)`.
                reader.zlib.next_out = unsafe { reader.list_ptr.as_mut_ptr().add(initial) };
                reader.zlib.avail_out = (reader.list_ptr.capacity() - initial) as u32;
                // we reset the total out so we can track how much we decompressed this time
                reader.zlib.total_out = initial as _;
            }
            Decompressor::Brotli(reader) => {
                let initial = body_out_str.list.len();
                let (input, out) = seat(buffer, &mut body_out_str.list);
                reader.input = input;
                reader.total_in = 0;
                // PORT NOTE: Zig aliased the ArrayList header; re-seat list_ptr instead.
                reader.list_ptr = out;
                reader.total_out = initial;
            }
            Decompressor::Zstd(reader) => {
                let initial = body_out_str.list.len();
                let (input, out) = seat(buffer, &mut body_out_str.list);
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
