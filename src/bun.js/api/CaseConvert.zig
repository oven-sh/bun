const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;

/// Check if a Unicode codepoint is a letter
fn isLetter(codepoint: u21) bool {
    // Basic Latin letters
    if ((codepoint >= 'A' and codepoint <= 'Z') or (codepoint >= 'a' and codepoint <= 'z')) {
        return true;
    }
    // Extended Latin and other alphabetic ranges
    // This covers most common accented characters
    if ((codepoint >= 0xC0 and codepoint <= 0xFF and codepoint != 0xD7 and codepoint != 0xF7) or // Latin-1 Supplement letters
        (codepoint >= 0x100 and codepoint <= 0x17F) or // Latin Extended-A
        (codepoint >= 0x180 and codepoint <= 0x24F) or // Latin Extended-B and IPA
        (codepoint >= 0x1E00 and codepoint <= 0x1EFF)) // Latin Extended Additional
    {
        return true;
    }
    return false;
}

/// Check if a Unicode codepoint is uppercase
fn isUpper(codepoint: u21) bool {
    // ASCII uppercase
    if (codepoint >= 'A' and codepoint <= 'Z') {
        return true;
    }
    // Latin-1 Supplement uppercase (À-Þ, except ×)
    if (codepoint >= 0xC0 and codepoint <= 0xDE and codepoint != 0xD7) {
        return true;
    }
    // Simple heuristic for other Latin uppercase: even positions in extended ranges
    // This is not perfect but covers many common cases
    if ((codepoint >= 0x100 and codepoint <= 0x17F) or
        (codepoint >= 0x1E00 and codepoint <= 0x1EFF))
    {
        return (codepoint & 1) == 0;
    }
    return false;
}

/// Check if a Unicode codepoint is lowercase
fn isLower(codepoint: u21) bool {
    // ASCII lowercase
    if (codepoint >= 'a' and codepoint <= 'z') {
        return true;
    }
    // Latin-1 Supplement lowercase (ß-ÿ, except ÷)
    if (codepoint >= 0xDF and codepoint <= 0xFF and codepoint != 0xF7) {
        return true;
    }
    // Simple heuristic for other Latin lowercase: odd positions in extended ranges
    if ((codepoint >= 0x100 and codepoint <= 0x17F) or
        (codepoint >= 0x1E00 and codepoint <= 0x1EFF))
    {
        return (codepoint & 1) == 1;
    }
    return false;
}

/// Convert a Unicode codepoint to uppercase
fn toUpperCodepoint(codepoint: u21) u21 {
    // ASCII
    if (codepoint >= 'a' and codepoint <= 'z') {
        return codepoint - 32;
    }
    // Latin-1 Supplement
    if (codepoint >= 0xE0 and codepoint <= 0xFE and codepoint != 0xF7) {
        return codepoint - 32;
    }
    // Latin Extended: odd to even (simplified)
    if ((codepoint >= 0x101 and codepoint <= 0x17F) or
        (codepoint >= 0x1E01 and codepoint <= 0x1EFF))
    {
        if ((codepoint & 1) == 1) {
            return codepoint - 1;
        }
    }
    return codepoint;
}

/// Convert a Unicode codepoint to lowercase
fn toLowerCodepoint(codepoint: u21) u21 {
    // ASCII
    if (codepoint >= 'A' and codepoint <= 'Z') {
        return codepoint + 32;
    }
    // Latin-1 Supplement
    if (codepoint >= 0xC0 and codepoint <= 0xDE and codepoint != 0xD7) {
        return codepoint + 32;
    }
    // Latin Extended: even to odd (simplified)
    if ((codepoint >= 0x100 and codepoint <= 0x17E) or
        (codepoint >= 0x1E00 and codepoint <= 0x1EFE))
    {
        if ((codepoint & 1) == 0) {
            return codepoint + 1;
        }
    }
    return codepoint;
}

/// Check if a codepoint is alphanumeric
fn isAlphanumeric(codepoint: u21) bool {
    return isLetter(codepoint) or (codepoint >= '0' and codepoint <= '9');
}

/// Check if a codepoint is a digit
fn isDigit(codepoint: u21) bool {
    return codepoint >= '0' and codepoint <= '9';
}

/// Represents a word extracted from the input
const Word = struct {
    bytes: []const u8,
    
    /// Write the word to output with specified case transformation
    fn writeTo(self: Word, writer: anytype, comptime transform: enum { lower, upper, capital }) !void {
        var iter = std.unicode.Utf8Iterator{ .bytes = self.bytes, .i = 0 };
        var first = true;
        
        while (iter.nextCodepoint()) |codepoint| {
            const transformed = switch (transform) {
                .lower => toLowerCodepoint(codepoint),
                .upper => toUpperCodepoint(codepoint),
                .capital => if (first) toUpperCodepoint(codepoint) else toLowerCodepoint(codepoint),
            };
            first = false;
            
            var buf: [4]u8 = undefined;
            const len = std.unicode.utf8Encode(transformed, &buf) catch {
                // If encoding fails, just write original codepoint
                const orig_len = std.unicode.utf8Encode(codepoint, &buf) catch 1;
                try writer.writeAll(buf[0..orig_len]);
                continue;
            };
            try writer.writeAll(buf[0..len]);
        }
    }
};

