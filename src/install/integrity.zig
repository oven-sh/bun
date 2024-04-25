const std = @import("std");
const strings = @import("../string_immutable.zig");
const Crypto = @import("../sha.zig").Hashers;
const bun = @import("root").bun;

pub const Integrity = extern struct {
    const empty_digest_buf: [Integrity.digest_buf_len]u8 = [_]u8{0} ** Integrity.digest_buf_len;

    tag: Tag = Tag.unknown,
    /// Possibly a [Subresource Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) value initially
    /// We transform it though.
    value: [digest_buf_len]u8 = empty_digest_buf,

    const Base64 = std.base64.standard_no_pad;

    pub const digest_buf_len: usize = @max(
        std.crypto.hash.Sha1.digest_length,
        std.crypto.hash.sha2.Sha512.digest_length,
        std.crypto.hash.sha2.Sha256.digest_length,
        std.crypto.hash.sha2.Sha384.digest_length,
    );

    pub fn parseSHASum(buf: []const u8) !Integrity {
        if (buf.len == 0) {
            return Integrity{
                .tag = Tag.unknown,
            };
        }

        // e.g. "3cd0599b099384b815c10f7fa7df0092b62d534f"
        var integrity = Integrity{ .tag = Tag.sha1 };
        const end: usize = @min("3cd0599b099384b815c10f7fa7df0092b62d534f".len, buf.len);
        var out_i: usize = 0;
        var i: usize = 0;

        // initializer should zero it out
        if (comptime bun.Environment.isDebug) {
            for (integrity.value) |c| {
                bun.assert(c == 0);
            }
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
            integrity.value[out_i] = @as(u8, @truncate(x0 << 4 | x1));

            out_i += 1;
            i += 1;
        }

        return integrity;
    }

    pub fn parse(buf: []const u8) !Integrity {
        if (buf.len < "sha256-".len) {
            return Integrity{
                .tag = Tag.unknown,
            };
        }

        var out: [digest_buf_len]u8 = empty_digest_buf;
        const tag = Tag.parse(buf);
        if (tag == Tag.unknown) {
            return Integrity{
                .tag = Tag.unknown,
            };
        }

        Base64.Decoder.decode(&out, std.mem.trimRight(u8, buf["sha256-".len..], "=")) catch {
            return Integrity{
                .tag = Tag.unknown,
            };
        };

        return Integrity{ .value = out, .tag = tag };
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
            return @intFromEnum(this) >= @intFromEnum(Tag.sha1) and @intFromEnum(this) <= @intFromEnum(Tag.sha512);
        }

        pub fn parse(buf: []const u8) Tag {
            const Matcher = strings.ExactSizeMatcher(8);

            const i = strings.indexOfChar(buf[0..@min(buf.len, 7)], '-') orelse return Tag.unknown;

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

        // consistentcy with yarn.lock
        switch (this.tag) {
            .sha1 => try writer.writeAll("="),
            else => try writer.writeAll("=="),
        }
    }

    pub fn verify(this: *const Integrity, bytes: []const u8) bool {
        return @call(bun.callmod_inline, verifyByTag, .{ this.tag, bytes, &this.value });
    }

    pub fn verifyByTag(tag: Tag, bytes: []const u8, sum: []const u8) bool {
        var digest: [digest_buf_len]u8 = undefined;

        switch (tag) {
            .sha1 => {
                const len = std.crypto.hash.Sha1.digest_length;
                const ptr: *[len]u8 = digest[0..len];
                Crypto.SHA1.hash(bytes, ptr);
                return strings.eqlLong(ptr, sum[0..len], true);
            },
            .sha512 => {
                const len = std.crypto.hash.sha2.Sha512.digest_length;
                const ptr: *[len]u8 = digest[0..len];
                Crypto.SHA512.hash(bytes, ptr);
                return strings.eqlLong(ptr, sum[0..len], true);
            },
            .sha256 => {
                const len = std.crypto.hash.sha2.Sha256.digest_length;
                const ptr: *[len]u8 = digest[0..len];
                Crypto.SHA256.hash(bytes, ptr);
                return strings.eqlLong(ptr, sum[0..len], true);
            },
            .sha384 => {
                const len = std.crypto.hash.sha2.Sha384.digest_length;
                const ptr: *[len]u8 = digest[0..len];
                Crypto.SHA384.hash(bytes, ptr);
                return strings.eqlLong(ptr, sum[0..len], true);
            },
            else => return false,
        }

        unreachable;
    }

    comptime {
        const integrity = Integrity{ .tag = Tag.sha1 };
        for (integrity.value) |c| {
            if (c != 0) {
                @compileError("Integrity buffer is not zeroed");
            }
        }
    }
};
