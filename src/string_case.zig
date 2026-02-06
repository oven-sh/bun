/// Case-changing utility methods matching the `change-case` npm package.
/// Exposes 11 case conversion functions: camelCase, pascalCase, snakeCase,
/// kebabCase, constantCase, dotCase, capitalCase, trainCase, pathCase,
/// sentenceCase, noCase.
///
/// Word splitting matches `change-case`'s three-phase approach:
/// 1. Lower/digit → upper boundary
/// 2. Upper → upper+lower boundary (e.g., "XMLParser" → "XML" + "Parser")
/// 3. Non-letter/non-digit separators
pub const CaseType = enum {
    camel,
    pascal,
    snake,
    kebab,
    constant,
    dot,
    capital,
    train,
    path,
    sentence,
    no,

    fn separator(self: CaseType) ?u8 {
        return switch (self) {
            .camel, .pascal => null,
            .snake, .constant => '_',
            .kebab, .train => '-',
            .dot => '.',
            .capital, .sentence, .no => ' ',
            .path => '/',
        };
    }

    fn hasDigitPrefixUnderscore(self: CaseType) bool {
        return self == .camel or self == .pascal;
    }

    fn getTransform(self: CaseType, word_index: usize) WordTransform {
        return switch (self) {
            .camel => if (word_index == 0) .lower else .capitalize,
            .pascal => .capitalize,
            .snake, .kebab, .dot, .path, .no => .lower,
            .constant => .upper,
            .capital, .train => .capitalize,
            .sentence => if (word_index == 0) .capitalize else .lower,
        };
    }
};

const WordTransform = enum { lower, upper, capitalize };

const CaseOp = enum { lower, upper };

const CharClass = enum { lower, upper, digit, other };

const WordRange = struct { start: u32, end: u32 };

fn classifyCp(c: u32) CharClass {
    if (c < 0x80) {
        const b: u8 = @intCast(c);
        if (std.ascii.isLower(b)) return .lower;
        if (std.ascii.isUpper(b)) return .upper;
        if (std.ascii.isDigit(b)) return .digit;
        return .other;
    }
    if (icu_hasBinaryProperty(c, uchar_uppercase)) return .upper;
    if (icu_hasBinaryProperty(c, uchar_alphabetic)) return .lower;
    return .other;
}

/// Encode a codepoint as UTF-8 and append to result buffer.
fn appendCodepoint(result: *std.array_list.Managed(u8), cp: u21) !void {
    var buf: [4]u8 = undefined;
    const len = strings.encodeWTF8RuneT(&buf, u21, cp);
    try result.appendSlice(buf[0..len]);
}

/// Apply case conversion to a codepoint using ICU.
fn transformCp(cp: u32, op: CaseOp) u21 {
    return @intCast(switch (op) {
        .upper => icu_toUpper(cp),
        .lower => icu_toLower(cp),
    });
}

/// Core conversion function. Takes UTF-8 input, produces UTF-8 output.
pub fn convert(case_type: CaseType, input: []const u8, allocator: std.mem.Allocator) ![]u8 {
    var result = std.array_list.Managed(u8).init(allocator);
    errdefer result.deinit();
    try result.ensureTotalCapacity(input.len + input.len / 4);

    // Two-pass approach:
    // Pass 1: Find word boundaries using codepoint iteration
    // Pass 2: For each word, iterate codepoints and apply case transform

    var boundary_iter = WordBoundaryIterator.init(input);
    var word_index: usize = 0;

    while (boundary_iter.next()) |word_range| {
        // Separator between words
        if (word_index > 0) {
            if (case_type.separator()) |sep| {
                try result.append(sep);
            }
        }

        // Digit-prefix underscore for camelCase/pascalCase
        if (word_index > 0 and case_type.hasDigitPrefixUnderscore()) {
            if (word_range.start < input.len and input[word_range.start] < 0x80 and
                std.ascii.isDigit(input[word_range.start]))
            {
                try result.append('_');
            }
        }

        const transform = case_type.getTransform(word_index);

        // Iterate codepoints within the word and apply transform
        var cp_iter = strings.UnsignedCodepointIterator.init(input[word_range.start..word_range.end]);
        var cursor = strings.UnsignedCodepointIterator.Cursor{};
        var is_first = true;

        while (cp_iter.next(&cursor)) {
            const char_op: CaseOp = switch (transform) {
                .lower => .lower,
                .upper => .upper,
                .capitalize => if (is_first) .upper else .lower,
            };
            is_first = false;
            try appendCodepoint(&result, transformCp(cursor.c, char_op));
        }

        word_index += 1;
    }

    return result.toOwnedSlice();
}

