use bun_brotli::BrotliReaderArrayList;
use bun_http_types::Encoding;
use bun_str::MutableString;
use bun_zlib::{self as zlib, ZlibReaderArrayList};
use bun_zstd::ZstdReaderArrayList;

#[derive(Default)]
pub enum Decompressor {
    Zlib(Box<ZlibReaderArrayList>),
    Brotli(Box<BrotliReaderArrayList>),
    Zstd(Box<ZstdReaderArrayList>),
    #[default]
    None,
}

impl Decompressor {
    // PORT NOTE: Zig `deinit` called `that.deinit()` on the active reader and reset to `.none`.
    // In Rust the `Box<_>` payloads drop automatically, so no explicit `Drop` impl is needed.
    // If callers relied on explicit mid-lifecycle reset, they should assign
    // `*self = Decompressor::None` (which drops the old reader).

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
            match encoding {
                Encoding::Gzip | Encoding::Deflate => {
                    let reader = ZlibReaderArrayList::init_with_options_and_list_allocator(
                        buffer,
                        &mut body_out_str.list,
                        // PORT NOTE: Zig passed `body_out_str.allocator` and
                        // `bun.http.default_allocator`; dropped per §Allocators.
                        zlib::Options {
                            // zlib.MAX_WBITS = 15
                            // to (de-)compress deflate format, use wbits = -zlib.MAX_WBITS
                            // to (de-)compress deflate format with headers we use wbits = 0 (we can detect the first byte using 120)
                            // to (de-)compress gzip format, use wbits = zlib.MAX_WBITS | 16
                            window_bits: if encoding == Encoding::Gzip {
                                zlib::MAX_WBITS | 16
                            } else if buffer.len() > 1 && buffer[0] == 120 {
                                0
                            } else {
                                -zlib::MAX_WBITS
                            },
                            ..Default::default()
                        },
                    )?;
                    *self = Decompressor::Zlib(reader);
                    return Ok(());
                }
                Encoding::Brotli => {
                    let reader = BrotliReaderArrayList::new_with_options(
                        buffer,
                        &mut body_out_str.list,
                        // PORT NOTE: Zig passed `body_out_str.allocator`; dropped per §Allocators.
                        Default::default(),
                    )?;
                    *self = Decompressor::Brotli(reader);
                    return Ok(());
                }
                Encoding::Zstd => {
                    let reader = ZstdReaderArrayList::init_with_list_allocator(
                        buffer,
                        &mut body_out_str.list,
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
                // TODO(port): `expandToCapacity` sets len = capacity on a Zig ArrayListUnmanaged.
                // MutableString's Rust port must expose an equivalent (unsafe set_len to capacity).
                body_out_str.list.expand_to_capacity();
                if body_out_str.list.capacity() == initial {
                    body_out_str.list.reserve(4096);
                    body_out_str.list.expand_to_capacity();
                }
                // TODO(port): Zig copies the `ArrayListUnmanaged` struct (ptr/len/cap) by value so
                // `reader.list` aliases `body_out_str.list`'s backing buffer. Rust `Vec` ownership
                // forbids this; the reader types need to borrow `&mut Vec<u8>` instead. Phase B must
                // reshape `ZlibReaderArrayList.list` (and siblings) accordingly.
                reader.list = body_out_str.list;
                // SAFETY: `initial < list.len()` after expand_to_capacity (capacity > initial path above).
                reader.zlib.next_out = unsafe { body_out_str.list.as_mut_ptr().add(initial) };
                reader.zlib.avail_out = (body_out_str.list.capacity() - initial) as u32;
                // we reset the total out so we can track how much we decompressed this time
                reader.zlib.total_out = initial as u32;
            }
            Decompressor::Brotli(reader) => {
                reader.input = buffer;
                reader.total_in = 0;

                let initial = body_out_str.list.len();
                // TODO(port): same ArrayListUnmanaged-by-value aliasing as the zlib arm above.
                reader.list = body_out_str.list;
                reader.total_out = initial as u32;
            }
            Decompressor::Zstd(reader) => {
                reader.input = buffer;
                reader.total_in = 0;

                let initial = body_out_str.list.len();
                // TODO(port): same ArrayListUnmanaged-by-value aliasing as the zlib arm above.
                reader.list = body_out_str.list;
                reader.total_out = initial as u32;
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/Decompressor.zig (119 lines)
//   confidence: medium
//   todos:      6
//   notes:      reader.list = body_out_str.list aliases a Vec by value; Phase B must reshape reader types to borrow &mut Vec<u8>
// ──────────────────────────────────────────────────────────────────────────