/// Split a UTF-8 string into words based on various delimiters and case changes
fn splitIntoWords(allocator: std.mem.Allocator, input: []const u8) !std.ArrayList(Word) {
    var words = std.ArrayList(Word).init(allocator);
    errdefer words.deinit();

    if (input.len == 0) return words;

    var iter = std.unicode.Utf8Iterator{ .bytes = input, .i = 0 };
    var word_start: usize = 0;
    var prev_codepoint: ?u21 = null;
    var prev_was_lower = false;
    var prev_was_upper = false;
    var prev_was_digit = false;
    
    while (iter.i < input.len) {
        const start_pos = iter.i;
        const codepoint = iter.nextCodepoint() orelse break;
        
        const is_alnum = isAlphanumeric(codepoint);
        const is_digit = isDigit(codepoint);
        const is_lower = isLower(codepoint);
        const is_upper = isUpper(codepoint);
        
        // Handle word boundaries
        if (!is_alnum) {
            // Non-alphanumeric character - end current word
            if (start_pos > word_start) {
                try words.append(Word{ .bytes = input[word_start..start_pos] });
            }
            word_start = iter.i;
            prev_codepoint = null;
            prev_was_lower = false;
            prev_was_upper = false;
            prev_was_digit = false;
            continue;
        }
        
        // Check for transitions that should split words
        if (prev_codepoint) |_| {
            var should_split = false;
            
            // Split on digit to uppercase letter transition (test123Case -> test123, Case)
            if (prev_was_digit and is_upper and !is_digit) {
                should_split = true;
            }
            // Split on lowercase to uppercase transition (camelCase -> camel, Case)
            else if (prev_was_lower and is_upper and !is_digit) {
                should_split = true;
            }
            // Split on uppercase sequence ending (XMLParser -> XML, Parser)
            else if (prev_was_upper and is_upper and !is_digit) {
                // Look ahead to see if next is lowercase
                const saved_i = iter.i;
                if (iter.nextCodepoint()) |next_cp| {
                    if (isLower(next_cp)) {
                        should_split = true;
                    }
                }
                iter.i = saved_i;
            }
            
            if (should_split) {
                if (start_pos > word_start) {
                    try words.append(Word{ .bytes = input[word_start..start_pos] });
                }
                word_start = start_pos;
            }
        }
        
        prev_codepoint = codepoint;
        prev_was_lower = is_lower;
        prev_was_upper = is_upper;
        prev_was_digit = is_digit;
    }
    
    // Add the last word if any
    if (word_start < input.len) {
        try words.append(Word{ .bytes = input[word_start..] });
    }
    
    return words;
}

/// Convert string to camelCase: "two words" -> "twoWords"
pub fn camelCase(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const words = try splitIntoWords(allocator, input);
    defer words.deinit();
    
    if (words.items.len == 0) return try allocator.alloc(u8, 0);
    
    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();
    
    for (words.items, 0..) |word, idx| {
        if (word.bytes.len == 0) continue;
        
        if (idx == 0) {
            try word.writeTo(result.writer(), .lower);
        } else {
            try word.writeTo(result.writer(), .capital);
        }
    }
    
    return result.toOwnedSlice();
}

/// Convert string to PascalCase: "two words" -> "TwoWords"
pub fn pascalCase(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const words = try splitIntoWords(allocator, input);
    defer words.deinit();
    
    if (words.items.len == 0) return try allocator.alloc(u8, 0);
    
    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();
    
    for (words.items) |word| {
        if (word.bytes.len == 0) continue;
        try word.writeTo(result.writer(), .capital);
    }
    
    return result.toOwnedSlice();
}

/// Convert string to snake_case: "two words" -> "two_words"
pub fn snakeCase(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const words = try splitIntoWords(allocator, input);
    defer words.deinit();
    
    if (words.items.len == 0) return try allocator.alloc(u8, 0);
    
    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();
    
    for (words.items, 0..) |word, idx| {
        if (word.bytes.len == 0) continue;
        
        if (idx > 0) {
            try result.append('_');
        }
        try word.writeTo(result.writer(), .lower);
    }
    
    return result.toOwnedSlice();
}

