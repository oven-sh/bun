const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;

pub const OutputCompression = enum {
    none,
    gzip,
    brotli,

    pub fn fromString(str: []const u8) ?OutputCompression {
        if (strings.eqlComptime(str, "gzip")) return .gzip;
        if (strings.eqlComptime(str, "brotli")) return .brotli;
        if (strings.eqlComptime(str, "none")) return .none;
        return null;
    }

    pub fn extension(self: OutputCompression) []const u8 {
        return switch (self) {
            .none => "",
            .gzip => ".gz",
            .brotli => ".br",
        };
    }

    pub fn canCompress(self: OutputCompression) bool {
        return self != .none;
    }
};
