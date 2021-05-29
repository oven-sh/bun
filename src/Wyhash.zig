// SPDX-License-Identifier: MIT
// Copyright (c) 2015-2021 Zig Contributors
// This file is part of [zig](https://ziglang.org/), which is MIT licensed.
// The MIT license requires this copyright notice to be included in all copies
// and substantial portions of the software.
const std = @import("std");
const mem = std.mem;

const primes = [_]u64{
    0xa0761d6478bd642f,
    0xe7037ed1a0b428db,
    0x8ebc6af09c88c6e3,
    0x589965cc75374cc3,
    0x1d8e4e27c47d124f,
};

fn read_bytes(comptime bytes: u8, data: []const u8) u64 {
    const T = std.meta.Int(.unsigned, 8 * bytes);
    return mem.readIntLittle(T, data[0..bytes]);
}

fn read_8bytes_swapped(data: []const u8) u64 {
    return (read_bytes(4, data) << 32 | read_bytes(4, data[4..]));
}

fn mum(a: u64, b: u64) u64 {
    var r = std.math.mulWide(u64, a, b);
    r = (r >> 64) ^ r;
    return @truncate(u64, r);
}

fn mix0(a: u64, b: u64, seed: u64) u64 {
    return mum(a ^ seed ^ primes[0], b ^ seed ^ primes[1]);
}

fn mix1(a: u64, b: u64, seed: u64) u64 {
    return mum(a ^ seed ^ primes[2], b ^ seed ^ primes[3]);
}

