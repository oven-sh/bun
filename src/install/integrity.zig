const std = @import("std");
const builtin = @import("builtin");
const strings = @import("../string_immutable.zig");
const Crypto = @import("../sha.zig").Hashers;
const Yarn = @import("./lockfile.zig").Yarn;

pub const Integrity = extern struct {
    tag: Tag = Tag.unknown,
    /// Possibly a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value initially
    /// We transform it though.
    value: [digest_buf_len]u8 = undefined,

    const Base64 = std.base64.standard_no_pad;

    pub const digest_buf_len: usize = brk: {
        const values = [_]usize{
            std.crypto.hash.Sha1.digest_length,
            std.crypto.hash.sha2.Sha512.digest_length,
            std.crypto.hash.sha2.Sha256.digest_length,
            std.crypto.hash.sha2.Sha384.digest_length,
        };

        var value: usize = 0;
        for (values) |val| {
            value = @max(val, value);
        }

        break :brk value;
    };

    pub fn parseSHASum(buf: []const u8) !Integrity {
        if (buf.len == 0) {
            return Integrity{
                .tag = Tag.unknown,
                .value = undefined,
            };
        }

        // e.g. "3cd0599b099384b815c10f7fa7df0092b62d534f"
        var integrity = Integrity{ .tag = Tag.sha1 };
        const end: usize = @min("3cd0599b099384b815c10f7fa7df0092b62d534f".len, buf.len);
        var out_i: usize = 0;
        var i: usize = 0;

        {
            std.mem.set(u8, &integrity.value, 0);
        }

        while (i < end) {
            const x0 = @as(u16, switch (buf[i]) {
                '0'...'9' => buf[i] - '0',
                'A'...'Z' => buf[i] - 'A' + 10,
                'a'...'z' => buf[i] - 'a' + 10,
                else => return error.InvalidCharacter,
            });
            i += 1;

            const x1 = @as(u16, switch (buf[i]) {
                '0'...'9' => buf[i] - '0',
                'A'...'Z' => buf[i] - 'A' + 10,
                'a'...'z' => buf[i] - 'a' + 10,
                else => return error.InvalidCharacter,
            });

            // parse hex integer
            integrity.value[out_i] = @truncate(u8, x0 << 4 | x1);

            out_i += 1;
            i += 1;
        }

        return integrity;
    }

    pub fn parse(buf: []const u8) !Integrity {
        if (buf.len < "sha256-".len) {
            return Integrity{
                .tag = Tag.unknown,
                .value = undefined,
            };
        }

        var out: [digest_buf_len]u8 = undefined;
        const tag = Tag.parse(buf);
        if (tag == Tag.unknown) {
            return Integrity{
                .tag = Tag.unknown,
                .value = undefined,
            };
        }

        Base64.Decoder.decode(&out, std.mem.trimRight(u8, buf["sha256-".len..], "=")) catch {
            return Integrity{
                .tag = Tag.unknown,
                .value = undefined,
            };
        };

        return Integrity{ .value = out, .tag = tag };
    }

    /// Matches sha(1|256|384|512) in a manner one could describe as "blazingly fast".
    /// Returns an Integrity object, and leaves the `cur` object pointing after the last equal sign
    pub fn yarn_parse(cur: *[]u8, sentinels_start: usize) !Integrity {
        if (!Yarn.advanceOver(cur, " sha")) return error.@"Unknown Integrity type";
        // it would be cool if we made npm use this, but the yarn parser assumes that we overallocate
        // and place sentinels at the end of the buffer pointed into by `cur`. That means we can avoid
        // bounds checks.

        // Put this in our instruction cache rather than our data cache, since it is only a u64 :)
        const matchers = comptime blk: {
            var data = [4]u16{ @bitCast(u16, [2]u8{ '1', '2' }), @bitCast(u16, [2]u8{ '8', '4' }), @bitCast(u16, [2]u8{ '5', '6' }), @bitCast(u16, [2]u8{ 0, 0 }) };

            if (builtin.target.cpu.arch.endian() == .Big) { // untested, but I think this is right
                std.mem.reverse(u16, &data);
            }

            break :blk @bitCast(std.meta.Int(.unsigned, data.len * 16), data);
        };

        const i = cur.*[0] -% '1';
        // error for any character that isn't '1', '2', '3', or '5'
        if (i > 4 or i == 3) return error.@"Unknown Integrity type";
        const tag = @intToEnum(Integrity.Tag, i + @boolToInt(cur.*[0] != '5'));
        const matcher = @truncate(u16, matchers >> @intCast(std.math.Log2Int(@TypeOf(matchers)), (4 - @enumToInt(tag)) << 4));
        comptime std.debug.assert(Yarn.over_allocated_space >= 2);
        const mismatch = matcher != @bitCast(u16, cur.*[1..3].*);
        if (i != 0 and mismatch) return error.@"Unknown sha type.";
        cur.* = cur.*[if (i != 0) 3 else 1..];
        if (cur.*[0] != '-') return error.@"Missing integrity hash after sha prefix.";
        cur.* = cur.*[1..];

        const hash_start = cur.*;
        Yarn.advanceUntilAny(cur, "=", false) catch unreachable;

        if (Yarn.sentinelCmp(@ptrToInt(&cur.*[0]), sentinels_start, '='))
            return error.@"Found unterminated integrity sha hash";

        var value: [Integrity.digest_buf_len]u8 = undefined;
        Base64.Decoder.decode(&value, hash_start[0 .. @ptrToInt(&cur.*[0]) - @ptrToInt(hash_start.ptr)]) catch return error.@"Invalid integrity hash";
        while (true) {
            cur.* = cur.*[1..]; // skip over '=' characters
            if (cur.*[0] != '=') break;
        }
        return Integrity{ .value = value, .tag = tag };
    }

    pub const Tag = enum(u8) {
        unknown = 0,
        /// "shasum" in the metadata
        sha1 = 1,
        /// The value is a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value
        sha256 = 2,
        /// The value is a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value
        sha384 = 3,
        /// The value is a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value
        sha512 = 4,

        _,

        pub inline fn isSupported(this: Tag) bool {
            return @enumToInt(this) >= @enumToInt(Tag.sha1) and @enumToInt(this) <= @enumToInt(Tag.sha512);
        }

        pub fn parse(buf: []const u8) Tag {
            const Matcher = strings.ExactSizeMatcher(8);

            const i = std.mem.indexOfScalar(u8, buf[0..@min(buf.len, 7)], '-') orelse return Tag.unknown;

            return switch (Matcher.match(buf[0..i])) {
                Matcher.case("sha1") => Tag.sha1,
                Matcher.case("sha256") => Tag.sha256,
                Matcher.case("sha384") => Tag.sha384,
                Matcher.case("sha512") => Tag.sha512,
                else => .unknown,
            };
        }

        pub inline fn digestLen(this: Tag) usize {
            return switch (this) {
                .sha1 => std.crypto.hash.Sha1.digest_length,
                .sha512 => std.crypto.hash.sha2.Sha512.digest_length,
                .sha256 => std.crypto.hash.sha2.Sha256.digest_length,
                .sha384 => std.crypto.hash.sha2.Sha384.digest_length,
                else => 0,
            };
        }
    };

    pub fn slice(
        this: *const Integrity,
    ) []const u8 {
        return this.value[0..this.tag.digestLen()];
    }

    pub fn format(this: *const Integrity, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        switch (this.tag) {
            .sha1 => try writer.writeAll("sha1-"),
            .sha256 => try writer.writeAll("sha256-"),
            .sha384 => try writer.writeAll("sha384-"),
            .sha512 => try writer.writeAll("sha512-"),
            else => return,
        }

        var base64_buf: [512]u8 = undefined;
        const bytes = this.slice();

        try writer.writeAll(Base64.Encoder.encode(&base64_buf, bytes));

        // consistency with yarn.lock
        switch (this.tag) {
            .sha1 => try writer.writeAll("="),
            else => try writer.writeAll("=="),
        }
    }

    pub fn verify(this: *const Integrity, bytes: []const u8) bool {
        return @call(.always_inline, verifyByTag, .{ this.tag, bytes, &this.value });
    }

    pub fn verifyByTag(tag: Tag, bytes: []const u8, sum: []const u8) bool {
        var digest: [digest_buf_len]u8 = undefined;

        switch (tag) {
            .sha1 => {
                const len = std.crypto.hash.Sha1.digest_length;
                var ptr: *[len]u8 = digest[0..len];
                Crypto.SHA1.hash(bytes, ptr);
                return strings.eqlLong(ptr, sum[0..len], true);
            },
            .sha512 => {
                const len = std.crypto.hash.sha2.Sha512.digest_length;
                var ptr: *[len]u8 = digest[0..len];
                Crypto.SHA512.hash(bytes, ptr);
                return strings.eqlLong(ptr, sum[0..len], true);
            },
            .sha256 => {
                const len = std.crypto.hash.sha2.Sha256.digest_length;
                var ptr: *[len]u8 = digest[0..len];
                Crypto.SHA256.hash(bytes, ptr);
                return strings.eqlLong(ptr, sum[0..len], true);
            },
            .sha384 => {
                const len = std.crypto.hash.sha2.Sha384.digest_length;
                var ptr: *[len]u8 = digest[0..len];
                Crypto.SHA384.hash(bytes, ptr);
                return strings.eqlLong(ptr, sum[0..len], true);
            },
            else => return false,
        }

        unreachable;
    }
};
