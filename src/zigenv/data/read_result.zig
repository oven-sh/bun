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
    const std = @import("std");
    try std.testing.expect(@intFromEnum(ReadResult.success) == 0);
}
