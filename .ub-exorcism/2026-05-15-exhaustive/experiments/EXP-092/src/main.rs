// Source-shaped mirror of src/runtime/webcore/streams.rs:2533-2597.
// The important property is that constructing a raw slice pointer is safe, and
// the conversion method is safe. A safe caller can therefore present a non-buf
// pointer that is not an owned default-allocator allocation.

enum StreamResult {
    Owned(Vec<u8>),
    IntoArray(usize),
}

enum ReadResult {
    Read(*mut [u8]),
}

impl ReadResult {
    fn to_stream(self, buf: &mut [u8]) -> StreamResult {
        match self {
            ReadResult::Read(slice) => {
                let slice_ptr = slice.cast::<u8>();
                let slice_len = slice.len();
                let owned = slice_ptr.cast_const() != buf.as_ptr();
                if owned {
                    // Same shape as streams.rs:2595-2597.
                    StreamResult::Owned(unsafe {
                        Vec::from_raw_parts(slice_ptr, slice_len, slice_len)
                    })
                } else {
                    StreamResult::IntoArray(slice_len)
                }
            }
        }
    }
}

fn main() {
    let mut buf = [0u8; 4];
    let mut stack = [1u8, 2, 3, 4];

    // Entirely safe: create a raw fat pointer to stack memory and call the safe
    // conversion method. The method treats it as an owned Vec allocation because
    // it is disjoint from `buf`.
    let raw_stack_slice: *mut [u8] = &mut stack[..] as *mut [u8];
    let result = ReadResult::Read(raw_stack_slice).to_stream(&mut buf[..]);

    if let StreamResult::Owned(v) = result {
        drop(v); // Miri: deallocating stack / non-allocated memory as Vec storage.
    }
}
