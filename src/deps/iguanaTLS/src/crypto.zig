const std = @import("std");
const mem = std.mem;

const Poly1305 = std.crypto.onetimeauth.Poly1305;
const Chacha20IETF = std.crypto.stream.chacha.ChaCha20IETF;

// TODO See stdlib, this is a modified non vectorized implementation
pub const ChaCha20Stream = struct {
    const math = std.math;
    pub const BlockVec = [16]u32;

    pub fn initContext(key: [8]u32, d: [4]u32) BlockVec {
        const c = "expand 32-byte k";
        const constant_le = comptime [4]u32{
            mem.readIntLittle(u32, c[0..4]),
            mem.readIntLittle(u32, c[4..8]),
            mem.readIntLittle(u32, c[8..12]),
            mem.readIntLittle(u32, c[12..16]),
        };
        return BlockVec{
            constant_le[0], constant_le[1], constant_le[2], constant_le[3],
            key[0],         key[1],         key[2],         key[3],
            key[4],         key[5],         key[6],         key[7],
            d[0],           d[1],           d[2],           d[3],
        };
    }

    const QuarterRound = struct {
        a: usize,
        b: usize,
        c: usize,
        d: usize,
    };

    fn Rp(a: usize, b: usize, c: usize, d: usize) QuarterRound {
        return QuarterRound{
            .a = a,
            .b = b,
            .c = c,
            .d = d,
        };
    }

    inline fn chacha20Core(x: *BlockVec, input: BlockVec) void {
        x.* = input;

        const rounds = comptime [_]QuarterRound{
            Rp(0, 4, 8, 12),
            Rp(1, 5, 9, 13),
            Rp(2, 6, 10, 14),
            Rp(3, 7, 11, 15),
            Rp(0, 5, 10, 15),
            Rp(1, 6, 11, 12),
            Rp(2, 7, 8, 13),
            Rp(3, 4, 9, 14),
        };

        comptime var j: usize = 0;
        inline while (j < 20) : (j += 2) {
            inline for (rounds) |r| {
                x[r.a] +%= x[r.b];
                x[r.d] = math.rotl(u32, x[r.d] ^ x[r.a], @as(u32, 16));
                x[r.c] +%= x[r.d];
                x[r.b] = math.rotl(u32, x[r.b] ^ x[r.c], @as(u32, 12));
                x[r.a] +%= x[r.b];
                x[r.d] = math.rotl(u32, x[r.d] ^ x[r.a], @as(u32, 8));
                x[r.c] +%= x[r.d];
                x[r.b] = math.rotl(u32, x[r.b] ^ x[r.c], @as(u32, 7));
            }
        }
    }

    inline fn hashToBytes(out: *[64]u8, x: BlockVec) void {
        var i: usize = 0;
        while (i < 4) : (i += 1) {
            mem.writeIntLittle(u32, out[16 * i + 0 ..][0..4], x[i * 4 + 0]);
            mem.writeIntLittle(u32, out[16 * i + 4 ..][0..4], x[i * 4 + 1]);
            mem.writeIntLittle(u32, out[16 * i + 8 ..][0..4], x[i * 4 + 2]);
            mem.writeIntLittle(u32, out[16 * i + 12 ..][0..4], x[i * 4 + 3]);
        }
    }

    inline fn contextFeedback(x: *BlockVec, ctx: BlockVec) void {
        var i: usize = 0;
        while (i < 16) : (i += 1) {
            x[i] +%= ctx[i];
        }
    }

    pub fn initPoly1305(key: [32]u8, nonce: [12]u8, ad: [13]u8) Poly1305 {
        var polyKey = [_]u8{0} ** 32;
        Chacha20IETF.xor(&polyKey, &polyKey, 0, key, nonce);
        var mac = Poly1305.init(&polyKey);
        mac.update(&ad);
        // Pad to 16 bytes from ad
        mac.update(&.{ 0, 0, 0 });
        return mac;
    }

    /// Call after `mac` has been updated with the whole message
    pub fn checkPoly1305(mac: *Poly1305, len: usize, tag: [16]u8) !void {
        if (len % 16 != 0) {
            const zeros = [_]u8{0} ** 16;
            const padding = 16 - (len % 16);
            mac.update(zeros[0..padding]);
        }
        var lens: [16]u8 = undefined;
        mem.writeIntLittle(u64, lens[0..8], 13);
        mem.writeIntLittle(u64, lens[8..16], len);
        mac.update(lens[0..]);
        var computedTag: [16]u8 = undefined;
        mac.final(computedTag[0..]);

        var acc: u8 = 0;
        for (computedTag) |_, i| {
            acc |= computedTag[i] ^ tag[i];
        }
        if (acc != 0) {
            return error.AuthenticationFailed;
        }
    }

    // TODO: Optimize this
    pub fn chacha20Xor(out: []u8, in: []const u8, key: [8]u32, ctx: *BlockVec, idx: *usize, buf: *[64]u8) void {
        _ = key;

        var x: BlockVec = undefined;

        var i: usize = 0;
        while (i < in.len) {
            if (idx.* % 64 == 0) {
                if (idx.* != 0) {
                    ctx.*[12] += 1;
                }
                chacha20Core(x[0..], ctx.*);
                contextFeedback(&x, ctx.*);
                hashToBytes(buf, x);
            }

            out[i] = in[i] ^ buf[idx.* % 64];

            i += 1;
            idx.* += 1;
        }
    }
};

