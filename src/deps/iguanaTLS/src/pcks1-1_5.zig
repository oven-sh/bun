const std = @import("std");
const mem = std.mem;
const Allocator = mem.Allocator;
const Sha224 = std.crypto.hash.sha2.Sha224;
const Sha384 = std.crypto.hash.sha2.Sha384;
const Sha512 = std.crypto.hash.sha2.Sha512;
const Sha256 = std.crypto.hash.sha2.Sha256;

const x509 = @import("x509.zig");
const SignatureAlgorithm = x509.Certificate.SignatureAlgorithm;
const asn1 = @import("asn1.zig");

fn rsa_perform(
    allocator: *Allocator,
    modulus: std.math.big.int.Const,
    exponent: std.math.big.int.Const,
    base: []const u8,
) !?std.math.big.int.Managed {
    // @TODO Better algorithm, make it faster.
    const curr_base_limbs = try allocator.alloc(
        usize,
        std.math.divCeil(usize, base.len, @sizeOf(usize)) catch unreachable,
    );
    const curr_base_limb_bytes = @ptrCast([*]u8, curr_base_limbs)[0..base.len];
    mem.copy(u8, curr_base_limb_bytes, base);
    mem.reverse(u8, curr_base_limb_bytes);
    var curr_base = (std.math.big.int.Mutable{
        .limbs = curr_base_limbs,
        .positive = true,
        .len = curr_base_limbs.len,
    }).toManaged(allocator);
    defer curr_base.deinit();

    var curr_exponent = try exponent.toManaged(allocator);
    defer curr_exponent.deinit();
    var result = try std.math.big.int.Managed.initSet(allocator, @as(usize, 1));

    // encrypted = signature ^ key.exponent MOD key.modulus
    while (curr_exponent.toConst().orderAgainstScalar(0) == .gt) {
        if (curr_exponent.isOdd()) {
            try result.ensureMulCapacity(result.toConst(), curr_base.toConst());
            try result.mul(result.toConst(), curr_base.toConst());
            try llmod(&result, modulus);
        }
        try curr_base.sqr(curr_base.toConst());
        try llmod(&curr_base, modulus);
        try curr_exponent.shiftRight(curr_exponent, 1);
    }

    if (result.limbs.len * @sizeOf(usize) < base.len)
        return null;
    return result;
}

// res = res mod N
fn llmod(res: *std.math.big.int.Managed, n: std.math.big.int.Const) !void {
    var temp = try std.math.big.int.Managed.init(res.allocator);
    defer temp.deinit();
    try temp.divTrunc(res, res.toConst(), n);
}

pub fn algorithm_prefix(signature_algorithm: SignatureAlgorithm) ?[]const u8 {
    return switch (signature_algorithm.hash) {
        .none, .md5, .sha1 => null,
        .sha224 => &[_]u8{
            0x30, 0x2d, 0x30, 0x0d, 0x06,
            0x09, 0x60, 0x86, 0x48, 0x01,
            0x65, 0x03, 0x04, 0x02, 0x04,
            0x05, 0x00, 0x04, 0x1c,
        },
        .sha256 => &[_]u8{
            0x30, 0x31, 0x30, 0x0d, 0x06,
            0x09, 0x60, 0x86, 0x48, 0x01,
            0x65, 0x03, 0x04, 0x02, 0x01,
            0x05, 0x00, 0x04, 0x20,
        },
        .sha384 => &[_]u8{
            0x30, 0x41, 0x30, 0x0d, 0x06,
            0x09, 0x60, 0x86, 0x48, 0x01,
            0x65, 0x03, 0x04, 0x02, 0x02,
            0x05, 0x00, 0x04, 0x30,
        },
        .sha512 => &[_]u8{
            0x30, 0x51, 0x30, 0x0d, 0x06,
            0x09, 0x60, 0x86, 0x48, 0x01,
            0x65, 0x03, 0x04, 0x02, 0x03,
            0x05, 0x00, 0x04, 0x40,
        },
    };
}

