const SASL = @This();

const nonce_byte_len = 18;
const nonce_base64_len = bun.base64.encodeLenFromSize(nonce_byte_len);

const server_signature_byte_len = 32;
const server_signature_base64_len = bun.base64.encodeLenFromSize(server_signature_byte_len);

const salted_password_byte_len = 32;

nonce_base64_bytes: [nonce_base64_len]u8 = .{0} ** nonce_base64_len,
nonce_len: u8 = 0,

server_signature_base64_bytes: [server_signature_base64_len]u8 = .{0} ** server_signature_base64_len,
server_signature_len: u8 = 0,

salted_password_bytes: [salted_password_byte_len]u8 = .{0} ** salted_password_byte_len,
salted_password_created: bool = false,

status: SASLStatus = .init,

pub const SASLStatus = enum {
    init,
    @"continue",
};

fn hmac(password: []const u8, data: []const u8) ?[32]u8 {
    var buf = std.mem.zeroes([bun.BoringSSL.c.EVP_MAX_MD_SIZE]u8);

    // TODO: I don't think this is failable.
    const result = bun.hmac.generate(password, data, .sha256, &buf) orelse return null;

    assert(result.len == 32);
    return buf[0..32].*;
}

pub fn computeSaltedPassword(this: *SASL, salt_bytes: []const u8, iteration_count: u32, connection: *PostgresSQLConnection) !void {
    this.salted_password_created = true;
    if (Crypto.EVP.pbkdf2(&this.salted_password_bytes, connection.password, salt_bytes, iteration_count, .sha256) == null) {
        return error.PBKDFD2;
    }
}

pub fn saltedPassword(this: *const SASL) []const u8 {
    assert(this.salted_password_created);
    return this.salted_password_bytes[0..salted_password_byte_len];
}

pub fn serverSignature(this: *const SASL) []const u8 {
    assert(this.server_signature_len > 0);
    return this.server_signature_base64_bytes[0..this.server_signature_len];
}

pub fn computeServerSignature(this: *SASL, auth_string: []const u8) !void {
    assert(this.server_signature_len == 0);

    const server_key = hmac(this.saltedPassword(), "Server Key") orelse return error.InvalidServerKey;
    const server_signature_bytes = hmac(&server_key, auth_string) orelse return error.InvalidServerSignature;
    this.server_signature_len = @intCast(bun.base64.encode(&this.server_signature_base64_bytes, &server_signature_bytes));
}

pub fn clientKey(this: *const SASL) [32]u8 {
    return hmac(this.saltedPassword(), "Client Key").?;
}

pub fn clientKeySignature(_: *const SASL, client_key: []const u8, auth_string: []const u8) [32]u8 {
    var sha_digest = std.mem.zeroes(bun.sha.SHA256.Digest);
    bun.sha.SHA256.hash(client_key, &sha_digest, jsc.VirtualMachine.get().rareData().boringEngine());
    return hmac(&sha_digest, auth_string).?;
}

pub fn nonce(this: *SASL) []const u8 {
    if (this.nonce_len == 0) {
        var bytes: [nonce_byte_len]u8 = .{0} ** nonce_byte_len;
        bun.csprng(&bytes);
        this.nonce_len = @intCast(bun.base64.encode(&this.nonce_base64_bytes, &bytes));
    }
    return this.nonce_base64_bytes[0..this.nonce_len];
}

pub fn deinit(this: *SASL) void {
    this.nonce_len = 0;
    this.salted_password_created = false;
    this.server_signature_len = 0;
    this.status = .init;
}

const PostgresSQLConnection = @import("./PostgresSQLConnection.zig");
const std = @import("std");

const bun = @import("bun");
const assert = bun.assert;
const jsc = bun.jsc;
const Crypto = jsc.API.Bun.Crypto;