pub fn keyToWords(key: [32]u8) [8]u32 {
    var k: [8]u32 = undefined;
    var i: usize = 0;
    while (i < 8) : (i += 1) {
        k[i] = mem.readIntLittle(u32, key[i * 4 ..][0..4]);
    }
    return k;
}

// See std.crypto.core.modes.ctr
/// This mode creates a key stream by encrypting an incrementing counter using a block cipher, and adding it to the source material.
pub fn ctr(
    comptime BlockCipher: anytype,
    block_cipher: BlockCipher,
    dst: []u8,
    src: []const u8,
    counterInt: *u128,
    idx: *usize,
    endian: std.builtin.Endian,
) void {
    std.debug.assert(dst.len >= src.len);
    const block_length = BlockCipher.block_length;
    var cur_idx: usize = 0;

    const offset = idx.* % block_length;
    if (offset != 0) {
        const part_len = std.math.min(block_length - offset, src.len);

        var counter: [BlockCipher.block_length]u8 = undefined;
        mem.writeInt(u128, &counter, counterInt.*, endian);
        var pad = [_]u8{0} ** block_length;
        mem.copy(u8, pad[offset..], src[0..part_len]);
        block_cipher.xor(&pad, &pad, counter);
        mem.copy(u8, dst[0..part_len], pad[offset..][0..part_len]);
        cur_idx += part_len;
        idx.* += part_len;
        if (idx.* % block_length == 0)
            counterInt.* += 1;
    }

    const start_idx = cur_idx;
    const remaining = src.len - cur_idx;
    cur_idx = 0;

    const parallel_count = BlockCipher.block.parallel.optimal_parallel_blocks;
    const wide_block_length = parallel_count * 16;
    if (remaining >= wide_block_length) {
        var counters: [parallel_count * 16]u8 = undefined;
        while (cur_idx + wide_block_length <= remaining) : (cur_idx += wide_block_length) {
            comptime var j = 0;
            inline while (j < parallel_count) : (j += 1) {
                mem.writeInt(u128, counters[j * 16 .. j * 16 + 16], counterInt.*, endian);
                counterInt.* +%= 1;
            }
            block_cipher.xorWide(parallel_count, dst[start_idx..][cur_idx .. cur_idx + wide_block_length][0..wide_block_length], src[start_idx..][cur_idx .. cur_idx + wide_block_length][0..wide_block_length], counters);
            idx.* += wide_block_length;
        }
    }
    while (cur_idx + block_length <= remaining) : (cur_idx += block_length) {
        var counter: [BlockCipher.block_length]u8 = undefined;
        mem.writeInt(u128, &counter, counterInt.*, endian);
        counterInt.* +%= 1;
        block_cipher.xor(dst[start_idx..][cur_idx .. cur_idx + block_length][0..block_length], src[start_idx..][cur_idx .. cur_idx + block_length][0..block_length], counter);
        idx.* += block_length;
    }
    if (cur_idx < remaining) {
        std.debug.assert(idx.* % block_length == 0);
        var counter: [BlockCipher.block_length]u8 = undefined;
        mem.writeInt(u128, &counter, counterInt.*, endian);

        var pad = [_]u8{0} ** block_length;
        mem.copy(u8, &pad, src[start_idx..][cur_idx..]);
        block_cipher.xor(&pad, &pad, counter);
        mem.copy(u8, dst[start_idx..][cur_idx..], pad[0 .. remaining - cur_idx]);

        idx.* += remaining - cur_idx;
        if (idx.* % block_length == 0)
            counterInt.* +%= 1;
    }
}