/// Iterates over word boundaries in UTF-8 input, yielding byte ranges.
///
/// Implements the three-phase word splitting from `change-case`:
/// 1. Lower/digit → upper boundary ("camelCase" → "camel" + "Case")
/// 2. Upper → upper+lower boundary ("XMLParser" → "XML" + "Parser")
/// 3. Non-letter/non-digit separators
const WordBoundaryIterator = struct {
    cp_iter: strings.UnsignedCodepointIterator,
    cursor: strings.UnsignedCodepointIterator.Cursor = .{},
    prev_class: CharClass = .other,
    prev_prev_class: CharClass = .other,
    prev_byte_pos: u32 = 0,
    in_word: bool = false,
    word_start: u32 = 0,
    word_end: u32 = 0,
    eof: bool = false,

    fn init(input: []const u8) WordBoundaryIterator {
        return .{ .cp_iter = strings.UnsignedCodepointIterator.init(input) };
    }

    fn next(self: *WordBoundaryIterator) ?WordRange {
        while (!self.eof) {
            if (!self.cp_iter.next(&self.cursor)) {
                self.eof = true;
                // Flush last word
                if (self.in_word) {
                    self.in_word = false;
                    return WordRange{ .start = self.word_start, .end = self.word_end };
                }
                return null;
            }

            const cur_class = classifyCp(self.cursor.c);
            const cur_pos = self.cursor.i;
            const cur_end = self.cursor.i + self.cursor.width;

            if (cur_class == .other) {
                // Separator: end current word if any
                if (self.in_word) {
                    self.in_word = false;
                    self.prev_class = .other;
                    self.prev_prev_class = .other;
                    return WordRange{ .start = self.word_start, .end = self.word_end };
                }
                self.prev_class = .other;
                self.prev_prev_class = .other;
                continue;
            }

            if (!self.in_word) {
                // Start new word
                self.in_word = true;
                self.word_start = cur_pos;
                self.word_end = cur_end;
                self.prev_prev_class = .other;
                self.prev_class = cur_class;
                self.prev_byte_pos = cur_pos;
                continue;
            }

            // Rule 2: upper+upper+lower → boundary before the last upper
            if (self.prev_prev_class == .upper and self.prev_class == .upper and cur_class == .lower) {
                const completed_word = WordRange{ .start = self.word_start, .end = self.prev_byte_pos };
                self.word_start = self.prev_byte_pos;
                self.word_end = cur_end;
                self.prev_prev_class = self.prev_class;
                self.prev_class = cur_class;
                self.prev_byte_pos = cur_pos;
                return completed_word;
            }

            // Rule 1: (lower | digit) → upper boundary
            if ((self.prev_class == .lower or self.prev_class == .digit) and cur_class == .upper) {
                const completed_word = WordRange{ .start = self.word_start, .end = self.word_end };
                self.word_start = cur_pos;
                self.word_end = cur_end;
                self.prev_prev_class = .other;
                self.prev_class = cur_class;
                self.prev_byte_pos = cur_pos;
                return completed_word;
            }

            // No boundary, extend current word
            self.word_end = cur_end;
            self.prev_prev_class = self.prev_class;
            self.prev_class = cur_class;
            self.prev_byte_pos = cur_pos;
        }

        return null;
    }
};

/// JS callback wrapper. Extracts a string argument and performs case conversion.
fn caseChangeJS(case_type: CaseType, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const arg = callframe.argument(0);
    if (!arg.isString()) {
        return globalThis.throwInvalidArguments("Expected a string argument", .{});
    }

    const bunstr = try arg.toBunString(globalThis);
    if (globalThis.hasException()) return .zero;
    defer bunstr.deref();

    if (bunstr.isEmpty()) {
        return bun.String.empty.toJS(globalThis);
    }

    const utf8_slice = bunstr.toUTF8(bun.default_allocator);
    defer utf8_slice.deinit();

    const result_bytes = convert(case_type, utf8_slice.slice(), bun.default_allocator) catch {
        return globalThis.throwOutOfMemory();
    };
    defer bun.default_allocator.free(result_bytes);

    var str = bun.String.cloneUTF8(result_bytes);
    return str.transferToJS(globalThis);
}

// --- Public JS callback functions ---

pub fn camelCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.camel, globalThis, callframe);
}

pub fn pascalCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.pascal, globalThis, callframe);
}

pub fn snakeCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.snake, globalThis, callframe);
}

pub fn kebabCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.kebab, globalThis, callframe);
}

pub fn constantCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.constant, globalThis, callframe);
}

pub fn dotCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.dot, globalThis, callframe);
}

pub fn capitalCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.capital, globalThis, callframe);
}

pub fn trainCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.train, globalThis, callframe);
}

pub fn pathCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.path, globalThis, callframe);
}

pub fn sentenceCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.sentence, globalThis, callframe);
}

pub fn noCase(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    return caseChangeJS(.no, globalThis, callframe);
}

// --- ICU extern functions ---
extern fn icu_toUpper(cp: u32) u32;
extern fn icu_toLower(cp: u32) u32;
extern fn icu_hasBinaryProperty(cp: u32, which: c_uint) bool;

const uchar_uppercase = 30; // UCHAR_UPPERCASE
const uchar_alphabetic = 0; // UCHAR_ALPHABETIC

const bun = @import("bun");
const std = @import("std");
const strings = bun.strings;
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