// Wyhash version which does not store internal state for handling partial buffers.
// This is needed so that we can maximize the speed for the short key case, which will
// use the non-iterative api which the public Wyhash exposes.
pub fn WyhashGenerator(comptime ValueType: type) type {
    return struct {
        seed: u64,
        msg_len: usize,

        pub fn init(seed: u64) WyhashStateless {
            return WyhashStateless{
                .seed = seed,
                .msg_len = 0,
            };
        }

        fn round(self: *WyhashStateless, b: []const u8) void {
            std.debug.assert(b.len == 32);

            self.seed = mix0(
                read_bytes(8, b[0..]),
                read_bytes(8, b[8..]),
                self.seed,
            ) ^ mix1(
                read_bytes(8, b[16..]),
                read_bytes(8, b[24..]),
                self.seed,
            );
        }

        pub fn update(self: *WyhashStateless, b: []const u8) void {
            std.debug.assert(b.len % 32 == 0);

            var off: usize = 0;
            while (off < b.len) : (off += 32) {
                @call(.{ .modifier = .always_inline }, self.round, .{b[off .. off + 32]});
            }

            self.msg_len += b.len;
        }

        pub fn final(self: *WyhashStateless, b: []const u8) u64 {
            std.debug.assert(b.len < 32);

            const seed = self.seed;
            const rem_len = @intCast(u5, b.len);
            const rem_key = b[0..rem_len];

            self.seed = switch (rem_len) {
                0 => seed,
                1 => mix0(read_bytes(1, rem_key), primes[4], seed),
                2 => mix0(read_bytes(2, rem_key), primes[4], seed),
                3 => mix0((read_bytes(2, rem_key) << 8) | read_bytes(1, rem_key[2..]), primes[4], seed),
                4 => mix0(read_bytes(4, rem_key), primes[4], seed),
                5 => mix0((read_bytes(4, rem_key) << 8) | read_bytes(1, rem_key[4..]), primes[4], seed),
                6 => mix0((read_bytes(4, rem_key) << 16) | read_bytes(2, rem_key[4..]), primes[4], seed),
                7 => mix0((read_bytes(4, rem_key) << 24) | (read_bytes(2, rem_key[4..]) << 8) | read_bytes(1, rem_key[6..]), primes[4], seed),
                8 => mix0(read_8bytes_swapped(rem_key), primes[4], seed),
                9 => mix0(read_8bytes_swapped(rem_key), read_bytes(1, rem_key[8..]), seed),
                10 => mix0(read_8bytes_swapped(rem_key), read_bytes(2, rem_key[8..]), seed),
                11 => mix0(read_8bytes_swapped(rem_key), (read_bytes(2, rem_key[8..]) << 8) | read_bytes(1, rem_key[10..]), seed),
                12 => mix0(read_8bytes_swapped(rem_key), read_bytes(4, rem_key[8..]), seed),
                13 => mix0(read_8bytes_swapped(rem_key), (read_bytes(4, rem_key[8..]) << 8) | read_bytes(1, rem_key[12..]), seed),
                14 => mix0(read_8bytes_swapped(rem_key), (read_bytes(4, rem_key[8..]) << 16) | read_bytes(2, rem_key[12..]), seed),
                15 => mix0(read_8bytes_swapped(rem_key), (read_bytes(4, rem_key[8..]) << 24) | (read_bytes(2, rem_key[12..]) << 8) | read_bytes(1, rem_key[14..]), seed),
                16 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed),
                17 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_bytes(1, rem_key[16..]), primes[4], seed),
                18 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_bytes(2, rem_key[16..]), primes[4], seed),
                19 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1((read_bytes(2, rem_key[16..]) << 8) | read_bytes(1, rem_key[18..]), primes[4], seed),
                20 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_bytes(4, rem_key[16..]), primes[4], seed),
                21 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1((read_bytes(4, rem_key[16..]) << 8) | read_bytes(1, rem_key[20..]), primes[4], seed),
                22 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1((read_bytes(4, rem_key[16..]) << 16) | read_bytes(2, rem_key[20..]), primes[4], seed),
                23 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1((read_bytes(4, rem_key[16..]) << 24) | (read_bytes(2, rem_key[20..]) << 8) | read_bytes(1, rem_key[22..]), primes[4], seed),
                24 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), primes[4], seed),
                25 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), read_bytes(1, rem_key[24..]), seed),
                26 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), read_bytes(2, rem_key[24..]), seed),
                27 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), (read_bytes(2, rem_key[24..]) << 8) | read_bytes(1, rem_key[26..]), seed),
                28 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), read_bytes(4, rem_key[24..]), seed),
                29 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), (read_bytes(4, rem_key[24..]) << 8) | read_bytes(1, rem_key[28..]), seed),
                30 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), (read_bytes(4, rem_key[24..]) << 16) | read_bytes(2, rem_key[28..]), seed),
                31 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), (read_bytes(4, rem_key[24..]) << 24) | (read_bytes(2, rem_key[28..]) << 8) | read_bytes(1, rem_key[30..]), seed),
            };

            self.msg_len += b.len;
            return mum(self.seed ^ self.msg_len, primes[4]);
        }

        pub fn hash(seed: u64, value: ValueType) u64 {
            const input = std.mem.asBytes(&value);
            const aligned_len = @sizeOf(value) - (@sizeOf(value) % 32);

            var c = WyhashStateless.init(seed);
            @call(.{ .modifier = .always_inline }, c.update, .{input[0..aligned_len]});
            return @call(.{ .modifier = .always_inline }, c.final, .{input[aligned_len..]});
        }
    };
}
// Wyhash version which does not store internal state for handling partial buffers.
// This is needed so that we can maximize the speed for the short key case, which will
// use the non-iterative api which the public Wyhash exposes.
const WyhashStateless = struct {
    seed: u64,
    msg_len: usize,

    pub fn init(seed: u64) WyhashStateless {
        return WyhashStateless{
            .seed = seed,
            .msg_len = 0,
        };
    }

    fn round(self: *WyhashStateless, b: []const u8) void {
        std.debug.assert(b.len == 32);

        self.seed = mix0(
            read_bytes(8, b[0..]),
            read_bytes(8, b[8..]),
            self.seed,
        ) ^ mix1(
            read_bytes(8, b[16..]),
            read_bytes(8, b[24..]),
            self.seed,
        );
    }

    pub fn update(self: *WyhashStateless, b: []const u8) void {
        std.debug.assert(b.len % 32 == 0);

        var off: usize = 0;
        while (off < b.len) : (off += 32) {
            @call(.{ .modifier = .always_inline }, self.round, .{b[off .. off + 32]});
        }

        self.msg_len += b.len;
    }

    pub fn final(self: *WyhashStateless, b: []const u8) u64 {
        std.debug.assert(b.len < 32);

        const seed = self.seed;
        const rem_len = @intCast(u5, b.len);
        const rem_key = b[0..rem_len];

        self.seed = switch (rem_len) {
            0 => seed,
            1 => mix0(read_bytes(1, rem_key), primes[4], seed),
            2 => mix0(read_bytes(2, rem_key), primes[4], seed),
            3 => mix0((read_bytes(2, rem_key) << 8) | read_bytes(1, rem_key[2..]), primes[4], seed),
            4 => mix0(read_bytes(4, rem_key), primes[4], seed),
            5 => mix0((read_bytes(4, rem_key) << 8) | read_bytes(1, rem_key[4..]), primes[4], seed),
            6 => mix0((read_bytes(4, rem_key) << 16) | read_bytes(2, rem_key[4..]), primes[4], seed),
            7 => mix0((read_bytes(4, rem_key) << 24) | (read_bytes(2, rem_key[4..]) << 8) | read_bytes(1, rem_key[6..]), primes[4], seed),
            8 => mix0(read_8bytes_swapped(rem_key), primes[4], seed),
            9 => mix0(read_8bytes_swapped(rem_key), read_bytes(1, rem_key[8..]), seed),
            10 => mix0(read_8bytes_swapped(rem_key), read_bytes(2, rem_key[8..]), seed),
            11 => mix0(read_8bytes_swapped(rem_key), (read_bytes(2, rem_key[8..]) << 8) | read_bytes(1, rem_key[10..]), seed),
            12 => mix0(read_8bytes_swapped(rem_key), read_bytes(4, rem_key[8..]), seed),
            13 => mix0(read_8bytes_swapped(rem_key), (read_bytes(4, rem_key[8..]) << 8) | read_bytes(1, rem_key[12..]), seed),
            14 => mix0(read_8bytes_swapped(rem_key), (read_bytes(4, rem_key[8..]) << 16) | read_bytes(2, rem_key[12..]), seed),
            15 => mix0(read_8bytes_swapped(rem_key), (read_bytes(4, rem_key[8..]) << 24) | (read_bytes(2, rem_key[12..]) << 8) | read_bytes(1, rem_key[14..]), seed),
            16 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed),
            17 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_bytes(1, rem_key[16..]), primes[4], seed),
            18 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_bytes(2, rem_key[16..]), primes[4], seed),
            19 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1((read_bytes(2, rem_key[16..]) << 8) | read_bytes(1, rem_key[18..]), primes[4], seed),
            20 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_bytes(4, rem_key[16..]), primes[4], seed),
            21 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1((read_bytes(4, rem_key[16..]) << 8) | read_bytes(1, rem_key[20..]), primes[4], seed),
            22 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1((read_bytes(4, rem_key[16..]) << 16) | read_bytes(2, rem_key[20..]), primes[4], seed),
            23 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1((read_bytes(4, rem_key[16..]) << 24) | (read_bytes(2, rem_key[20..]) << 8) | read_bytes(1, rem_key[22..]), primes[4], seed),
            24 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), primes[4], seed),
            25 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), read_bytes(1, rem_key[24..]), seed),
            26 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), read_bytes(2, rem_key[24..]), seed),
            27 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), (read_bytes(2, rem_key[24..]) << 8) | read_bytes(1, rem_key[26..]), seed),
            28 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), read_bytes(4, rem_key[24..]), seed),
            29 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), (read_bytes(4, rem_key[24..]) << 8) | read_bytes(1, rem_key[28..]), seed),
            30 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), (read_bytes(4, rem_key[24..]) << 16) | read_bytes(2, rem_key[28..]), seed),
            31 => mix0(read_8bytes_swapped(rem_key), read_8bytes_swapped(rem_key[8..]), seed) ^ mix1(read_8bytes_swapped(rem_key[16..]), (read_bytes(4, rem_key[24..]) << 24) | (read_bytes(2, rem_key[28..]) << 8) | read_bytes(1, rem_key[30..]), seed),
        };

        self.msg_len += b.len;
        return mum(self.seed ^ self.msg_len, primes[4]);
    }

    pub fn hash(seed: u64, input: []const u8) u64 {
        const aligned_len = input.len - (input.len % 32);

        var c = WyhashStateless.init(seed);
        @call(.{ .modifier = .always_inline }, c.update, .{input[0..aligned_len]});
        return @call(.{ .modifier = .always_inline }, c.final, .{input[aligned_len..]});
    }
};

