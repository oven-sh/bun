pub const char_freq_count = 64;
pub const CharAndCount = struct {
    char: u8 = 0,
    count: i32 = 0,
    index: usize = 0,

    pub const Array = [char_freq_count]CharAndCount;

    pub fn lessThan(_: void, a: CharAndCount, b: CharAndCount) bool {
        if (a.count != b.count) {
            return a.count > b.count;
        }

        if (a.index != b.index) {
            return a.index < b.index;
        }

        return a.char < b.char;
    }
};

const Vector = @Vector(char_freq_count, i32);
const Buffer = [char_freq_count]i32;

freqs: Buffer align(1) = undefined,

const scan_big_chunk_size = 32;
pub fn scan(this: *CharFreq, text: string, delta: i32) void {
    if (delta == 0)
        return;

    if (text.len < scan_big_chunk_size) {
        scanSmall(&this.freqs, text, delta);
    } else {
        scanBig(&this.freqs, text, delta);
    }
}

fn scanBig(out: *align(1) Buffer, text: string, delta: i32) void {
    // https://zig.godbolt.org/z/P5dPojWGK
    var freqs = out.*;
    defer out.* = freqs;
    var deltas: [256]i32 = [_]i32{0} ** 256;
    var remain = text;

    bun.assert(remain.len >= scan_big_chunk_size);

    const unrolled = remain.len - (remain.len % scan_big_chunk_size);
    const remain_end = remain.ptr + unrolled;
    var unrolled_ptr = remain.ptr;
    remain = remain[unrolled..];

    while (unrolled_ptr != remain_end) : (unrolled_ptr += scan_big_chunk_size) {
        const chunk = unrolled_ptr[0..scan_big_chunk_size].*;
        inline for (0..scan_big_chunk_size) |i| {
            deltas[@as(usize, chunk[i])] += delta;
        }
    }

    for (remain) |c| {
        deltas[@as(usize, c)] += delta;
    }

    freqs[0..26].* = deltas['a' .. 'a' + 26].*;
    freqs[26 .. 26 * 2].* = deltas['A' .. 'A' + 26].*;
    freqs[26 * 2 .. 62].* = deltas['0' .. '0' + 10].*;
    freqs[62] = deltas['_'];
    freqs[63] = deltas['$'];
}

fn scanSmall(out: *align(1) Buffer, text: string, delta: i32) void {
    var freqs: [char_freq_count]i32 = out.*;
    defer out.* = freqs;

    for (text) |c| {
        const i: usize = switch (c) {
            'a'...'z' => @as(usize, @intCast(c)) - 'a',
            'A'...'Z' => @as(usize, @intCast(c)) - ('A' - 26),
            '0'...'9' => @as(usize, @intCast(c)) + (53 - '0'),
            '_' => 62,
            '$' => 63,
            else => continue,
        };
        freqs[i] += delta;
    }
}

pub fn include(this: *CharFreq, other: CharFreq) void {
    // https://zig.godbolt.org/z/Mq8eK6K9s
    const left: @Vector(char_freq_count, i32) = this.freqs;
    const right: @Vector(char_freq_count, i32) = other.freqs;

    this.freqs = left + right;
}

pub fn compile(this: *const CharFreq, allocator: std.mem.Allocator) NameMinifier {
    const array: CharAndCount.Array = brk: {
        var _array: CharAndCount.Array = undefined;

        for (&_array, NameMinifier.default_tail, this.freqs, 0..) |*dest, char, freq, i| {
            dest.* = CharAndCount{
                .char = char,
                .index = i,
                .count = freq,
            };
        }

        std.sort.pdq(CharAndCount, &_array, {}, CharAndCount.lessThan);

        break :brk _array;
    };

    var minifier = NameMinifier.init(allocator);
    minifier.head.ensureTotalCapacityPrecise(NameMinifier.default_head.len) catch unreachable;
    minifier.tail.ensureTotalCapacityPrecise(NameMinifier.default_tail.len) catch unreachable;
    // TODO: investigate counting number of < 0 and > 0 and pre-allocating
    for (array) |item| {
        if (item.char < '0' or item.char > '9') {
            minifier.head.append(item.char) catch unreachable;
        }
        minifier.tail.append(item.char) catch unreachable;
    }

    return minifier;
}

pub const Class = G.Class;

const string = []const u8;

const bun = @import("bun");
const std = @import("std");

const js_ast = bun.ast;
const CharFreq = js_ast.CharFreq;
const G = js_ast.G;
const NameMinifier = js_ast.NameMinifier;
