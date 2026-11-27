//! HPACK for packages/bun-uws/src/Http2Context.h.

use bun_hpack::{Decoder, Encoder, Error, Indexing};

use crate::quic::Header;

/// `": "` and the line end, so that the limits are those of HTTP/1.
const FIELD_OVERHEAD: usize = 4;

struct Hpack {
    encoder: Encoder,
    decoder: Decoder,
}

/// What the result of a call points into, until the next call.
#[derive(Default)]
struct HpackBuffer {
    bytes: Vec<u8>,
    fields: Vec<Header>,
    scratch: Vec<u8>,
}

#[repr(C)]
struct HeaderRef {
    name_offset: u32,
    name_len: u32,
    value_offset: u32,
    value_len: u32,
}

#[repr(C)]
struct Limits {
    size: usize,
    fields: usize,
    hard_size: usize,
    hard_fields: usize,
}

#[repr(u8)]
enum Status {
    Complete,
    OverLimit,
    OverHardLimit,
    Malformed,
}

#[repr(C)]
struct Decoded {
    fields: *const Header,
    count: u32,
    status: Status,
}

#[repr(C)]
struct Encoded {
    bytes: *const u8,
    len: usize,
}

fn copy_to<'a>(room: &mut &'a mut [u8], bytes: &[u8]) -> &'a [u8] {
    let copy;
    (copy, *room) = core::mem::take(room).split_at_mut(bytes.len());
    copy.copy_from_slice(bytes);
    copy
}

impl HpackBuffer {
    fn decode(&mut self, decoder: &mut Decoder, block: &[u8], limits: &Limits) -> Status {
        self.bytes.resize(limits.size, 0);
        self.fields.clear();
        let mut room = self.bytes.as_mut_slice();
        let (mut size, mut count) = (0, 0);
        let mut fields = decoder.decode(block, &mut self.scratch);
        loop {
            let field = match fields.next() {
                Ok(Some(field)) => field,
                Ok(None) if count == self.fields.len() => return Status::Complete,
                Ok(None) => return Status::OverLimit,
                Err(Error::FieldTooLong) => return Status::OverHardLimit,
                Err(Error::Malformed) => return Status::Malformed,
            };
            size += field.name.len() + field.value.len() + FIELD_OVERHEAD;
            count += 1;
            if size > limits.hard_size || count > limits.hard_fields {
                return Status::OverHardLimit;
            }
            if size <= limits.size && count <= limits.fields {
                let name = match field.static_index {
                    0 => copy_to(&mut room, field.name),
                    index => bun_hpack::static_name(index),
                };
                self.fields.push(Header {
                    qpack_index: field.static_index.into(),
                    ..Header::init(name, copy_to(&mut room, field.value), None)
                });
            }
        }
    }

    fn encode(
        &mut self,
        encoder: &mut Encoder,
        bytes: &[u8],
        fields: &[HeaderRef],
        indexing: Indexing,
    ) {
        let slice = |offset: u32, len: u32| &bytes[offset as usize..][..len as usize];
        self.bytes.clear();
        let mut block = encoder.block(&mut self.bytes);
        for field in fields {
            let name = slice(field.name_offset, field.name_len);
            block.field(name, slice(field.value_offset, field.value_len), indexing);
        }
    }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__create() -> Box<Hpack> {
    Box::new(Hpack {
        encoder: Encoder::with_history(),
        decoder: Decoder::new(),
    })
}

#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__destroy(_: Box<Hpack>) {}

#[unsafe(no_mangle)]
extern "C" fn Bun__HpackBuffer__create() -> Box<HpackBuffer> {
    Box::default()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__HpackBuffer__destroy(_: Box<HpackBuffer>) {}

#[unsafe(no_mangle)]
extern "C" fn Bun__Hpack__setPeerTableSize(hpack: &mut Hpack, size: u32) {
    hpack.encoder.set_max_table_size(size);
}

/// # Safety
/// `block` points to `len` bytes. It may be null if there are none.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__decode(
    hpack: &mut Hpack,
    buffer: &mut HpackBuffer,
    block: *const u8,
    len: usize,
    limits: &Limits,
) -> Decoded {
    // SAFETY: the contract of this function.
    let block = unsafe { bun_core::ffi::slice(block, len) };
    let status = buffer.decode(&mut hpack.decoder, block, limits);
    if !matches!(status, Status::Complete) {
        buffer.fields.clear();
    }
    Decoded {
        fields: buffer.fields.as_ptr(),
        count: buffer.fields.len() as u32,
        status,
    }
}

/// # Safety
/// `bytes` points to `len` bytes and `fields` to `count` items. Either may be null if there are none.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__Hpack__encode(
    hpack: &mut Hpack,
    buffer: &mut HpackBuffer,
    bytes: *const u8,
    len: usize,
    fields: *const HeaderRef,
    count: usize,
    may_index: bool,
) -> Encoded {
    // SAFETY: the contract of this function.
    let (bytes, fields) = unsafe {
        (
            bun_core::ffi::slice(bytes, len),
            bun_core::ffi::slice(fields, count),
        )
    };
    let indexing = if may_index {
        Indexing::Allowed
    } else {
        Indexing::Without
    };
    buffer.encode(&mut hpack.encoder, bytes, fields, indexing);
    Encoded {
        bytes: buffer.bytes.as_ptr(),
        len: buffer.bytes.len(),
    }
}