/// Fast non-cryptographic 64bit hash function.
/// See https://github.com/wangyi-fudan/wyhash
pub const Wyhash = struct {
    state: WyhashStateless,

    buf: [32]u8,
    buf_len: usize,

    pub fn init(seed: u64) Wyhash {
        return Wyhash{
            .state = WyhashStateless.init(seed),
            .buf = undefined,
            .buf_len = 0,
        };
    }

    pub fn update(self: *Wyhash, b: []const u8) void {
        var off: usize = 0;

        if (self.buf_len != 0 and self.buf_len + b.len >= 32) {
            off += 32 - self.buf_len;
            mem.copy(u8, self.buf[self.buf_len..], b[0..off]);
            self.state.update(self.buf[0..]);
            self.buf_len = 0;
        }

        const remain_len = b.len - off;
        const aligned_len = remain_len - (remain_len % 32);
        self.state.update(b[off .. off + aligned_len]);

        mem.copy(u8, self.buf[self.buf_len..], b[off + aligned_len ..]);
        self.buf_len += @intCast(u8, b[off + aligned_len ..].len);
    }

    pub fn final(self: *Wyhash) u64 {
        const seed = self.state.seed;
        const rem_len = @intCast(u5, self.buf_len);
        const rem_key = self.buf[0..self.buf_len];

        return self.state.final(rem_key);
    }

    pub fn hash(seed: u64, input: []const u8) u64 {
        return WyhashStateless.hash(seed, input);
    }
};

