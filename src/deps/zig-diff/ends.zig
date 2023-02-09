const std = @import("std");
const testing = std.testing;
const unicode = std.unicode;
const Range = @import("range.zig").Range;

/// Returns the common prefix length in _bytes_. It also advances the iterators.
pub fn findCommonPrefix(a: Range, b: Range) Range {
    var bytesPrefix = findCommonPrefixBytes(a, b);
    alignUtf8(&bytesPrefix);
    return bytesPrefix;
}

fn assertCommonPrefix(a: []const u8, b: []const u8, expectedPrefix: []const u8) !void {
    const prefix = findCommonPrefix(Range.new(a), Range.new(b));
    try testing.expectEqualSlices(u8, expectedPrefix, prefix.subslice());
    try testing.expectEqualSlices(u8, expectedPrefix, b[0..prefix.end]);
}

test "ascii prefix" {
    try assertCommonPrefix("fufufufafafa", "fufufufefefe", "fufufuf");
}

test "simple multibyte prefix" {
    try assertCommonPrefix("Πλωτῖνος", "Πλάτων", "Πλ");
}

test "tricky multibyte prefix" {
    const snowman = "\u{2603}";
    const comet = "\u{2604}";
    try assertCommonPrefix(snowman, comet, "");
    try assertCommonPrefix("abba " ++ snowman, "abba " ++ comet, "abba ");
}

/// Returns the common suffix length in _bytes_.
pub fn findCommonSuffix(a: Range, b: Range) Range {
    var bytesSuffix = findCommonSuffixBytes(a, b);
    alignUtf8(&bytesSuffix);
    return bytesSuffix;
}

fn assertCommonSuffix(a: []const u8, b: []const u8, expectedSuffix: []const u8) !void {
    const suffix = findCommonSuffix(Range.new(a), Range.new(b));
    try testing.expectEqualSlices(u8, expectedSuffix, suffix.subslice());
}

test "ascii suffix" {
    try assertCommonSuffix("laurel", "hardy", "");
    try assertCommonSuffix("left", "right", "t");
    try assertCommonSuffix("", "right", "");
    try assertCommonSuffix("left", "", "");
    try assertCommonSuffix("fufufufafafafefefe", "fififofefefe", "fefefe");
}

test "ascii suffix of multibyte stringss" {
    const left = "[乀丁abcd一]";
    const right = "[一abcd丁]";
    try assertCommonSuffix(left, right, "]");
}

/// Returns the common suffix in _bytes_, ignoring utf-8 character boundaries.
pub fn findCommonSuffixBytes(a: Range, b: Range) Range {
    const max = @intCast(u32, std.math.min(a.len(), b.len()));

    if (max == 0) {
        return Range.new("");
    }

    var i: u32 = 0;

    while (i < max and a.subslice()[(a.len() - 1) - i] == b.subslice()[(b.len() - 1) - i]) {
        i += 1;
    }

    return a.lastN(i);
}

/// Returns the common suffix, ignoring utf-8 character boundaries.
pub fn findCommonPrefixBytes(a: Range, b: Range) Range {
    const max = std.math.min(a.len(), b.len());
    var i: u32 = 0;
    while (i < max and a.subslice()[i] == b.subslice()[i]) : (i += 1) {}
    return a.firstN(i);
}

///// Given an arbitrary index in a byte slice, return the index of the first
///// byte of the _next_ valid UTF-8 sequence.
/////
///// Invariant: alignUtf8Forward(s, idx) >= idx.
//pub fn alignUtf8Forward(s: []const u8, idx: *usize) void {
//    while (idx.* < s.len) {
//        _ = unicode.utf8ByteSequenceLength(s[idx.*]) catch {
//            idx.* += 1;
//            continue;
//        };
//        break;
//    }
//}

/// Given an arbitrary byte slice, extend it to UTF-8 character boundaries.
///
/// This is made with commonPrefix and commonSuffix in mind: on the right, it
/// will clamp the end of the range to the _end of the last complete common
/// UTF-8 sequence_. On the left, it will clamp the start of the range to the
/// _beginning of the first common UTF-8 sequence_.
pub fn alignUtf8(s: *Range) void {
    // left
    while (true) {
        if (s.len() == 0) {
            return;
        }

        _ = unicode.utf8ByteSequenceLength(s.subslice()[0]) catch {
            s.* = s.shrinkLeft(1);
            continue;
        };
        break;
    }

    if (s.end == s.txt.len) {
        return;
    }

    // right
    while (true) {
        if (s.len() == 0) {
            return;
        }

        _ = unicode.utf8ByteSequenceLength(s.txt[s.end]) catch {
            s.* = s.shrinkRight(1);
            continue;
        };
        break;
    }

    std.debug.assert(unicode.utf8ValidateSlice(s.subslice()));
}
