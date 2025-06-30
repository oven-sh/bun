const Error = error{MaxPathExceeded};

check_length: CheckLength = .assume_always_less_than_max_path,
normalize_slashes: bool = false,
// buf_type: enum { pool, array_list },

const CheckLength = enum {
    assume_always_less_than_max_path,
    check_for_greater_than_max_path,
};

pub fn ResultFn(comptime opts: @This()) fn (comptime T: type) type {
    return struct {
        pub fn Result(comptime T: type) type {
            return switch (opts.check_length) {
                .assume_always_less_than_max_path => T,
                .check_for_greater_than_max_path => Error!T,
            };
        }
    }.Result;
}

// pub fn BufType(comptime opts: @This()) type {
//     return switch (opts.buf_type) {
//         .stack_buffer => struct {
//             buf: PathBuffer,
//             len: u16,
//         },
//         .pool => struct {
//             buf: *PathBuffer,
//             len: u16,
//         },
//         .array_list => struct {
//             list: std.ArrayListUnmanaged(u8),
//         },
//     };
// }