// Ported from BearSSL's ec_prime_i31 engine
pub const ecc = struct {
    pub const SECP384R1 = struct {
        pub const point_len = 96;

        const order = [point_len / 2]u8{
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xC7, 0x63, 0x4D, 0x81, 0xF4, 0x37, 0x2D, 0xDF,
            0x58, 0x1A, 0x0D, 0xB2, 0x48, 0xB0, 0xA7, 0x7A,
            0xEC, 0xEC, 0x19, 0x6A, 0xCC, 0xC5, 0x29, 0x73,
        };

        const P = [_]u32{
            0x0000018C, 0x7FFFFFFF, 0x00000001, 0x00000000,
            0x7FFFFFF8, 0x7FFFFFEF, 0x7FFFFFFF, 0x7FFFFFFF,
            0x7FFFFFFF, 0x7FFFFFFF, 0x7FFFFFFF, 0x7FFFFFFF,
            0x7FFFFFFF, 0x00000FFF,
        };
        const R2 = [_]u32{
            0x0000018C, 0x00000000, 0x00000080, 0x7FFFFE00,
            0x000001FF, 0x00000800, 0x00000000, 0x7FFFE000,
            0x00001FFF, 0x00008000, 0x00008000, 0x00000000,
            0x00000000, 0x00000000,
        };
        const B = [_]u32{
            0x0000018C, 0x6E666840, 0x070D0392, 0x5D810231,
            0x7651D50C, 0x17E218D6, 0x1B192002, 0x44EFE441,
            0x3A524E2B, 0x2719BA5F, 0x41F02209, 0x36C5643E,
            0x5813EFFE, 0x000008A5,
        };

        const base_point = [point_len]u8{
            0xAA, 0x87, 0xCA, 0x22, 0xBE, 0x8B, 0x05, 0x37,
            0x8E, 0xB1, 0xC7, 0x1E, 0xF3, 0x20, 0xAD, 0x74,
            0x6E, 0x1D, 0x3B, 0x62, 0x8B, 0xA7, 0x9B, 0x98,
            0x59, 0xF7, 0x41, 0xE0, 0x82, 0x54, 0x2A, 0x38,
            0x55, 0x02, 0xF2, 0x5D, 0xBF, 0x55, 0x29, 0x6C,
            0x3A, 0x54, 0x5E, 0x38, 0x72, 0x76, 0x0A, 0xB7,
            0x36, 0x17, 0xDE, 0x4A, 0x96, 0x26, 0x2C, 0x6F,
            0x5D, 0x9E, 0x98, 0xBF, 0x92, 0x92, 0xDC, 0x29,
            0xF8, 0xF4, 0x1D, 0xBD, 0x28, 0x9A, 0x14, 0x7C,
            0xE9, 0xDA, 0x31, 0x13, 0xB5, 0xF0, 0xB8, 0xC0,
            0x0A, 0x60, 0xB1, 0xCE, 0x1D, 0x7E, 0x81, 0x9D,
            0x7A, 0x43, 0x1D, 0x7C, 0x90, 0xEA, 0x0E, 0x5F,
        };

        comptime {
            std.debug.assert((P[0] - (P[0] >> 5) + 7) >> 2 == point_len + 1);
        }
    };

    pub const SECP256R1 = struct {
        pub const point_len = 64;

        const order = [point_len / 2]u8{
            0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00,
            0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
            0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84,
            0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x51,
        };

        const P = [_]u32{
            0x00000108, 0x7FFFFFFF,
            0x7FFFFFFF, 0x7FFFFFFF,
            0x00000007, 0x00000000,
            0x00000000, 0x00000040,
            0x7FFFFF80, 0x000000FF,
        };
        const R2 = [_]u32{
            0x00000108, 0x00014000,
            0x00018000, 0x00000000,
            0x7FF40000, 0x7FEFFFFF,
            0x7FF7FFFF, 0x7FAFFFFF,
            0x005FFFFF, 0x00000000,
        };
        const B = [_]u32{
            0x00000108, 0x6FEE1803,
            0x6229C4BD, 0x21B139BE,
            0x327150AA, 0x3567802E,
            0x3F7212ED, 0x012E4355,
            0x782DD38D, 0x0000000E,
        };

        const base_point = [point_len]u8{
            0x6B, 0x17, 0xD1, 0xF2, 0xE1, 0x2C, 0x42, 0x47,
            0xF8, 0xBC, 0xE6, 0xE5, 0x63, 0xA4, 0x40, 0xF2,
            0x77, 0x03, 0x7D, 0x81, 0x2D, 0xEB, 0x33, 0xA0,
            0xF4, 0xA1, 0x39, 0x45, 0xD8, 0x98, 0xC2, 0x96,
            0x4F, 0xE3, 0x42, 0xE2, 0xFE, 0x1A, 0x7F, 0x9B,
            0x8E, 0xE7, 0xEB, 0x4A, 0x7C, 0x0F, 0x9E, 0x16,
            0x2B, 0xCE, 0x33, 0x57, 0x6B, 0x31, 0x5E, 0xCE,
            0xCB, 0xB6, 0x40, 0x68, 0x37, 0xBF, 0x51, 0xF5,
        };

        comptime {
            std.debug.assert((P[0] - (P[0] >> 5) + 7) >> 2 == point_len + 1);
        }
    };

    fn jacobian_len(comptime Curve: type) usize {
        return @divTrunc(Curve.order.len * 8 + 61, 31);
    }

    fn Jacobian(comptime Curve: type) type {
        return [3][jacobian_len(Curve)]u32;
    }

    fn zero_jacobian(comptime Curve: type) Jacobian(Curve) {
        var result = std.mem.zeroes(Jacobian(Curve));
        result[0][0] = Curve.P[0];
        result[1][0] = Curve.P[0];
        result[2][0] = Curve.P[0];
        return result;
    }

    pub fn scalarmult(
        comptime Curve: type,
        point: [Curve.point_len]u8,
        k: []const u8,
    ) ![Curve.point_len]u8 {
        var P: Jacobian(Curve) = undefined;
        var res: u32 = decode_to_jacobian(Curve, &P, point);
        point_mul(Curve, &P, k);
        var out: [Curve.point_len]u8 = undefined;
        encode_from_jacobian(Curve, &out, P);
        if (res == 0)
            return error.MultiplicationFailed;
        return out;
    }

    pub fn KeyPair(comptime Curve: type) type {
        return struct {
            public_key: [Curve.point_len]u8,
            secret_key: [Curve.point_len / 2]u8,
        };
    }

    pub fn make_key_pair(comptime Curve: type, rand_bytes: [Curve.point_len / 2]u8) KeyPair(Curve) {
        var key_bytes = rand_bytes;
        comptime var mask: u8 = 0xFF;
        comptime {
            while (mask >= Curve.order[0]) {
                mask >>= 1;
            }
        }
        key_bytes[0] &= mask;
        key_bytes[Curve.point_len / 2 - 1] |= 0x01;

        return .{
            .secret_key = key_bytes,
            .public_key = scalarmult(Curve, Curve.base_point, &key_bytes) catch unreachable,
        };
    }

    fn jacobian_with_one_set(comptime Curve: type, comptime fields: [2][jacobian_len(Curve)]u32) Jacobian(Curve) {
        const plen = comptime (Curve.P[0] + 63) >> 5;
        return fields ++ [1][jacobian_len(Curve)]u32{
            [2]u32{ Curve.P[0], 1 } ++ ([1]u32{0} ** (plen - 2)),
        };
    }

    fn encode_from_jacobian(comptime Curve: type, point: *[Curve.point_len]u8, P: Jacobian(Curve)) void {
        var Q = P;
        const T = comptime jacobian_with_one_set(Curve, [2][jacobian_len(Curve)]u32{ undefined, undefined });
        _ = run_code(Curve, &Q, T, &code.affine);
        encode_jacobian_part(point[0 .. Curve.point_len / 2], &Q[0]);
        encode_jacobian_part(point[Curve.point_len / 2 ..], &Q[1]);
    }

    fn point_mul(comptime Curve: type, P: *Jacobian(Curve), x: []const u8) void {
        var P2 = P.*;
        point_double(Curve, &P2);
        var P3 = P.*;
        point_add(Curve, &P3, P2);
        var Q = zero_jacobian(Curve);
        var qz: u32 = 1;
        var xlen = x.len;
        var xidx: usize = 0;
        while (xlen > 0) : ({
            xlen -= 1;
            xidx += 1;
        }) {
            var k: u3 = 6;
            while (true) : (k -= 2) {
                point_double(Curve, &Q);
                point_double(Curve, &Q);
                var T = P.*;
                var U = Q;
                const bits = @as(u32, x[xidx] >> k) & 3;
                const bnz = NEQ(bits, 0);
                CCOPY(EQ(bits, 2), mem.asBytes(&T), mem.asBytes(&P2));
                CCOPY(EQ(bits, 3), mem.asBytes(&T), mem.asBytes(&P3));
                point_add(Curve, &U, T);
                CCOPY(bnz & qz, mem.asBytes(&Q), mem.asBytes(&T));
                CCOPY(bnz & ~qz, mem.asBytes(&Q), mem.asBytes(&U));
                qz &= ~bnz;

                if (k == 0)
                    break;
            }
        }
        P.* = Q;
    }

    inline fn point_double(comptime Curve: type, P: *Jacobian(Curve)) void {
        _ = run_code(Curve, P, P.*, &code.double);
    }
    inline fn point_add(comptime Curve: type, P1: *Jacobian(Curve), P2: Jacobian(Curve)) void {
        _ = run_code(Curve, P1, P2, &code._add);
    }

    fn decode_to_jacobian(
        comptime Curve: type,
        out: *Jacobian(Curve),
        point: [Curve.point_len]u8,
    ) u32 {
        out.* = zero_jacobian(Curve);
        var result = decode_mod(Curve, &out.*[0], point[0 .. Curve.point_len / 2].*);
        result &= decode_mod(Curve, &out.*[1], point[Curve.point_len / 2 ..].*);

        const zlen = comptime ((Curve.P[0] + 63) >> 5);
        comptime std.debug.assert(zlen == @typeInfo(@TypeOf(Curve.R2)).Array.len);
        comptime std.debug.assert(zlen == @typeInfo(@TypeOf(Curve.B)).Array.len);

        const Q = comptime jacobian_with_one_set(Curve, [2][jacobian_len(Curve)]u32{ Curve.R2, Curve.B });
        result &= ~run_code(Curve, out, Q, &code.check);
        return result;
    }

    const code = struct {
        const P1x = 0;
        const P1y = 1;
        const P1z = 2;
        const P2x = 3;
        const P2y = 4;
        const P2z = 5;
        const Px = 0;
        const Py = 1;
        const Pz = 2;
        const t1 = 6;
        const t2 = 7;
        const t3 = 8;
        const t4 = 9;
        const t5 = 10;
        const t6 = 11;
        const t7 = 12;
        const t8 = 3;
        const t9 = 4;
        const t10 = 5;
        fn MSET(comptime d: u16, comptime a: u16) u16 {
            return 0x0000 + (d << 8) + (a << 4);
        }
        fn MADD(comptime d: u16, comptime a: u16) u16 {
            return 0x1000 + (d << 8) + (a << 4);
        }
        fn MSUB(comptime d: u16, comptime a: u16) u16 {
            return 0x2000 + (d << 8) + (a << 4);
        }
        fn MMUL(comptime d: u16, comptime a: u16, comptime b: u16) u16 {
            return 0x3000 + (d << 8) + (a << 4) + b;
        }
        fn MINV(comptime d: u16, comptime a: u16, comptime b: u16) u16 {
            return 0x4000 + (d << 8) + (a << 4) + b;
        }
        fn MTZ(comptime d: u16) u16 {
            return 0x5000 + (d << 8);
        }
        const ENDCODE = 0;

        const check = [_]u16{
            // Convert x and y to Montgomery representation.
            MMUL(t1, P1x, P2x),
            MMUL(t2, P1y, P2x),
            MSET(P1x, t1),
            MSET(P1y, t2),
            // Compute x^3 in t1.
            MMUL(t2, P1x, P1x),
            MMUL(t1, P1x, t2),
            // Subtract 3*x from t1.
            MSUB(t1, P1x),
            MSUB(t1, P1x),
            MSUB(t1, P1x),
            // Add b.
            MADD(t1, P2y),
            // Compute y^2 in t2.
            MMUL(t2, P1y, P1y),
            // Compare y^2 with x^3 - 3*x + b; they must match.
            MSUB(t1, t2),
            MTZ(t1),
            // Set z to 1 (in Montgomery representation).
            MMUL(P1z, P2x, P2z),
            ENDCODE,
        };
        const double = [_]u16{
            // Compute z^2 (in t1).
            MMUL(t1, Pz, Pz),
            // Compute x-z^2 (in t2) and then x+z^2 (in t1).
            MSET(t2, Px),
            MSUB(t2, t1),
            MADD(t1, Px),
            // Compute m = 3*(x+z^2)*(x-z^2) (in t1).
            MMUL(t3, t1, t2),
            MSET(t1, t3),
            MADD(t1, t3),
            MADD(t1, t3),
            // Compute s = 4*x*y^2 (in t2) and 2*y^2 (in t3).
            MMUL(t3, Py, Py),
            MADD(t3, t3),
            MMUL(t2, Px, t3),
            MADD(t2, t2),
            // Compute x' = m^2 - 2*s.
            MMUL(Px, t1, t1),
            MSUB(Px, t2),
            MSUB(Px, t2),
            // Compute z' = 2*y*z.
            MMUL(t4, Py, Pz),
            MSET(Pz, t4),
            MADD(Pz, t4),
            // Compute y' = m*(s - x') - 8*y^4. Note that we already have
            // 2*y^2 in t3.
            MSUB(t2, Px),
            MMUL(Py, t1, t2),
            MMUL(t4, t3, t3),
            MSUB(Py, t4),
            MSUB(Py, t4),
            ENDCODE,
        };
        const _add = [_]u16{
            // Compute u1 = x1*z2^2 (in t1) and s1 = y1*z2^3 (in t3).
            MMUL(t3, P2z, P2z),
            MMUL(t1, P1x, t3),
            MMUL(t4, P2z, t3),
            MMUL(t3, P1y, t4),
            // Compute u2 = x2*z1^2 (in t2) and s2 = y2*z1^3 (in t4).
            MMUL(t4, P1z, P1z),
            MMUL(t2, P2x, t4),
            MMUL(t5, P1z, t4),
            MMUL(t4, P2y, t5),
            //Compute h = u2 - u1 (in t2) and r = s2 - s1 (in t4).
            MSUB(t2, t1),
            MSUB(t4, t3),
            // Report cases where r = 0 through the returned flag.
            MTZ(t4),
            // Compute u1*h^2 (in t6) and h^3 (in t5).
            MMUL(t7, t2, t2),
            MMUL(t6, t1, t7),
            MMUL(t5, t7, t2),
            // Compute x3 = r^2 - h^3 - 2*u1*h^2.
            // t1 and t7 can be used as scratch registers.
            MMUL(P1x, t4, t4),
            MSUB(P1x, t5),
            MSUB(P1x, t6),
            MSUB(P1x, t6),
            //Compute y3 = r*(u1*h^2 - x3) - s1*h^3.
            MSUB(t6, P1x),
            MMUL(P1y, t4, t6),
            MMUL(t1, t5, t3),
            MSUB(P1y, t1),
            //Compute z3 = h*z1*z2.
            MMUL(t1, P1z, P2z),
            MMUL(P1z, t1, t2),
            ENDCODE,
        };
        const affine = [_]u16{
            // Save z*R in t1.
            MSET(t1, P1z),
            // Compute z^3 in t2.
            MMUL(t2, P1z, P1z),
            MMUL(t3, P1z, t2),
            MMUL(t2, t3, P2z),
            // Invert to (1/z^3) in t2.
            MINV(t2, t3, t4),
            // Compute y.
            MSET(t3, P1y),
            MMUL(P1y, t2, t3),
            // Compute (1/z^2) in t3.
            MMUL(t3, t2, t1),
            // Compute x.
            MSET(t2, P1x),
            MMUL(P1x, t2, t3),
            ENDCODE,
        };
    };

    fn decode_mod(
        comptime Curve: type,
        x: *[jacobian_len(Curve)]u32,
        src: [Curve.point_len / 2]u8,
    ) u32 {
        const mlen = comptime ((Curve.P[0] + 31) >> 5);
        const tlen = comptime std.math.max(mlen << 2, Curve.point_len / 2) + 4;

        var r: u32 = 0;
        var pass: usize = 0;
        while (pass < 2) : (pass += 1) {
            var v: usize = 1;
            var acc: u32 = 0;
            var acc_len: u32 = 0;

            var u: usize = 0;
            while (u < tlen) : (u += 1) {
                const b = if (u < Curve.point_len / 2)
                    @as(u32, src[Curve.point_len / 2 - 1 - u])
                else
                    0;
                acc |= b << @truncate(u5, acc_len);
                acc_len += 8;
                if (acc_len >= 31) {
                    const xw = acc & 0x7FFFFFFF;
                    acc_len -= 31;
                    acc = b >> @truncate(u5, 8 - acc_len);
                    if (v <= mlen) {
                        if (pass != 0) {
                            x[v] = r & xw;
                        } else {
                            const cc = @bitCast(u32, CMP(xw, Curve.P[v]));
                            r = MUX(EQ(cc, 0), r, cc);
                        }
                    } else if (pass == 0) {
                        r = MUX(EQ(xw, 0), r, 1);
                    }
                    v += 1;
                }
            }
            r >>= 1;
            r |= (r << 1);
        }
        x[0] = Curve.P[0];
        return r & 1;
    }

    fn run_code(
        comptime Curve: type,
        P1: *Jacobian(Curve),
        P2: Jacobian(Curve),
        comptime Code: []const u16,
    ) u32 {
        const jaclen = comptime jacobian_len(Curve);

        var t: [13][jaclen]u32 = undefined;
        var result: u32 = 1;

        t[0..3].* = P1.*;
        t[3..6].* = P2;

        comptime var u: usize = 0;
        inline while (true) : (u += 1) {
            comptime var op = Code[u];
            if (op == 0)
                break;
            const d = comptime (op >> 8) & 0x0F;
            const a = comptime (op >> 4) & 0x0F;
            const b = comptime op & 0x0F;
            op >>= 12;

            switch (op) {
                0 => t[d] = t[a],
                1 => {
                    var ctl = add(&t[d], &t[a], 1);
                    ctl |= NOT(sub(&t[d], &Curve.P, 0));
                    _ = sub(&t[d], &Curve.P, ctl);
                },
                2 => _ = add(&t[d], &Curve.P, sub(&t[d], &t[a], 1)),
                3 => montymul(&t[d], &t[a], &t[b], &Curve.P, 1),
                4 => {
                    var tp: [Curve.point_len / 2]u8 = undefined;
                    encode_jacobian_part(&tp, &Curve.P);
                    tp[Curve.point_len / 2 - 1] -= 2;
                    modpow(Curve, &t[d], tp, 1, &t[a], &t[b]);
                },
                else => result &= ~iszero(&t[d]),
            }
        }
        P1.* = t[0..3].*;
        return result;
    }

    inline fn MUL31(x: u32, y: u32) u64 {
        return @as(u64, x) * @as(u64, y);
    }

    inline fn MUL31_lo(x: u32, y: u32) u32 {
        return (x *% y) & 0x7FFFFFFF;
    }

    inline fn MUX(ctl: u32, x: u32, y: u32) u32 {
        return y ^ (@bitCast(u32, -@bitCast(i32, ctl)) & (x ^ y));
    }
    inline fn NOT(ctl: u32) u32 {
        return ctl ^ 1;
    }
    inline fn NEQ(x: u32, y: u32) u32 {
        const q = x ^ y;
        return (q | @bitCast(u32, -@bitCast(i32, q))) >> 31;
    }
    inline fn EQ(x: u32, y: u32) u32 {
        const q = x ^ y;
        return NOT((q | @bitCast(u32, -@bitCast(i32, q))) >> 31);
    }
    inline fn CMP(x: u32, y: u32) i32 {
        return @bitCast(i32, GT(x, y)) | -@bitCast(i32, GT(y, x));
    }
    inline fn GT(x: u32, y: u32) u32 {
        const z = y -% x;
        return (z ^ ((x ^ y) & (x ^ z))) >> 31;
    }
    inline fn LT(x: u32, y: u32) u32 {
        return GT(y, x);
    }
    inline fn GE(x: u32, y: u32) u32 {
        return NOT(GT(y, x));
    }

    fn CCOPY(ctl: u32, dst: []u8, src: []const u8) void {
        for (src) |s, i| {
            dst[i] = @truncate(u8, MUX(ctl, s, dst[i]));
        }
    }

    inline fn set_zero(out: [*]u32, bit_len: u32) void {
        out[0] = bit_len;
        mem.set(u32, (out + 1)[0 .. (bit_len + 31) >> 5], 0);
    }

    fn divrem(_hi: u32, _lo: u32, d: u32, r: *u32) u32 {
        var hi = _hi;
        var lo = _lo;
        var q: u32 = 0;
        const ch = EQ(hi, d);
        hi = MUX(ch, 0, hi);

        var k: u5 = 31;
        while (k > 0) : (k -= 1) {
            const j = @truncate(u5, 32 - @as(u6, k));
            const w = (hi << j) | (lo >> k);
            const ctl = GE(w, d) | (hi >> k);
            const hi2 = (w -% d) >> j;
            const lo2 = lo -% (d << k);
            hi = MUX(ctl, hi2, hi);
            lo = MUX(ctl, lo2, lo);
            q |= ctl << k;
        }
        const cf = GE(lo, d) | hi;
        q |= cf;
        r.* = MUX(cf, lo -% d, lo);
        return q;
    }

    inline fn div(hi: u32, lo: u32, d: u32) u32 {
        var r: u32 = undefined;
        return divrem(hi, lo, d, &r);
    }

    fn muladd_small(x: [*]u32, z: u32, m: [*]const u32) void {
        var a0: u32 = undefined;
        var a1: u32 = undefined;
        var b0: u32 = undefined;
        const mblr = @intCast(u5, m[0] & 31);
        const mlen = (m[0] + 31) >> 5;
        const hi = x[mlen];
        if (mblr == 0) {
            a0 = x[mlen];
            mem.copyBackwards(u32, (x + 2)[0 .. mlen - 1], (x + 1)[0 .. mlen - 1]);
            x[1] = z;
            a1 = x[mlen];
            b0 = m[mlen];
        } else {
            a0 = ((x[mlen] << (31 - mblr)) | (x[mlen - 1] >> mblr)) & 0x7FFFFFFF;
            mem.copyBackwards(u32, (x + 2)[0 .. mlen - 1], (x + 1)[0 .. mlen - 1]);
            x[1] = z;
            a1 = ((x[mlen] << (31 - mblr)) | (x[mlen - 1] >> mblr)) & 0x7FFFFFFF;
            b0 = ((m[mlen] << (31 - mblr)) | (m[mlen - 1] >> mblr)) & 0x7FFFFFFF;
        }

        const g = div(a0 >> 1, a1 | (a0 << 31), b0);
        const q = MUX(EQ(a0, b0), 0x7FFFFFFF, MUX(EQ(g, 0), 0, g -% 1));

        var cc: u32 = 0;
        var tb: u32 = 1;
        var u: usize = 1;
        while (u <= mlen) : (u += 1) {
            const mw = m[u];
            const zl = MUL31(mw, q) + cc;
            cc = @truncate(u32, zl >> 31);
            const zw = @truncate(u32, zl) & 0x7FFFFFFF;
            const xw = x[u];
            var nxw = xw -% zw;
            cc += nxw >> 31;
            nxw &= 0x7FFFFFFF;
            x[u] = nxw;
            tb = MUX(EQ(nxw, mw), tb, GT(nxw, mw));
        }

        const over = GT(cc, hi);
        const under = ~over & (tb | LT(cc, hi));
        _ = add(x, m, over);
        _ = sub(x, m, under);
    }

    fn to_monty(x: [*]u32, m: [*]const u32) void {
        const mlen = (m[0] + 31) >> 5;
        var k = mlen;
        while (k > 0) : (k -= 1) {
            muladd_small(x, 0, m);
        }
    }

    fn modpow(
        comptime Curve: type,
        x: *[jacobian_len(Curve)]u32,
        e: [Curve.point_len / 2]u8,
        m0i: u32,
        t1: *[jacobian_len(Curve)]u32,
        t2: *[jacobian_len(Curve)]u32,
    ) void {
        t1.* = x.*;
        to_monty(t1, &Curve.P);
        set_zero(x, Curve.P[0]);
        x[1] = 1;
        const bitlen = comptime (Curve.point_len / 2) << 3;
        var k: usize = 0;
        while (k < bitlen) : (k += 1) {
            const ctl = (e[Curve.point_len / 2 - 1 - (k >> 3)] >> (@truncate(u3, k & 7))) & 1;
            montymul(t2, x, t1, &Curve.P, m0i);
            CCOPY(ctl, mem.asBytes(x), mem.asBytes(t2));
            montymul(t2, t1, t1, &Curve.P, m0i);
            t1.* = t2.*;
        }
    }

    fn encode_jacobian_part(dst: []u8, x: [*]const u32) void {
        const xlen = (x[0] + 31) >> 5;

        var buf = @ptrToInt(dst.ptr) + dst.len;
        var len: usize = dst.len;
        var k: usize = 1;
        var acc: u32 = 0;
        var acc_len: u5 = 0;
        while (len != 0) {
            const w = if (k <= xlen) x[k] else 0;
            k += 1;
            if (acc_len == 0) {
                acc = w;
                acc_len = 31;
            } else {
                const z = acc | (w << acc_len);
                acc_len -= 1;
                acc = w >> (31 - acc_len);
                if (len >= 4) {
                    buf -= 4;
                    len -= 4;
                    mem.writeIntBig(u32, @intToPtr([*]u8, buf)[0..4], z);
                } else {
                    switch (len) {
                        3 => {
                            @intToPtr(*u8, buf - 3).* = @truncate(u8, z >> 16);
                            @intToPtr(*u8, buf - 2).* = @truncate(u8, z >> 8);
                        },
                        2 => @intToPtr(*u8, buf - 2).* = @truncate(u8, z >> 8),
                        1 => {},
                        else => unreachable,
                    }
                    @intToPtr(*u8, buf - 1).* = @truncate(u8, z);
                    return;
                }
            }
        }
    }

    fn montymul(
        out: [*]u32,
        x: [*]const u32,
        y: [*]const u32,
        m: [*]const u32,
        m0i: u32,
    ) void {
        const len = (m[0] + 31) >> 5;
        const len4 = len & ~@as(usize, 3);
        set_zero(out, m[0]);
        var dh: u32 = 0;
        var u: usize = 0;
        while (u < len) : (u += 1) {
            const xu = x[u + 1];
            const f = MUL31_lo(out[1] + MUL31_lo(x[u + 1], y[1]), m0i);

            var r: u64 = 0;
            var v: usize = 0;
            while (v < len4) : (v += 4) {
                comptime var j = 1;
                inline while (j <= 4) : (j += 1) {
                    const z = out[v + j] +% MUL31(xu, y[v + j]) +% MUL31(f, m[v + j]) +% r;
                    r = z >> 31;
                    out[v + j - 1] = @truncate(u32, z) & 0x7FFFFFFF;
                }
            }
            while (v < len) : (v += 1) {
                const z = out[v + 1] +% MUL31(xu, y[v + 1]) +% MUL31(f, m[v + 1]) +% r;
                r = z >> 31;
                out[v] = @truncate(u32, z) & 0x7FFFFFFF;
            }
            dh += @truncate(u32, r);
            out[len] = dh & 0x7FFFFFFF;
            dh >>= 31;
        }
        out[0] = m[0];
        const ctl = NEQ(dh, 0) | NOT(sub(out, m, 0));
        _ = sub(out, m, ctl);
    }

    fn add(a: [*]u32, b: [*]const u32, ctl: u32) u32 {
        var u: usize = 1;
        var cc: u32 = 0;
        const m = (a[0] + 63) >> 5;
        while (u < m) : (u += 1) {
            const aw = a[u];
            const bw = b[u];
            const naw = aw +% bw +% cc;
            cc = naw >> 31;
            a[u] = MUX(ctl, naw & 0x7FFFFFFF, aw);
        }
        return cc;
    }

    fn sub(a: [*]u32, b: [*]const u32, ctl: u32) u32 {
        var cc: u32 = 0;
        const m = (a[0] + 63) >> 5;
        var u: usize = 1;
        while (u < m) : (u += 1) {
            const aw = a[u];
            const bw = b[u];
            const naw = aw -% bw -% cc;
            cc = naw >> 31;
            a[u] = MUX(ctl, naw & 0x7FFFFFFF, aw);
        }
        return cc;
    }

    fn iszero(arr: [*]const u32) u32 {
        const mlen = (arr[0] + 63) >> 5;
        var z: u32 = 0;
        var u: usize = mlen - 1;
        while (u > 0) : (u -= 1) {
            z |= arr[u];
        }
        return ~(z | @bitCast(u32, -@bitCast(i32, z))) >> 31;
    }
};

