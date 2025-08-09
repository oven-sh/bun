// Authentication methods
const std = @import("std");
const Auth = @This();

pub const mysql_native_password = struct {
    pub fn scramble(password: []const u8, nonce: []const u8) ![20]u8 {
        // SHA1( password ) XOR SHA1( nonce + SHA1( SHA1( password ) ) ) )
        var stage1 = [_]u8{0} ** 20;
        var stage2 = [_]u8{0} ** 20;
        var stage3 = [_]u8{0} ** 20;
        var result: [20]u8 = [_]u8{0} ** 20;

        // Stage 1: SHA1(password)
        bun.sha.SHA1.hash(password, &stage1, jsc.VirtualMachine.get().rareData().boringEngine());

        // Stage 2: SHA1(SHA1(password))
        bun.sha.SHA1.hash(&stage1, &stage2, jsc.VirtualMachine.get().rareData().boringEngine());

        // Stage 3: SHA1(nonce + SHA1(SHA1(password)))
        const combined = try bun.default_allocator.alloc(u8, nonce.len + stage2.len);
        defer bun.default_allocator.free(combined);
        @memcpy(combined[0..nonce.len], nonce);
        @memcpy(combined[nonce.len..], &stage2);
        bun.sha.SHA1.hash(combined, &stage3, jsc.VirtualMachine.get().rareData().boringEngine());

        // Final: stage1 XOR stage3
        for (&result, &stage1, &stage3) |*out, d1, d3| {
            out.* = d1 ^ d3;
        }

        return result;
    }
};

pub const caching_sha2_password = struct {
    pub fn scramble(password: []const u8, nonce: []const u8) ![32]u8 {
        // XOR(SHA256(password), SHA256(SHA256(SHA256(password)), nonce))
        var digest1 = [_]u8{0} ** 32;
        var digest2 = [_]u8{0} ** 32;
        var digest3 = [_]u8{0} ** 32;
        var result: [32]u8 = [_]u8{0} ** 32;

        // SHA256(password)
        bun.sha.SHA256.hash(password, &digest1, jsc.VirtualMachine.get().rareData().boringEngine());

        // SHA256(SHA256(password))
        bun.sha.SHA256.hash(&digest1, &digest2, jsc.VirtualMachine.get().rareData().boringEngine());

        // SHA256(SHA256(SHA256(password)) + nonce)
        const combined = try bun.default_allocator.alloc(u8, nonce.len + digest2.len);
        defer bun.default_allocator.free(combined);
        @memcpy(combined[0..nonce.len], nonce);
        @memcpy(combined[nonce.len..], &digest2);
        bun.sha.SHA256.hash(combined, &digest3, jsc.VirtualMachine.get().rareData().boringEngine());

        // XOR(SHA256(password), digest3)
        for (&result, &digest1, &digest3) |*out, d1, d3| {
            out.* = d1 ^ d3;
        }

        return result;
    }

    pub const FastAuthStatus = enum(u8) {
        success = 0x03,
        fail = 0x04,
        full_auth = 0x02,
    };

    pub const Response = struct {
        status: FastAuthStatus = .success,
        data: Data = .{ .empty = {} },

        pub fn deinit(this: *Response) void {
            this.data.deinit();
        }

        pub fn decodeInternal(this: *Response, comptime Context: type, reader: NewReader(Context)) !void {
            this.status = @enumFromInt(try reader.int(u8));

            // Read remaining data if any
            const remaining = reader.peek();
            if (remaining.len > 0) {
                this.data = try reader.read(remaining.len);
            }
        }

        pub const decode = decoderWrap(Response, decodeInternal).decode;
    };

    pub const PublicKeyRequest = struct {
        pub fn writeInternal(this: *const PublicKeyRequest, comptime Context: type, writer: NewWriter(Context)) !void {
            _ = this;
            try writer.int1(0x02); // Request public key
        }

        pub const write = writeWrap(PublicKeyRequest, writeInternal).write;
    };

    pub const EncryptedPassword = struct {
        password: []const u8,
        public_key: []const u8,
        nonce: []const u8,

        pub fn writeInternal(this: *const EncryptedPassword, comptime Context: type, writer: NewWriter(Context)) !void {
            var stack = std.heap.stackFallback(4096, bun.default_allocator);
            const allocator = stack.get();
            const encrypted = try encryptPassword(allocator, this.password, this.public_key, this.nonce);
            defer allocator.free(encrypted);
            try writer.write(encrypted);
        }

        pub const write = writeWrap(EncryptedPassword, writeInternal).write;

        fn encryptPassword(allocator: std.mem.Allocator, password: []const u8, public_key: []const u8, nonce: []const u8) ![]u8 {
            _ = allocator; // autofix
            _ = password; // autofix
            _ = public_key; // autofix
            _ = nonce; // autofix
            bun.todoPanic(@src(), "Not implemented", .{});
            // XOR the password with the nonce
            // var xored = try allocator.alloc(u8, password.len);
            // defer allocator.free(xored);

            // for (password, 0..) |c, i| {
            //     xored[i] = c ^ nonce[i % nonce.len];
            // }

            // // // Load the public key
            // // const key = try BoringSSL.PKey.fromPEM(public_key);
            // // defer key.deinit();

            // // // Encrypt with RSA
            // // const out = try allocator.alloc(u8, key.size());
            // // errdefer allocator.free(out);

            // // const written = try key.encrypt(out, xored, .PKCS1_OAEP);

            // const written
            // // if (written != out.len) {
            //     return error.EncryptionFailed;
            // }

            // return out;
        }
    };
};
const bun = @import("bun");
const jsc = bun.jsc;
const Data = @import("./Data.zig").Data;
const NewReader = @import("./NewReader.zig").NewReader;
const NewWriter = @import("./NewWriter.zig").NewWriter;
const writeWrap = @import("./NewWriter.zig").writeWrap;
const decoderWrap = @import("./NewReader.zig").decoderWrap;