/// Convert string to kebab-case: "two words" -> "two-words"
pub fn kebabCase(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const words = try splitIntoWords(allocator, input);
    defer words.deinit();
    
    if (words.items.len == 0) return try allocator.alloc(u8, 0);
    
    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();
    
    for (words.items, 0..) |word, idx| {
        if (word.bytes.len == 0) continue;
        
        if (idx > 0) {
            try result.append('-');
        }
        try word.writeTo(result.writer(), .lower);
    }
    
    return result.toOwnedSlice();
}

/// Convert string to SCREAMING_SNAKE_CASE: "two words" -> "TWO_WORDS"
pub fn screamingSnakeCase(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const words = try splitIntoWords(allocator, input);
    defer words.deinit();
    
    if (words.items.len == 0) return try allocator.alloc(u8, 0);
    
    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();
    
    for (words.items, 0..) |word, idx| {
        if (word.bytes.len == 0) continue;
        
        if (idx > 0) {
            try result.append('_');
        }
        try word.writeTo(result.writer(), .upper);
    }
    
    return result.toOwnedSlice();
}

/// Alias for screamingSnakeCase for compatibility
pub const constantCase = screamingSnakeCase;

/// Convert string to dot.case: "two words" -> "two.words"
pub fn dotCase(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const words = try splitIntoWords(allocator, input);
    defer words.deinit();
    
    if (words.items.len == 0) return try allocator.alloc(u8, 0);
    
    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();
    
    for (words.items, 0..) |word, idx| {
        if (word.bytes.len == 0) continue;
        
        if (idx > 0) {
            try result.append('.');
        }
        try word.writeTo(result.writer(), .lower);
    }
    
    return result.toOwnedSlice();
}

/// Convert string to Capital Case: "two words" -> "Two Words"
pub fn capitalCase(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const words = try splitIntoWords(allocator, input);
    defer words.deinit();
    
    if (words.items.len == 0) return try allocator.alloc(u8, 0);
    
    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();
    
    for (words.items, 0..) |word, idx| {
        if (word.bytes.len == 0) continue;
        
        if (idx > 0) {
            try result.append(' ');
        }
        try word.writeTo(result.writer(), .capital);
    }
    
    return result.toOwnedSlice();
}

/// Convert string to Train-Case: "two words" -> "Two-Words"
pub fn trainCase(allocator: std.mem.Allocator, input: []const u8) ![]u8 {
    const words = try splitIntoWords(allocator, input);
    defer words.deinit();
    
    if (words.items.len == 0) return try allocator.alloc(u8, 0);
    
    var result = std.ArrayList(u8).init(allocator);
    errdefer result.deinit();
    
    for (words.items, 0..) |word, idx| {
        if (word.bytes.len == 0) continue;
        
        if (idx > 0) {
            try result.append('-');
        }
        try word.writeTo(result.writer(), .capital);
    }
    
    return result.toOwnedSlice();
}

/// Generic case conversion function that handles string extraction and conversion
fn convertCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame, comptime converter: fn (std.mem.Allocator, []const u8) anyerror![]u8) bun.JSError!JSValue {
    const arguments = callFrame.arguments_old(1);
    if (arguments.len < 1) {
        return globalThis.throw("expected 1 argument, got 0", .{});
    }

    const input_value = arguments.ptr[0];
    
    // Convert to string
    const bunstr = try input_value.toBunString(globalThis);
    if (globalThis.hasException()) return .zero;
    defer bunstr.deref();
    
    // Get UTF8 bytes
    const allocator = bun.default_allocator;
    const utf8_slice = bunstr.toUTF8(allocator);
    defer utf8_slice.deinit();
    
    // Apply the conversion
    const result_bytes = converter(allocator, utf8_slice.slice()) catch |err| {
        if (err == error.OutOfMemory) {
            return globalThis.throwOutOfMemory();
        }
        return globalThis.throw("case conversion failed", .{});
    };
    defer allocator.free(result_bytes);
    
    // Create a new string from the result  
    var result_str = bun.String.cloneUTF8(result_bytes);
    return result_str.transferToJS(globalThis);
}

// JavaScript-exposed functions
pub fn jsCamelCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return convertCase(globalThis, callFrame, camelCase);
}

pub fn jsPascalCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return convertCase(globalThis, callFrame, pascalCase);
}

pub fn jsSnakeCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return convertCase(globalThis, callFrame, snakeCase);
}

pub fn jsKebabCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return convertCase(globalThis, callFrame, kebabCase);
}

pub fn jsScreamingSnakeCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return convertCase(globalThis, callFrame, screamingSnakeCase);
}

// Alias for compatibility
pub const jsConstantCase = jsScreamingSnakeCase;

pub fn jsDotCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return convertCase(globalThis, callFrame, dotCase);
}

pub fn jsCapitalCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return convertCase(globalThis, callFrame, capitalCase);
}

pub fn jsTrainCase(globalThis: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    return convertCase(globalThis, callFrame, trainCase);
}