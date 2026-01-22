// See https://bjoern.hoehrmann.de/utf-8/decoder/dfa/
// and licenses/LICENSE_Bjoern_Hoehrmann

const UTF8_ACCEPT = 0;
const UTF8_REJECT = 12;

// The first part of the table maps bytes to character classes to reduce the
// size of the transition table and create bitmasks.
// zig fmt: off
const utf8d = [_]u8{
   0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
   0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
   0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
   0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,  0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,
   1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,  9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,
   7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
   8,8,2,2,2,2,2,2,2,2,2,2,2,2,2,2,  2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,
  10,3,3,3,3,3,3,3,3,3,3,3,3,4,3,3, 11,6,6,6,5,8,8,8,8,8,8,8,8,8,8,8,
};

// The second part is a transition table that maps a combination of a state of
// the automaton and a character class to a state.
const state_utf8d = [_]u8{
   0,12,24,36,60,96,84,12,12,12,48,72, 12,12,12,12,12,12,12,12,12,12,12,12,
  12, 0,12,12,12,12,12, 0,12, 0,12,12, 12,24,12,12,12,12,12,24,12,24,12,12,
  12,12,12,12,12,12,12,24,12,12,12,12, 12,24,12,12,12,12,12,12,12,24,12,12,
  12,12,12,12,12,12,12,36,12,36,12,12, 12,36,12,12,12,12,12,36,12,36,12,12,
  12,36,12,12,12,12,12,12,12,12,12,12,
};
// zig fmt: on

fn decodeByte(state: *usize, cp: *u21, byte: u8) void {
    const class: std.math.IntFittingRange(0, 11) = @intCast(utf8d[byte]);
    const mask: u21 = 0xff;

    cp.* = if (state.* != UTF8_ACCEPT)
        (byte & 0x3f) | (cp.* << 6)
    else
        (mask >> class) & byte;

    state.* = state_utf8d[state.* + class];
}

fn isDoneDecoding(state: usize) bool {
    return state == UTF8_ACCEPT or state == UTF8_REJECT;
}

pub const Iterator = struct {
    // This "i" is part of the documented API of this iterator, pointing to the
    // current location of the iterator in `bytes`.
    i: usize = 0,
    bytes: []const u8,

    const Self = @This();

    pub fn init(bytes: []const u8) Self {
        return .{
            .bytes = bytes,
        };
    }

    pub fn next(self: *Self) ?u21 {
        if (self.i >= self.bytes.len) return null;

        var cp: u21 = 0;
        var state: usize = UTF8_ACCEPT;

        while (true) {
            decodeByte(&state, &cp, self.bytes[self.i]);
            self.i += 1;
            if (isDoneDecoding(state) or self.i >= self.bytes.len) break;
        }

        if (state == UTF8_ACCEPT) return cp;
        return 0xFFFD; // Replacement character
    }

    pub fn peek(self: Self) ?u21 {
        var it = self;
        return it.next();
    }
};

test "Iterator for ascii" {
    var it = Iterator.init("abc");
    try std.testing.expectEqual('a', it.next());
    try std.testing.expectEqual(1, it.i);
    try std.testing.expectEqual('b', it.peek());
    try std.testing.expectEqual('b', it.next());
    try std.testing.expectEqual('c', it.next());
    try std.testing.expectEqual(null, it.peek());
    try std.testing.expectEqual(null, it.next());
    try std.testing.expectEqual(null, it.next());
}

test "Iterator for emoji" {
    var it = Iterator.init("😀😅😻👺");
    try std.testing.expectEqual(0x1F600, it.next());
    try std.testing.expectEqual(4, it.i);
    try std.testing.expectEqual(0x1F605, it.next());
    try std.testing.expectEqual(8, it.i);
    try std.testing.expectEqual(0x1F63B, it.next());
    try std.testing.expectEqual(12, it.i);
    try std.testing.expectEqual(0x1F47A, it.next());
    try std.testing.expectEqual(16, it.i);
    try std.testing.expectEqual(null, it.next());
    try std.testing.expectEqual(16, it.i);
}

test "Iterator overlong utf8" {
    var it = Iterator.init("\xf0\x80\x80\xaf");
    try std.testing.expectEqual(0xFFFD, it.next());
    try std.testing.expectEqual(0xFFFD, it.next());
    try std.testing.expectEqual(0xFFFD, it.next());
    try std.testing.expectEqual(null, it.next());
    try std.testing.expectEqual(null, it.next());
}

const std = @import("std");
