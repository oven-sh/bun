const std = @import("std");
const Error = error{MaxPathExceeded};

check_length: CheckLength = .assume_always_less_than_max_path,
// TODO: should `auto` be the default?
path_separators: PathSeparators = .any,
// buf_type: enum { pool, array_list },

const PathSeparators = enum {
    any,
    auto,
    posix,
    windows,

    pub fn char(comptime sep: @This()) u8 {
        return switch (sep) {

            // the existing separator should be used
            .any => comptime unreachable,

            .auto => std.fs.path.sep,
            .posix => std.fs.path.sep_posix,
            .windows => std.fs.path.sep_windows,
        };
    }
};

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
