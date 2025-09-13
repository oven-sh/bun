const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;

/// Check if a character is a word boundary (not alphanumeric)
fn isWordBoundary(c: u8) bool {
    return !std.ascii.isAlphanumeric(c);
}

/// Check if character is uppercase
fn isUpper(c: u8) bool {
    return c >= 'A' and c <= 'Z';
}

/// Check if character is lowercase
fn isLower(c: u8) bool {
    return c >= 'a' and c <= 'z';
}

/// Convert character to uppercase
fn toUpper(c: u8) u8 {
    if (isLower(c)) {
        return c - 32;
    }
    return c;
}

/// Convert character to lowercase
fn toLower(c: u8) u8 {
    if (isUpper(c)) {
        return c + 32;
    }
    return c;
}

/// Split a string into words based on various delimiters and case changes
fn splitIntoWords(allocator: std.mem.Allocator, input: []const u8) !std.ArrayList([]const u8) {
    var words = std.ArrayList([]const u8).init(allocator);
    errdefer words.deinit();

    if (input.len == 0) return words;

    var start: usize = 0;
    var i: usize = 0;

    while (i < input.len) : (i += 1) {
        const c = input[i];
        
        // Skip non-alphanumeric characters
        if (!std.ascii.isAlphanumeric(c)) {
            if (i > start) {
                try words.append(input[start..i]);
            }
            start = i + 1;
            continue;
        }

        // Handle transitions if we're not at the first character
        if (i > 0) {
            const prev = input[i - 1];
            
            // Skip if previous was not alphanumeric (already handled above)
            if (std.ascii.isAlphanumeric(prev)) {
                const prevIsDigit = std.ascii.isDigit(prev);
                const currIsDigit = std.ascii.isDigit(c);
                
                // Check for transitions that should cause splits
                if (!currIsDigit) {
                    // Split on digit to uppercase letter transition (test123Case -> test123, Case)
                    if (prevIsDigit and isUpper(c)) {
                        if (i > start) {
                            try words.append(input[start..i]);
                        }
                        start = i;
                    }
                    // Detect lowercase to uppercase transition (camelCase)
                    else if (!prevIsDigit and isLower(prev) and isUpper(c)) {
                        if (i > start) {
                            try words.append(input[start..i]);
                        }
                        start = i;
                    }
                    // Detect uppercase sequence ending (XMLParser -> XML, Parser)
                    else if (!prevIsDigit and i < input.len - 1) {
                        const next = input[i + 1];
                        if (isUpper(prev) and isUpper(c) and std.ascii.isAlphanumeric(next) and !std.ascii.isDigit(next) and isLower(next)) {
                            if (i > start) {
                                try words.append(input[start..i]);
                            }
                            start = i;
                        }
                    }
                }
            }
        }
    }

    // Add the last word if any
    if (start < input.len) {
        try words.append(input[start..]);
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
        if (word.len == 0) continue;
        
        if (idx == 0) {
            // First word is all lowercase
            for (word) |c| {
                try result.append(toLower(c));
            }
        } else {
            // Subsequent words: capitalize first letter, lowercase rest
            try result.append(toUpper(word[0]));
            for (word[1..]) |c| {
                try result.append(toLower(c));
            }
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
        if (word.len == 0) continue;
        
        // Capitalize first letter, lowercase rest
        try result.append(toUpper(word[0]));
        for (word[1..]) |c| {
            try result.append(toLower(c));
        }
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
        if (word.len == 0) continue;
        
        if (idx > 0) {
            try result.append('_');
        }
        
        for (word) |c| {
            try result.append(toLower(c));
        }
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
        if (word.len == 0) continue;
        
        if (idx > 0) {
            try result.append('-');
        }
        
        for (word) |c| {
            try result.append(toLower(c));
        }
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
        if (word.len == 0) continue;
        
        if (idx > 0) {
            try result.append('_');
        }
        
        for (word) |c| {
            try result.append(toUpper(c));
        }
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
        if (word.len == 0) continue;
        
        if (idx > 0) {
            try result.append('.');
        }
        
        for (word) |c| {
            try result.append(toLower(c));
        }
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
        if (word.len == 0) continue;
        
        if (idx > 0) {
            try result.append(' ');
        }
        
        // Capitalize first letter, lowercase rest
        try result.append(toUpper(word[0]));
        for (word[1..]) |c| {
            try result.append(toLower(c));
        }
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
        if (word.len == 0) continue;
        
        if (idx > 0) {
            try result.append('-');
        }
        
        // Capitalize first letter, lowercase rest
        try result.append(toUpper(word[0]));
        for (word[1..]) |c| {
            try result.append(toLower(c));
        }
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