pub const ReadResult = enum {
    success,
    empty,
    fail,
    comment_encountered,
    end_of_stream_key,
    end_of_stream_value,
};

pub const FinalizeResult = enum {
    interpolated,
    copied,
    circular,
};

test "ReadResult enum values" {
    try std.testing.expect(@intFromEnum(ReadResult.success) == 0);
}

const std = @import("std");