pub fn sign(
    allocator: *Allocator,
    signature_algorithm: SignatureAlgorithm,
    hash: []const u8,
    private_key: x509.PrivateKey,
) !?[]const u8 {
    // @TODO ECDSA signatures
    if (signature_algorithm.signature != .rsa or private_key != .rsa)
        return null;

    const signature_length = private_key.rsa.modulus.len * @sizeOf(usize);
    var sig_buf = try allocator.alloc(u8, signature_length);
    defer allocator.free(sig_buf);
    const prefix = algorithm_prefix(signature_algorithm) orelse return null;
    const first_prefix_idx = sig_buf.len - hash.len - prefix.len;
    const first_hash_idx = sig_buf.len - hash.len;

    // EM = 0x00 || 0x01 || PS || 0x00 || T
    sig_buf[0] = 0;
    sig_buf[1] = 1;
    mem.set(u8, sig_buf[2 .. first_prefix_idx - 1], 0xff);
    sig_buf[first_prefix_idx - 1] = 0;
    mem.copy(u8, sig_buf[first_prefix_idx..first_hash_idx], prefix);
    mem.copy(u8, sig_buf[first_hash_idx..], hash);

    const modulus = std.math.big.int.Const{ .limbs = private_key.rsa.modulus, .positive = true };
    const exponent = std.math.big.int.Const{ .limbs = private_key.rsa.exponent, .positive = true };

    var rsa_result = (try rsa_perform(allocator, modulus, exponent, sig_buf)) orelse return null;
    if (rsa_result.limbs.len * @sizeOf(usize) < signature_length) {
        rsa_result.deinit();
        return null;
    }

    const enc_buf = @ptrCast([*]u8, rsa_result.limbs.ptr)[0..signature_length];
    mem.reverse(u8, enc_buf);
    return allocator.resize(
        enc_buf.ptr[0 .. rsa_result.limbs.len * @sizeOf(usize)],
        signature_length,
    ) catch unreachable;
}

pub fn verify_signature(
    allocator: *Allocator,
    signature_algorithm: SignatureAlgorithm,
    signature: asn1.BitString,
    hash: []const u8,
    public_key: x509.PublicKey,
) !bool {
    // @TODO ECDSA algorithms
    if (public_key != .rsa or signature_algorithm.signature != .rsa) return false;
    const prefix = algorithm_prefix(signature_algorithm) orelse return false;

    // RSA hash verification with PKCS 1 V1_5 padding
    const modulus = std.math.big.int.Const{ .limbs = public_key.rsa.modulus, .positive = true };
    const exponent = std.math.big.int.Const{ .limbs = public_key.rsa.exponent, .positive = true };
    if (modulus.bitCountAbs() != signature.bit_len)
        return false;

    var rsa_result = (try rsa_perform(allocator, modulus, exponent, signature.data)) orelse return false;
    defer rsa_result.deinit();

    if (rsa_result.limbs.len * @sizeOf(usize) < signature.data.len)
        return false;

    const enc_buf = @ptrCast([*]u8, rsa_result.limbs.ptr)[0..signature.data.len];
    mem.reverse(u8, enc_buf);

    if (enc_buf[0] != 0x00 or enc_buf[1] != 0x01)
        return false;
    if (!mem.endsWith(u8, enc_buf, hash))
        return false;
    if (!mem.endsWith(u8, enc_buf[0 .. enc_buf.len - hash.len], prefix))
        return false;
    if (enc_buf[enc_buf.len - hash.len - prefix.len - 1] != 0x00)
        return false;
    for (enc_buf[2 .. enc_buf.len - hash.len - prefix.len - 1]) |c| {
        if (c != 0xff) return false;
    }

    return true;
}

pub fn certificate_verify_signature(
    allocator: *Allocator,
    signature_algorithm: x509.Certificate.SignatureAlgorithm,
    signature: asn1.BitString,
    bytes: []const u8,
    public_key: x509.PublicKey,
) !bool {
    // @TODO ECDSA algorithms
    if (public_key != .rsa or signature_algorithm.signature != .rsa) return false;

    var hash_buf: [64]u8 = undefined;
    var hash: []u8 = undefined;

    switch (signature_algorithm.hash) {
        // Deprecated hash algos
        .none, .md5, .sha1 => return false,
        .sha224 => {
            Sha224.hash(bytes, hash_buf[0..28], .{});
            hash = hash_buf[0..28];
        },
        .sha256 => {
            Sha256.hash(bytes, hash_buf[0..32], .{});
            hash = hash_buf[0..32];
        },
        .sha384 => {
            Sha384.hash(bytes, hash_buf[0..48], .{});
            hash = hash_buf[0..48];
        },
        .sha512 => {
            Sha512.hash(bytes, hash_buf[0..64], .{});
            hash = &hash_buf;
        },
    }
    return try verify_signature(allocator, signature_algorithm, signature, hash, public_key);
}
