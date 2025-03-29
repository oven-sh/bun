const std = @import("std");

/// contains name and value of a header (name == `null` if is a continuing line of
/// a multiline header)
pub const struct_phr_header = extern struct {
    name: [*c]const u8,
    name_len: usize,
    value: [*c]const u8,
    value_len: usize,
};
/// returns number of bytes consumed if successful, -2 if request is partial, -1
/// if failed
pub extern fn phr_parse_request(buf: [*c]const u8, len: usize, method: [*c][*c]const u8, method_len: [*c]usize, path: [*c][*c]const u8, path_len: [*c]usize, minor_version: [*c]c_int, headers: [*c]struct_phr_header, num_headers: [*c]usize, last_len: usize) c_int;
/// returns number of bytes consumed if successful, -2 if request is partial, -1
/// if failed
pub extern fn phr_parse_response(_buf: [*c]const u8, len: usize, minor_version: [*c]c_int, status: [*c]c_int, msg: [*c][*c]const u8, msg_len: [*c]usize, headers: [*c]struct_phr_header, num_headers: [*c]usize, last_len: usize) c_int;
/// returns number of bytes consumed if successful, -2 if request is partial, -1
/// if failed
pub extern fn phr_parse_headers(buf: [*c]const u8, len: usize, headers: [*c]struct_phr_header, num_headers: [*c]usize, last_len: usize) c_int;
pub const ChunkedDecoder = extern struct {
    bytes_left_in_chunk: usize = 0,
    consume_trailer: u8 = 0,
    _hex_count: u8 = 0,
    _state: u8 = 0,

    pub const Error = error{
        InvalidHTTPResponse,
    };

    /// Decode chunked data from the buffer.
    ///
    /// This method rewrites the buffer given as (`buf`, `bufsize`) in-place,
    /// removing chunked-encoding headers.  Callers should repeatedly call this
    /// method when it returns `null`, every time supplying newly
    /// arrived data. When the end of chunked-encoded data is found, returns the
    /// number of octets left uncoded, that starts from the end of `buf`.
    pub fn decodeChunked(self: *ChunkedDecoder, buf: [*]u8, bufsize: *usize) Error!?usize {
        return switch (phr_decode_chunked(self, buf, bufsize)) {
            -1 => error.InvalidHTTPResponse,
            -2 => null,
            else => |len| blk: {
                std.debug.assert(len >= 0);
                break :blk @intCast(len);
            },
        };
    }

    /// Returns true if the decoder is in the middle of chunked data
    pub fn isInData(self: *ChunkedDecoder) bool {
        @branchHint(.likely);
        return phr_decode_chunked_is_in_data(self) != 0;
    }

    /// the function rewrites the buffer given as (buf, bufsz) removing the chunked-
    /// encoding headers.  When the function returns without an error, bufsz is
    /// updated to the length of the decoded data available.  Applications should
    /// repeatedly call the function while it returns -2 (incomplete) every time
    /// supplying newly arrived data.  If the end of the chunked-encoded data is
    /// found, the function returns a non-negative number indicating the number of
    /// octets left undecoded, that starts from the offset returned by `*bufsz`.
    /// Returns -1 on error.
    extern fn phr_decode_chunked(decoder: *ChunkedDecoder, buf: [*]u8, bufsz: *usize) isize;
    extern fn phr_decode_chunked_is_in_data(decoder: *ChunkedDecoder) c_int;
};

pub const phr_header = struct_phr_header;
