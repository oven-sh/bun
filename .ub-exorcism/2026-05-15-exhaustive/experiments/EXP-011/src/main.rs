#![deny(unsafe_op_in_unsafe_fn)]

/// Model the current `bun_picohttp::Request::parse` source shape:
///
/// - caller passes the HTTP request buffer as `&[u8]`
/// - C parser returns a `*const u8` pointing into that shared slice
/// - wrapper casts it to `*mut u8` and writes a NUL terminator after the path
///
/// This intentionally does not model picohttpparser itself. The question is
/// whether the final write is legal when the only provenance available is from
/// `buf.as_ptr()` on a shared borrow.
fn parse_like_bun_picohttp(buf: &[u8]) {
    let path_ptr: *const u8 = unsafe { buf.as_ptr().add(4) }; // after "GET "
    let path_len = 2usize; // "/x"

    unsafe {
        path_ptr.cast_mut().add(path_len).write(0);
    }
}

fn main() {
    let backing = *b"GET /x HTTP/1.1\r\n\r\n";
    parse_like_bun_picohttp(&backing);
}