test "elliptic curve functions with secp384r1 curve" {
    {
        // Decode to Jacobian then encode again with no operations
        var P: ecc.Jacobian(ecc.SECP384R1) = undefined;
        _ = ecc.decode_to_jacobian(ecc.SECP384R1, &P, ecc.SECP384R1.base_point);
        var out: [96]u8 = undefined;
        ecc.encode_from_jacobian(ecc.SECP384R1, &out, P);
        try std.testing.expectEqual(ecc.SECP384R1.base_point, out);

        // Multiply by one, check that the result is still the base point
        mem.set(u8, &out, 0);
        ecc.point_mul(ecc.SECP384R1, &P, &[1]u8{1});
        ecc.encode_from_jacobian(ecc.SECP384R1, &out, P);
        try std.testing.expectEqual(ecc.SECP384R1.base_point, out);
    }

    {
        // @TODO Remove this once std.crypto.rand works in .evented mode
        var rand = blk: {
            var seed: [std.rand.DefaultCsprng.secret_seed_length]u8 = undefined;
            try std.os.getrandom(&seed);
            break :blk &std.rand.DefaultCsprng.init(seed).random;
        };

        // Derive a shared secret from a Diffie-Hellman key exchange
        var seed: [48]u8 = undefined;
        rand.bytes(&seed);
        const kp1 = ecc.make_key_pair(ecc.SECP384R1, seed);
        rand.bytes(&seed);
        const kp2 = ecc.make_key_pair(ecc.SECP384R1, seed);

        const shared1 = try ecc.scalarmult(ecc.SECP384R1, kp1.public_key, &kp2.secret_key);
        const shared2 = try ecc.scalarmult(ecc.SECP384R1, kp2.public_key, &kp1.secret_key);
        try std.testing.expectEqual(shared1, shared2);
    }

    // @TODO Add tests with known points.
}
