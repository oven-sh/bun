const std = @import("std");
const VariablePosition = @import("../data/variable_position.zig").VariablePosition;

/// Count left whitespace inside ${...} for trimming.
/// This replicates the C++ logic: it starts at variable_start and walks backwards to start_brace.
pub fn getWhiteSpaceOffsetLeft(value: []const u8, interpolation: *const VariablePosition) usize {
    var tmp = interpolation.variable_start;
    var size: usize = 0;
    while (tmp >= interpolation.start_brace) {
        if (value[tmp] != ' ') break;
        size += 1;
        if (tmp == 0) break;
        tmp -= 1;
    }
    return size;
}

/// Count right whitespace inside ${...} for trimming.
/// This replicates the C++ logic: it starts at end_brace - 1 and walks backwards to start_brace.
pub fn getWhiteSpaceOffsetRight(value: []const u8, interpolation: *const VariablePosition) usize {
    if (interpolation.end_brace == 0) return 0;
    var tmp = interpolation.end_brace - 1;
    var count: usize = 0;
    while (tmp >= interpolation.start_brace) {
        if (value[tmp] != ' ') break;
        count += 1;
        if (tmp == 0) break;
        tmp -= 1;
    }
    return count;
}

test "getWhiteSpaceOffsetLeft" {
    const value = "${ NAME}";
    // $ at 0, { at 1, ' ' at 2, N at 3
    var pos = VariablePosition.init(2, 1, 0);

    // checks index 2 (' '), index 1 ('{'). returns 1.
    try std.testing.expectEqual(@as(usize, 1), getWhiteSpaceOffsetLeft(value, &pos));
}

test "getWhiteSpaceOffsetRight" {
    const value = "${NAME }";
    // $ at 0, { at 1, N at 2, A at 3, M at 4, E at 5, ' ' at 6, } at 7
    var pos = VariablePosition.init(2, 1, 0);
    pos.end_brace = 7;

    // checks index 6 (' '), index 5 ('E'). returns 1.
    try std.testing.expectEqual(@as(usize, 1), getWhiteSpaceOffsetRight(value, &pos));
}
