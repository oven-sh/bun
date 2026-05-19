#[derive(Copy, Clone)]
struct Str {
    ptr: *const u8,
    len: usize,
}

impl Str {
    pub fn new(bytes: &[u8]) -> Self {
        Self {
            ptr: bytes.as_ptr(),
            len: bytes.len(),
        }
    }

    pub fn as_ptr(&self) -> *const u8 {
        self.ptr
    }

    pub fn len(&self) -> usize {
        self.len
    }
}

struct EString {
    pub data: Str,
    pub is_utf16: bool,
}

impl EString {
    pub fn init_utf16(data: &[u16]) -> Self {
        let all_bytes = cast_u16_slice_to_u8(data);
        let narrowed_bytes = &all_bytes[..data.len()];
        Self {
            data: Str::new(narrowed_bytes),
            is_utf16: true,
        }
    }

    pub fn slice16(&self) -> &[u16] {
        debug_assert!(self.is_utf16);
        unsafe { core::slice::from_raw_parts(self.data.as_ptr().cast::<u16>(), self.data.len()) }
    }
}

fn cast_u16_slice_to_u8(data: &[u16]) -> &[u8] {
    unsafe { core::slice::from_raw_parts(data.as_ptr().cast::<u8>(), data.len() * 2) }
}

fn main() {
    let utf16 = [0x1234u16, 0x5678u16];

    // Mirrors `src/ast/e.rs:1449-1459`: cast the full `&[u16]` to bytes, then
    // deliberately store a byte slice whose length is the u16 element count
    // rather than the byte count. `slice16()` later expands that range back to
    // `len` u16s, which is twice as many bytes as the stored `Str` provenance
    // covered.
    let source_shaped = EString::init_utf16(&utf16);

    let first = source_shaped.slice16()[0];
    std::hint::black_box(first);
}
