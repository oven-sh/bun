use core::ffi::{c_int, c_uint};

#[repr(C)]
struct Header {
    name: *const u8,
    name_len: c_uint,
    value: *const u8,
    value_len: c_uint,
    qpack_index: c_int,
}

impl Header {
    fn init(name: &[u8], value: &[u8], qpack_index: c_int) -> Header {
        Header {
            name: name.as_ptr(),
            name_len: name.len() as c_uint,
            value: value.as_ptr(),
            value_len: value.len() as c_uint,
            qpack_index,
        }
    }
}

fn main() {
    // Mirrors src/http/h3_client/encode.rs:58-107:
    // reserve request_headers + 4, set_len(4), push user headers, then assign
    // the four pseudo-header prefix slots through indexing.
    let mut headers: Vec<Header> = Vec::with_capacity(5);
    unsafe { headers.set_len(4) };

    headers.push(Header::init(b"accept", b"*/*", 29));

    // This is not initialization. Index assignment operates on an already-live
    // element slot, so Miri has to validate/drop/read the old Header value.
    headers[0] = Header::init(b":method", b"GET", 17);

    std::hint::black_box(headers.len());
}