const expectEqual = std.testing.expectEqual;

test "test vectors" {
    const hash = Wyhash.hash;

    try expectEqual(hash(0, ""), 0x0);
    try expectEqual(hash(1, "a"), 0xbed235177f41d328);
    try expectEqual(hash(2, "abc"), 0xbe348debe59b27c3);
    try expectEqual(hash(3, "message digest"), 0x37320f657213a290);
    try expectEqual(hash(4, "abcdefghijklmnopqrstuvwxyz"), 0xd0b270e1d8a7019c);
    try expectEqual(hash(5, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"), 0x602a1894d3bbfe7f);
    try expectEqual(hash(6, "12345678901234567890123456789012345678901234567890123456789012345678901234567890"), 0x829e9c148b75970e);
}

test "test vectors streaming" {
    var wh = Wyhash.init(5);
    for ("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") |e| {
        wh.update(mem.asBytes(&e));
    }
    try expectEqual(wh.final(), 0x602a1894d3bbfe7f);

    const pattern = "1234567890";
    const count = 8;
    const result = 0x829e9c148b75970e;
    try expectEqual(Wyhash.hash(6, pattern ** 8), result);

    wh = Wyhash.init(6);
    var i: u32 = 0;
    while (i < count) : (i += 1) {
        wh.update(pattern);
    }
    try expectEqual(wh.final(), result);
}

test "iterative non-divisible update" {
    var buf: [8192]u8 = undefined;
    for (buf) |*e, i| {
        e.* = @truncate(u8, i);
    }

    const seed = 0x128dad08f;

    var end: usize = 32;
    while (end < buf.len) : (end += 32) {
        const non_iterative_hash = Wyhash.hash(seed, buf[0..end]);

        var wy = Wyhash.init(seed);
        var i: usize = 0;
        while (i < end) : (i += 33) {
            wy.update(buf[i..std.math.min(i + 33, end)]);
        }
        const iterative_hash = wy.final();

        try std.testing.expectEqual(iterative_hash, non_iterative_hash);
    }
}
