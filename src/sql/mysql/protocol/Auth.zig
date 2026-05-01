// Authentication methods
const Auth = @This();

pub const mysql_native_password = struct {
    pub fn scramble(password: []const u8, nonce: []const u8) ![20]u8 {
        // SHA1( password ) XOR SHA1( nonce + SHA1( SHA1( password ) ) ) )
        var stage1 = [_]u8{0} ** 20;
        var stage2 = [_]u8{0} ** 20;
        var stage3 = [_]u8{0} ** 20;
        var result: [20]u8 = [_]u8{0} ** 20;
        if (password.len == 0) {
            return result;
        }

        // Stage 1: SHA1(password)
        bun.sha.SHA1.hash(password, &stage1, jsc.VirtualMachine.get().rareData().boringEngine());

        // Stage 2: SHA1(SHA1(password))
        bun.sha.SHA1.hash(&stage1, &stage2, jsc.VirtualMachine.get().rareData().boringEngine());

        // Stage 3: SHA1(nonce + SHA1(SHA1(password)))
        var sha1 = bun.sha.SHA1.init();
        defer sha1.deinit();
        sha1.update(nonce[0..8]);
        sha1.update(nonce[8..20]);
        sha1.update(&stage2);
        sha1.final(&stage3);

        // Final: stage1 XOR stage3
        for (&result, &stage1, &stage3) |*out, d1, d3| {
            out.* = d3 ^ d1;
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
        continue_auth = 0x04,
        _,
    };

    pub const Response = struct {
        status: FastAuthStatus = .success,
        data: Data = .{ .empty = {} },

        pub fn deinit(this: *Response) void {
            this.data.deinit();
        }

        pub fn decodeInternal(this: *Response, comptime Context: type, reader: NewReader(Context)) !void {
            const status = try reader.int(u8);
            debug("FastAuthStatus: {d}", .{status});
            this.status = @enumFromInt(status);

            // Read remaining data if any
            const remaining = reader.peek();
            if (remaining.len > 0) {
                this.data = try reader.read(remaining.len);
            }
        }

        pub const decode = decoderWrap(Response, decodeInternal).decode;
    };
    pub const EncryptedPassword = struct {
        password: []const u8,
        public_key: []const u8,
        nonce: []const u8,
        sequence_id: u8,

        // https://mariadb.com/kb/en/sha256_password-plugin/#rsa-encrypted-password
        // RSA encrypted value of XOR(password, seed) using server public key (RSA_PKCS1_OAEP_PADDING).

        pub fn writeInternal(this: *const EncryptedPassword, comptime Context: type, writer: NewWriter(Context)) !void {
            // 1024 is overkill but lets cover all cases
            var password_buf: [1024]u8 = undefined;
            var needs_to_free_password = false;
            var plain_password = brk: {
                const needed_len = this.password.len + 1;
                if (needed_len > password_buf.len) {
                    needs_to_free_password = true;
                    break :brk try bun.default_allocator.alloc(u8, needed_len);
                } else {
                    break :brk password_buf[0..needed_len];
                }
            };
            @memcpy(plain_password[0..this.password.len], this.password);
            plain_password[this.password.len] = 0;
            defer if (needs_to_free_password) bun.default_allocator.free(plain_password);

            for (plain_password, 0..) |*c, i| {
                c.* ^= this.nonce[i % this.nonce.len];
            }
            BoringSSL.load();
            BoringSSL.c.ERR_clear_error();
            // Decode public key
            const bio = BoringSSL.c.BIO_new_mem_buf(&this.public_key[0], @intCast(this.public_key.len)) orelse return error.InvalidPublicKey;
            defer _ = BoringSSL.c.BIO_free(bio);

            const rsa = BoringSSL.c.PEM_read_bio_RSA_PUBKEY(bio, null, null, null) orelse return {
                if (bun.Environment.isDebug) {
                    BoringSSL.c.ERR_load_ERR_strings();
                    BoringSSL.c.ERR_load_crypto_strings();
                    var buf: [256]u8 = undefined;
                    debug("Failed to read public key: {s}", .{BoringSSL.c.ERR_error_string(BoringSSL.c.ERR_get_error(), &buf)});
                }
                return error.InvalidPublicKey;
            };
            defer BoringSSL.c.RSA_free(rsa);
            // encrypt password

            const rsa_size = BoringSSL.c.RSA_size(rsa);
            var needs_to_free_encrypted_password = false;
            // should never ne bigger than 4096 but lets cover all cases
            var encrypted_password_buf: [4096]u8 = undefined;
            var encrypted_password = brk: {
                if (rsa_size > encrypted_password_buf.len) {
                    needs_to_free_encrypted_password = true;
                    break :brk try bun.default_allocator.alloc(u8, rsa_size);
                } else {
                    break :brk encrypted_password_buf[0..rsa_size];
                }
            };
            defer if (needs_to_free_encrypted_password) bun.default_allocator.free(encrypted_password);

            const encrypted_password_len = BoringSSL.c.RSA_public_encrypt(
                @intCast(plain_password.len),
                plain_password.ptr,
                encrypted_password.ptr,
                rsa,
                BoringSSL.c.RSA_PKCS1_OAEP_PADDING,
            );
            if (encrypted_password_len == -1) {
                return error.FailedToEncryptPassword;
            }
            const encrypted_password_slice = encrypted_password[0..@intCast(encrypted_password_len)];

            var packet = try writer.start(this.sequence_id);
            try writer.write(encrypted_password_slice);
            try packet.end();
        }

        pub const write = writeWrap(EncryptedPassword, writeInternal).write;
    };
    pub const PublicKeyResponse = struct {
        data: Data = .{ .empty = {} },

        pub fn deinit(this: *PublicKeyResponse) void {
            this.data.deinit();
        }
        pub fn decodeInternal(this: *PublicKeyResponse, comptime Context: type, reader: NewReader(Context)) !void {
            // get all the data
            const remaining = reader.peek();
            if (remaining.len > 0) {
                this.data = try reader.read(remaining.len);
            }
        }
        pub const decode = decoderWrap(PublicKeyResponse, decodeInternal).decode;
    };

    pub const PublicKeyRequest = struct {
        pub fn writeInternal(this: *const PublicKeyRequest, comptime Context: type, writer: NewWriter(Context)) !void {
            _ = this;
            try writer.int1(0x02); // Request public key
        }

        pub const write = writeWrap(PublicKeyRequest, writeInternal).write;
    };
};
const debug = bun.Output.scoped(.Auth, .hidden);

const Data = @import("../../shared/Data.zig").Data;

const NewReader = @import("./NewReader.zig").NewReader;
const decoderWrap = @import("./NewReader.zig").decoderWrap;

const NewWriter = @import("./NewWriter.zig").NewWriter;
const writeWrap = @import("./NewWriter.zig").writeWrap;

const bun = @import("bun");
const BoringSSL = bun.BoringSSL;
const jsc = bun.jsc;
