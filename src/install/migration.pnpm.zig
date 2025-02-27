const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const logger = bun.logger;
const File = bun.sys.File;

const Install = @import("./install.zig");
const Resolution = @import("./resolution.zig").Resolution;
const Dependency = @import("./dependency.zig");
const VersionedURL = @import("./versioned_url.zig");
const Npm = @import("./npm.zig");
const Integrity = @import("./integrity.zig").Integrity;
const Bin = @import("./bin.zig").Bin;
const Lockfile = @import("./lockfile.zig");
const LoadResult = Lockfile.LoadResult;

const Semver = bun.Semver;
const String = Semver.String;
const ExternalString = Semver.ExternalString;
const stringHash = String.Builder.stringHash;

const JSAst = bun.JSAst;
const Expr = JSAst.Expr;
const B = JSAst.B;
const E = JSAst.E;
const G = JSAst.G;
const S = JSAst.S;

const debug = Output.scoped(.migrate_pnpm, false);

pub const YamlLexer = struct {
    pub const Token = enum {
        eof,
        string,
        number,
        boolean,
        colon,
        dash,
        newline,
        indent,
        dedent,
        flow_object, // Token type for YAML flow-style objects like {key: value}
        flow_key,    // Token type for key inside flow object
        flow_value,  // Token type for value inside flow object
        left_brace,  // { character
        right_brace, // } character
        comma,       // , character in flow objects
    };
    
    source: logger.Source,
    log: *logger.Log,
    start: usize = 0,
    end: usize = 0,
    current: usize = 0,
    
    allocator: std.mem.Allocator,
    
    code_point: i32 = -1,
    line_number: u32 = 0,
    indentation: u32 = 0,
    
    token: Token = .eof,
    string_literal: string = "",
    number_value: f64 = 0.0,
    boolean_value: bool = false,
    
    indentation_stack: std.ArrayList(u32),
    
    pub fn init(log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator) !YamlLexer {
        var lexer = YamlLexer{
            .log = log,
            .source = source,
            .allocator = allocator,
            .indentation_stack = std.ArrayList(u32).init(allocator),
        };
        
        try lexer.indentation_stack.append(0);
        lexer.step();
        try lexer.next();
        
        return lexer;
    }
    
    pub fn deinit(self: *YamlLexer) void {
        self.indentation_stack.deinit();
    }
    
    inline fn nextCodepoint(self: *YamlLexer) i32 {
        if (self.current >= self.source.contents.len) return -1;
        
        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(self.source.contents.ptr[self.current]);
        const slice = if (!(cp_len + self.current > self.source.contents.len)) self.source.contents[self.current .. cp_len + self.current] else "";
        
        const code_point = switch (slice.len) {
            0 => -1,
            1 => @as(i32, slice[0]),
            else => strings.decodeWTF8RuneTMultibyte(slice.ptr[0..4], @as(u3, @intCast(slice.len)), i32, strings.unicode_replacement),
        };
        
        self.end = self.current;
        
        self.current += if (code_point != strings.unicode_replacement)
            cp_len
        else
            1;
            
        return code_point;
    }
    
    inline fn step(self: *YamlLexer) void {
        self.code_point = self.nextCodepoint();
    }
    
    pub fn loc(self: *const YamlLexer) logger.Loc {
        return logger.usize2Loc(self.start);
    }
    
    pub fn raw(self: *YamlLexer) []const u8 {
        return self.source.contents[self.start..self.end];
    }
    
    pub fn addError(self: *YamlLexer, _loc: usize, comptime format: []const u8, args: anytype) void {
        // Error handling is typically cold path code
        
        const __loc = logger.usize2Loc(_loc);
        
        self.log.addErrorFmtOpts(
            self.log.msgs.allocator,
            format,
            args,
            .{
                .source = &self.source,
                .loc = __loc,
            },
        ) catch unreachable;
    }
    
    pub fn next(self: *YamlLexer) !void {
        while (true) {
            self.start = self.end;
            self.token = .eof;
            
            switch (self.code_point) {
                -1 => {
                    // Handle indentation at the end of file
                    if (self.indentation_stack.items.len > 1) {
                        _ = self.indentation_stack.pop();
                        self.token = .dedent;
                        return;
                    }
                    self.token = .eof;
                    return;
                },
                
                ' ', '\t' => {
                    // Count initial indentation
                    if (self.current > 0 and self.source.contents[self.current - 1] == '\n') {
                        var indent_count: u32 = 0;
                        while (self.code_point == ' ' or self.code_point == '\t') {
                            indent_count += 1;
                            self.step();
                        }
                        
                        // Skip empty lines with indentation
                        if (self.code_point == '\n') {
                            self.step();
                            continue;
                        }
                        
                        const current_indent = self.indentation_stack.items[self.indentation_stack.items.len - 1];
                        
                        if (indent_count > current_indent) {
                            try self.indentation_stack.append(indent_count);
                            self.token = .indent;
                            return;
                        } else if (indent_count < current_indent) {
                            // Pop indentation levels until we match or are less than the current indentation
                            while (self.indentation_stack.items.len > 1 and self.indentation_stack.items[self.indentation_stack.items.len - 1] > indent_count) {
                                _ = self.indentation_stack.pop();
                                self.token = .dedent;
                                return;
                            }
                            
                            // If the indentation doesn't match any previous level, it's an error
                            if (self.indentation_stack.items[self.indentation_stack.items.len - 1] != indent_count) {
                                self.addError(self.start, "Invalid indentation", .{});
                                return error.SyntaxError;
                            }
                        }
                        
                        // Same indentation level, continue parsing
                    } else {
                        // Skip whitespace in the middle of a line
                        self.step();
                        continue;
                    }
                },
                
                '\r' => {
                    self.step();
                    continue;
                },
                
                '\n' => {
                    self.step();
                    self.line_number += 1;
                    self.token = .newline;
                    return;
                },
                
                ':' => {
                    self.step();
                    // Skip any spaces after the colon as they're part of the YAML syntax
                    while (self.code_point == ' ' or self.code_point == '\t') {
                        self.step();
                    }
                    
                    // Special handling for flow-style objects like {key: value}
                    if (self.code_point == '{') {
                        debug("Found flow-style object start after colon", .{});
                        
                        self.token = .left_brace;
                        self.step(); // Skip the {
                        return;
                    }
                    
                    // Handle case where a line ends with a colon (empty value will be parsed later)
                    if (self.code_point == '\n' or self.code_point == -1) {
                        debug("Colon at end of line", .{});
                    }
                    
                    self.token = .colon;
                    return;
                },
                
                '{' => {
                    self.step(); // Skip the {
                    self.token = .left_brace;
                    return;
                },
                
                '}' => {
                    self.step(); // Skip the }
                    self.token = .right_brace;
                    return;
                },
                
                ',' => {
                    self.step(); // Skip the ,
                    self.token = .comma;
                    return;
                },
                
                '-' => {
                    // Check if it's a dash for a list item
                    if (self.current < self.source.contents.len and 
                        (self.source.contents[self.current] == ' ' or 
                         self.source.contents[self.current] == '\t')) {
                        self.step();
                        self.token = .dash;
                        return;
                    }
                    
                    // Negative number
                    self.step();
                    if (self.code_point >= '0' and self.code_point <= '9') {
                        try self.parseNumber(true);
                        return;
                    }
                    
                    // It's a dash in a string
                    try self.parseString();
                    return;
                },
                
                '#' => {
                    // Skip comments
                    while (self.code_point != '\n' and self.code_point != -1) {
                        self.step();
                    }
                    continue;
                },
                
                '0'...'9' => {
                    try self.parseNumber(false);
                    return;
                },
                
                '\'', '"' => {
                    try self.parseQuotedString();
                    return;
                },
                
                else => {
                    // Check if this might be a version number or contains special characters
                    const is_potential_version = 
                        (self.code_point >= '0' and self.code_point <= '9') or
                        self.code_point == '^' or
                        self.code_point == '~' or
                        self.code_point == '>' or
                        self.code_point == '<' or
                        self.code_point == '=' or
                        self.code_point == '*';
                    
                    if (is_potential_version) {
                        try self.parseString();
                        return;
                    }
                    
                    try self.parseString();
                    return;
                },
            }
        }
    }
    
    fn parseQuotedString(self: *YamlLexer) !void {
        const quote_char = self.code_point;
        self.step();
        
        const start = self.current - 1;
        
        while (self.code_point != quote_char and self.code_point != -1) {
            if (self.code_point == '\\') {
                self.step(); // Skip escape character
                if (self.code_point == -1) break;
            }
            self.step();
        }
        
        if (self.code_point == -1) {
            self.addError(start, "Unterminated string literal", .{});
            return error.SyntaxError;
        }
        
        const end = self.current - 1;
        self.step(); // Consume closing quote
        
        // Create the string value without quotes
        if (start + 1 <= end) {
            const str_value = self.source.contents[start + 1 .. end];
            
            // Special handling for version strings in quotes (like '9.0' in lockfileVersion)
            // Always preserve version strings as they are
            var is_version = false;
            
            if (str_value.len <= 10) { // Common version string length limit
                var digit_count: u32 = 0;
                var dot_count: u32 = 0;
                
                for (str_value) |c| {
                    if (c >= '0' and c <= '9') {
                        digit_count += 1;
                    } else if (c == '.') {
                        dot_count += 1;
                    }
                }
                
                // If the string mostly consists of digits and dots, it's likely a version
                if (digit_count > 0 and dot_count > 0 and (digit_count + dot_count) >= str_value.len / 2) {
                    is_version = true;
                    debug("Detected version string in quotes: '{s}'", .{str_value});
                }
            }
            
            self.string_literal = str_value;
        } else {
            self.string_literal = "";
        }
        
        self.token = .string;
    }
    
    fn parseFlowObject(self: *YamlLexer) !void {
        debug("Parsing flow-style object", .{});
        const start = self.current;
        
        // Create a temporary buffer to store the content
        var buffer = std.ArrayList(u8).init(self.allocator);
        defer buffer.deinit();
        
        // Start with brace level 1 since we're already at the opening brace
        var brace_level: u32 = 1;
        
        // Start with the opening brace
        try buffer.append('{');
        self.step(); // Consume opening brace
        
        // Skip whitespace after the opening brace
        if (self.code_point == ' ' or self.code_point == '\t') {
            while (self.code_point == ' ' or self.code_point == '\t') {
                try buffer.append(@intCast(self.code_point));
                self.step();
            }
        }
        
        // Track key:value pairs and nested braces until we find the matching closing brace
        while (brace_level > 0 and self.code_point != -1) {
            if (self.code_point == '{') {
                brace_level += 1;
                try buffer.append('{');
            } else if (self.code_point == '}') {
                brace_level -= 1;
                try buffer.append('}');
                
                if (brace_level == 0) {
                    // Found the matching closing brace
                    self.step(); // Consume closing brace
                    
                    // Use the buffer for the flow object
                    self.string_literal = try self.allocator.dupe(u8, buffer.items);
                    debug("Extracted flow-style object: '{s}'", .{self.string_literal});
                    
                    self.token = .flow_object;
                    return;
                }
            } else if (self.code_point == ':') {
                // We need to be careful with colons in flow objects
                try buffer.append(':');
                self.step();
                
                // Skip whitespace after a colon
                while (self.code_point == ' ' or self.code_point == '\t') {
                    try buffer.append(@intCast(self.code_point));
                    self.step();
                }
                
                continue;
            } else {
                // Add any other character to the buffer
                try buffer.append(@intCast(self.code_point));
            }
            
            self.step();
        }
        
        // If we get here, we didn't find a matching closing brace
        self.addError(start, "Unterminated flow-style object", .{});
        return error.SyntaxError;
    }
    
    pub fn parseString(self: *YamlLexer) !void {
        const start = self.current - 1;
        
        // Special handling for URL-style references (e.g., github:owner/repo, npm:package)
        var url_prefix_found = false;
        if (start < self.source.contents.len - 7) {
            // Check for common URL prefixes that contain colons
            const remaining = self.source.contents[start..];
            if (strings.startsWith(remaining, "github:") or 
                strings.startsWith(remaining, "npm:") or
                strings.startsWith(remaining, "http:") or
                strings.startsWith(remaining, "https:")) {
                url_prefix_found = true;
                debug("Found URL prefix in string: {s}", .{remaining[0..@min(10, remaining.len)]});
            }
        }
        
        // Initialize a brace counter for handling inline YAML objects like {integrity: hash}
        var brace_level: u32 = 0;
        
        while (true) {
            // End conditions for a string
            switch (self.code_point) {
                -1, '\n', '#' => break,
                '{' => {
                    // We're entering an inline object - keep parsing until we find the matching closing brace
                    brace_level += 1;
                    debug("Found opening brace, brace_level={d}", .{brace_level});
                    self.step();
                    continue;
                },
                '}' => {
                    if (brace_level > 0) {
                        brace_level -= 1;
                        debug("Found closing brace, brace_level={d}", .{brace_level});
                        self.step();
                        continue;
                    }
                    break;
                },
                ':' => {
                    // If we're inside braces or if we have a URL prefix, don't treat this colon as a terminator
                    if (brace_level > 0 or url_prefix_found) {
                        self.step();
                        continue;
                    }
                    
                    // Peek ahead to see if this might be part of a URL that hasn't been detected yet
                    // e.g. for patterns like "resolution: {tarball: https://registry...}"
                    if (self.current < self.source.contents.len) {
                        const peek = self.source.contents[self.current..];
                        if (peek.len >= 8 and (
                            strings.startsWith(peek, "//") or // Might be a protocol-relative URL
                            strings.startsWith(peek, "//registry") or
                            strings.startsWith(peek, "//codeload")
                        )) {
                            url_prefix_found = true;
                            self.step();
                            continue;
                        }
                        
                        // Check if we're about to enter an inline object
                        if (peek.len >= 2 and peek[0] == ' ' and peek[1] == '{') {
                            debug("Found inline object start", .{});
                            self.step(); // Step past colon
                            continue;
                        }
                    }
                    break;
                },
                else => self.step(),
            }
        }
        
        const end = self.current - 1;
        
        // Check for boolean values
        if (start <= end) {
            const value = std.mem.trim(u8, self.source.contents[start .. end + 1], " \t");
            
            if (strings.eqlComptime(value, "true")) {
                self.boolean_value = true;
                self.token = .boolean;
                return;
            } else if (strings.eqlComptime(value, "false")) {
                self.boolean_value = false;
                self.token = .boolean;
                return;
            } else if (strings.eqlComptime(value, "null") or strings.eqlComptime(value, "~")) {
                // Handle explicit null values in YAML
                self.token = .string;
                self.string_literal = "";
                return;
            }
            
            // Store the string value as is
            self.string_literal = value;
        } else {
            self.string_literal = "";
        }
        
        self.token = .string;
    }
    
    fn parseNumber(self: *YamlLexer, is_negative: bool) !void {
        const start = if (is_negative) self.current - 2 else self.current - 1;
        
        // Parse integer part
        while (self.code_point >= '0' and self.code_point <= '9') {
            self.step();
        }
        
        // Parse decimal part if present
        if (self.code_point == '.') {
            self.step();
            
            // Parse digits after decimal point
            while (self.code_point >= '0' and self.code_point <= '9') {
                self.step();
            }
            
            // Continue parsing if additional decimal points are found (for version numbers)
            while (self.code_point == '.') {
                self.step();
                
                // Parse digits after additional decimal points
                while (self.code_point >= '0' and self.code_point <= '9') {
                    self.step();
                }
            }
        }
        
        // Parse scientific notation if present
        if (self.code_point == 'e' or self.code_point == 'E') {
            self.step();
            
            if (self.code_point == '+' or self.code_point == '-') {
                self.step();
            }
            
            // Check for at least one digit after 'e'/'E'
            if (self.code_point < '0' or self.code_point > '9') {
                self.addError(start, "Invalid number format in scientific notation", .{});
                return error.SyntaxError;
            }
            
            while (self.code_point >= '0' and self.code_point <= '9') {
                self.step();
            }
        }
        
        const end = self.current - 1;
        const number_str = self.source.contents[start .. end + 1];
        
        // Check if this looks like a version string (contains dots and digits)
        var dot_count: u32 = 0;
        
        for (number_str) |char| {
            if (char == '.') {
                dot_count += 1;
            }
        }
        
        // Always treat version-like number strings as strings to preserve semantic version formatting
        // This handles cases like "0.25.0" or "1.2" which might appear in PNPM lockfiles
        if (dot_count > 0) {
            debug("Treating as version string: '{s}' (has {d} dots)", .{number_str, dot_count});
            self.string_literal = number_str;
            self.token = .string;
            return;
        }
        
        // Attempt to parse as a number
        if (std.fmt.parseFloat(f64, number_str)) |value| {
            // Successfully parsed as a number
            self.number_value = value;
            self.token = .number;
        } else |err| {
            // Failed to parse as a number, treat as a string
            debug("Failed to parse number '{s}': {s}", .{number_str, @errorName(err)});
            self.string_literal = number_str;
            self.token = .string;
        }
    }
};

pub const YamlParser = struct {
    lexer: YamlLexer,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    
    pub fn init(allocator: std.mem.Allocator, source: logger.Source, log: *logger.Log) !YamlParser {
        return YamlParser{
            .lexer = try YamlLexer.init(log, source, allocator),
            .allocator = allocator,
            .log = log,
        };
    }
    
    pub fn deinit(self: *YamlParser) void {
        self.lexer.deinit();
    }
    
    pub fn parse(self: *YamlParser) !Expr {
        debug("Beginning YAML parse", .{});
        return try self.parseValue();
    }
    
    fn parseValue(self: *YamlParser) !Expr {
        const loc = self.lexer.loc();
        
        switch (self.lexer.token) {
            .string => {
                const value = try self.allocator.dupe(u8, self.lexer.string_literal);
                try self.lexer.next();
                return Expr.init(E.String, E.String{ .data = value }, loc);
            },
            
            .number => {
                const value = self.lexer.number_value;
                try self.lexer.next();
                return Expr.init(E.Number, E.Number{ .value = value }, loc);
            },
            
            .boolean => {
                const value = self.lexer.boolean_value;
                try self.lexer.next();
                return Expr.init(E.Boolean, E.Boolean{ .value = value }, loc);
            },
            
            .flow_object => {
                // Handle YAML flow-style objects like {key: value}
                debug("Processing flow object: '{s}'", .{self.lexer.string_literal});
                
                // For simplicity in our migration case, we'll just store the raw string
                // This is sufficient for extracting values like {integrity: hash} in the lockfile
                const value = try self.allocator.dupe(u8, self.lexer.string_literal);
                try self.lexer.next();
                return Expr.init(E.String, E.String{ .data = value }, loc);
            },
            
            .left_brace => {
                // Parse flow-style object like {integrity: hash}
                debug("Parsing flow-style object starting with {", .{});
                
                var obj = E.Object{};
                
                // Move past the left brace
                try self.lexer.next();
                
                // Parse key-value pairs until we find a right brace
                while (self.lexer.token != .right_brace and self.lexer.token != .eof) {
                    // Parse key (must be a string)
                    if (self.lexer.token != .string) {
                        // If not already a string, try to parse as one
                        try self.lexer.parseString();
                        if (self.lexer.token != .string) {
                            self.lexer.addError(self.lexer.start, "Expected string key in flow object", .{});
                            return error.SyntaxError;
                        }
                    }
                    
                    const key = try self.allocator.dupe(u8, self.lexer.string_literal);
                    try self.lexer.next();
                    
                    // Expect colon
                    if (self.lexer.token != .colon) {
                        self.lexer.addError(self.lexer.start, "Expected colon after key in flow object", .{});
                        return error.SyntaxError;
                    }
                    
                    // Move past colon
                    try self.lexer.next();
                    
                    // Parse value
                    const value = try self.parseValue();
                    
                    // Add key-value pair to object
                    try obj.put(self.allocator, key, value);
                    
                    // Check for comma or end of object
                    if (self.lexer.token == .comma) {
                        try self.lexer.next();
                    } else if (self.lexer.token != .right_brace) {
                        // If not a comma or right brace, it might be syntax error
                        // But we'll be tolerant and allow missing commas
                        if (self.lexer.token != .string) {
                            break;
                        }
                    }
                }
                
                // Expect right brace
                if (self.lexer.token == .right_brace) {
                    try self.lexer.next();
                } else {
                    debug("Warning: Missing closing brace in flow object", .{});
                }
                
                return Expr.init(E.Object, obj, loc);
            },
            
            .dash => {
                // Start of an array item
                var array = E.Array{};
                
                // Parse the first item
                try self.lexer.next();
                try array.push(self.allocator, try self.parseValue());
                
                // Check for more items at the same indentation level
                while (self.lexer.token == .newline) {
                    try self.lexer.next();
                    
                    if (self.lexer.token == .dash) {
                        try self.lexer.next();
                        try array.push(self.allocator, try self.parseValue());
                    } else {
                        break;
                    }
                }
                
                return Expr.init(E.Array, array, loc);
            },
            
            .indent => {
                try self.lexer.next();
                const value = try self.parseValue();
                
                // Consume any dedent tokens
                while (self.lexer.token == .dedent) {
                    try self.lexer.next();
                }
                
                return value;
            },
            
            .colon => {
                // Empty value (null)
                try self.lexer.next();
                return Expr.init(E.Null, E.Null{}, loc);
            },
            
            else => {
                self.lexer.addError(self.lexer.start, "Unexpected token: {s}", .{@tagName(self.lexer.token)});
                return error.SyntaxError;
            },
        }
    }
    
    pub fn parseObject(self: *YamlParser) !Expr {
        const loc = self.lexer.loc();
        var obj = E.Object{};
        
        while (self.lexer.token != .eof) {
            // Skip any extra newlines between entries
            while (self.lexer.token == .newline) {
                try self.lexer.next();
            }
            
            // Exit if we reached the end
            if (self.lexer.token == .eof) {
                break;
            }
            
            // Parse key
            if (self.lexer.token != .string) {
                self.lexer.addError(self.lexer.start, "Expected string key, got {s}", .{@tagName(self.lexer.token)});
                return error.SyntaxError;
            }
            
            const key = try self.allocator.dupe(u8, self.lexer.string_literal);
            try self.lexer.next();
            
            // Expect colon
            if (self.lexer.token != .colon) {
                // Some PNPM lockfiles don't have a space after the colon
                // Add more detailed error message
                debug("Expected colon after key: '{s}', got {s}", .{key, @tagName(self.lexer.token)});
                self.lexer.addError(self.lexer.start, "Expected colon after key", .{});
                return error.SyntaxError;
            }
            
            // After processing a colon in the YamlLexer, we need to move to the next token
            try self.lexer.next();
            
            var value: Expr = undefined;
            
            // Special handling for objects
            if (self.lexer.token == .newline) {
                try self.lexer.next();
                
                if (self.lexer.token == .indent) {
                    try self.lexer.next();
                    
                    // Nested object or array
                    if (self.lexer.token == .dash) {
                        value = try self.parseValue(); // This will parse the array
                    } else {
                        debug("Parsing nested object after indent", .{});
                        value = try self.parseObject(); // Recursively parse nested object
                    }
                    
                    // Consume any dedent tokens
                    while (self.lexer.token == .dedent) {
                        try self.lexer.next();
                    }
                } else {
                    // Empty value
                    value = Expr.init(E.Null, E.Null{}, self.lexer.loc());
                }
            } else {
                // Inline value
                if (self.lexer.token == .eof) {
                    // Handle case where there's a key with no value at the end of the file
                    value = Expr.init(E.Null, E.Null{}, self.lexer.loc());
                } else {
                    value = try self.parseValue();
                }
            }
            
            try obj.put(self.allocator, key, value);
            
            // Skip newline after value
            if (self.lexer.token == .newline) {
                try self.lexer.next();
            }
        }
        
        return Expr.init(E.Object, obj, loc);
    }
};

pub fn migratePNPMLockfile(
    this: *Lockfile,
    manager: *Install.PackageManager,
    allocator: Allocator,
    log: *logger.Log,
    data: string,
    abs_path: string,
) !LoadResult {
    debug("begin PNPM lockfile migration", .{});

    // Create an empty lockfile and initialize the store
    this.initEmpty(allocator);
    Install.initializeStore();
    
    // Check if this looks like a valid PNPM lockfile
    if (strings.indexOf(data, "lockfileVersion:") == null) {
        log.addErrorFmt(&logger.Source.initPathString(abs_path, data), logger.Loc.Empty, allocator, 
            "Invalid PNPM lockfile: missing lockfileVersion", .{}) catch {};
        return error.InvalidPNPMLockfile;
    }
    
    // Try to parse YAML and extract basic structure
    const source = logger.Source.initPathString(abs_path, data);
    var parser = try YamlParser.init(allocator, source, log);
    defer parser.deinit();
    
    // Try to parse the YAML as an object
    const yaml_root = parser.parseObject() catch |err| {
        debug("Failed to parse YAML: {s}", .{@errorName(err)});
        log.print(Output.errorWriter()) catch {};
        return error.InvalidPNPMLockfile;
    };

    bun.Analytics.Features.lockfile_migration_from_pnpm_lock += 1;
    
    if (yaml_root.data != .e_object) {
        return error.InvalidPNPMLockfile;
    }

    // Extract lockfile version
    var version_str: string = "";
    if (yaml_root.get("lockfileVersion")) |version| {
        if (version.data == .e_string) {
            version_str = version.data.e_string.data;
        } else if (version.data == .e_number) {
            // Convert number to string
            var buf: [32]u8 = undefined;
            version_str = std.fmt.bufPrint(&buf, "{d}", .{version.data.e_number.value}) catch "";
        }
        
        // PNPM lockfile versions 6.0 through 9.0 are supported
        var version_num: f32 = 0.0;
        
        debug("Found lockfileVersion: '{s}'", .{version_str});
        
        // Trim whitespace and remove quotes if present
        var clean_version = std.mem.trim(u8, version_str, " \t\r\n");
        if (strings.startsWith(clean_version, "'") and strings.endsWith(clean_version, "'")) {
            clean_version = clean_version[1..clean_version.len-1];
        }
        
        version_num = std.fmt.parseFloat(f32, clean_version) catch 0.0;
        debug("Parsed lockfileVersion as: {d}", .{version_num});
        
        if (version_num < 6.0) {
            log.addErrorFmt(&source, logger.Loc.Empty, allocator, 
                "<red><b>error<r><d>:<r> Unsupported PNPM lockfile version: {d}\n\nPlease upgrade to PNPM v8 or later and regenerate your lockfile.", 
                .{version_num}) catch {};
            return error.UnsupportedPNPMLockfileVersion;
        }
    } else {
        log.addErrorFmt(&source, logger.Loc.Empty, allocator, 
            "Missing lockfileVersion in PNPM lockfile", .{}) catch {};
        return error.InvalidPNPMLockfile;
    }
    
    // Extract packages section
    var packages_empty_obj = E.Object{};
    const packages_obj = if (yaml_root.get("packages")) |packages| blk: {
        if (packages.data != .e_object) {
            debug("packages section is not an object", .{});
            break :blk &packages_empty_obj;
        }
        break :blk packages.data.e_object;
    } else blk: {
        debug("packages section not found", .{});
        break :blk &packages_empty_obj;
    };
    
    // Extract root dependencies from importers section
    const root_deps = if (yaml_root.get("importers")) |importers| blk: {
        if (importers.data != .e_object) break :blk null;
        
        // Look for "." which is the root package
        for (importers.data.e_object.properties.slice()) |prop| {
            if (prop.key) |key| {
                if (key.data == .e_string and strings.eql(key.data.e_string.data, ".")) {
                    if (prop.value) |val| {
                        if (val.data == .e_object) {
                            break :blk val.data.e_object;
                        }
                    }
                }
            }
        }
        break :blk null;
    } else null;
    
    // Start counting packages and dependencies
    var package_count: u32 = 1; // Root package
    var num_deps: u32 = 0;
    
    // Count dependencies in root package
    if (root_deps) |deps| {
        inline for (.{ "dependencies", "devDependencies", "optionalDependencies" }) |dep_type| {
            if (deps.get(dep_type)) |deps_obj| {
                if (deps_obj.data == .e_object) {
                    num_deps +|= @intCast(deps_obj.data.e_object.properties.len);
                }
            }
        }
    }
    
    // Count packages and their dependencies
    package_count +|= @intCast(packages_obj.properties.len);
    for (packages_obj.properties.slice()) |prop| {
        if (prop.value == null or prop.value.?.data != .e_object) continue;
        
        const pkg = prop.value.?.data.e_object;
        
        // Count dependencies
        inline for (.{ "dependencies", "peerDependencies", "optionalDependencies" }) |dep_type| {
            if (pkg.get(dep_type)) |deps_obj| {
                if (deps_obj.data == .e_object) {
                    num_deps +|= @intCast(deps_obj.data.e_object.properties.len);
                }
            }
        }
    }
    
    debug("counted {d} packages", .{package_count});
    debug("counted {d} dependencies", .{num_deps});
    
    // Allocate buffers
    try this.buffers.dependencies.ensureTotalCapacity(allocator, num_deps);
    try this.buffers.resolutions.ensureTotalCapacity(allocator, num_deps);
    try this.packages.ensureTotalCapacity(allocator, package_count);
    try this.package_index.ensureTotalCapacity(package_count);
    
    var string_buf = this.stringBuf();
    
    // Create package ID mapping
    var package_id_map = std.StringHashMap(Install.PackageID).init(allocator);
    defer package_id_map.deinit();
    try package_id_map.ensureTotalCapacity(package_count);
    
    // Add root package
    const root_package_id: Install.PackageID = 0;
    this.packages.appendAssumeCapacity(Lockfile.Package{
        .name = try string_buf.append(""),
        .name_hash = stringHash(""),
        .resolution = Resolution.init(.{ .root = {} }),
        .dependencies = undefined,
        .resolutions = undefined,
        .meta = .{
            .id = root_package_id,
            .origin = .local,
            .arch = .all,
            .os = .all,
            .man_dir = String{},
            .has_install_script = .false,
            .integrity = Integrity{},
        },
        .bin = Bin.init(),
        .scripts = .{},
    });
    
    try this.getOrPutID(root_package_id, stringHash(""));
    
    // Store dependencies to resolve later
    var all_deps = std.ArrayList(struct {
        package_id: Install.PackageID,
        dep_name: string,
        dep_version: string,
        is_dev: bool,
        is_optional: bool,
        is_peer: bool,
    }).init(allocator);
    defer all_deps.deinit();
    
    // Process root dependencies
    if (root_deps) |deps| {
        // Regular dependencies
        if (deps.get("dependencies")) |deps_expr| {
            if (deps_expr.data == .e_object) {
                for (deps_expr.data.e_object.properties.slice()) |prop| {
                    if (prop.key != null and prop.value != null) {
                        const name = if (prop.key.?.data == .e_string) prop.key.?.data.e_string.data else continue;
                        const spec = if (prop.value.?.data == .e_object) blk: {
                            // PNPM format has dependencies as objects with specifier property
                            if (prop.value.?.asProperty("specifier")) |spec_prop| {
                                if (spec_prop.expr.data == .e_string) {
                                    break :blk spec_prop.expr.data.e_string.data;
                                }
                            }
                            break :blk "";
                        } else if (prop.value.?.data == .e_string) prop.value.?.data.e_string.data else "";
                        
                        try all_deps.append(.{
                            .package_id = root_package_id,
                            .dep_name = name,
                            .dep_version = spec,
                            .is_dev = false,
                            .is_optional = false,
                            .is_peer = false,
                        });
                    }
                }
            }
        }
        
        // Dev dependencies
        if (deps.get("devDependencies")) |deps_expr| {
            if (deps_expr.data == .e_object) {
                for (deps_expr.data.e_object.properties.slice()) |prop| {
                    if (prop.key != null and prop.value != null) {
                        const name = if (prop.key.?.data == .e_string) prop.key.?.data.e_string.data else continue;
                        const spec = if (prop.value.?.data == .e_object) blk: {
                            if (prop.value.?.asProperty("specifier")) |spec_prop| {
                                if (spec_prop.expr.data == .e_string) {
                                    break :blk spec_prop.expr.data.e_string.data;
                                }
                            }
                            break :blk "";
                        } else if (prop.value.?.data == .e_string) prop.value.?.data.e_string.data else "";
                        
                        try all_deps.append(.{
                            .package_id = root_package_id,
                            .dep_name = name,
                            .dep_version = spec,
                            .is_dev = true,
                            .is_optional = false,
                            .is_peer = false,
                        });
                    }
                }
            }
        }
        
        // Optional dependencies
        if (deps.get("optionalDependencies")) |deps_expr| {
            if (deps_expr.data == .e_object) {
                for (deps_expr.data.e_object.properties.slice()) |prop| {
                    if (prop.key != null and prop.value != null) {
                        const name = if (prop.key.?.data == .e_string) prop.key.?.data.e_string.data else continue;
                        const spec = if (prop.value.?.data == .e_object) blk: {
                            if (prop.value.?.asProperty("specifier")) |spec_prop| {
                                if (spec_prop.expr.data == .e_string) {
                                    break :blk spec_prop.expr.data.e_string.data;
                                }
                            }
                            break :blk "";
                        } else if (prop.value.?.data == .e_string) prop.value.?.data.e_string.data else "";
                        
                        try all_deps.append(.{
                            .package_id = root_package_id,
                            .dep_name = name,
                            .dep_version = spec,
                            .is_dev = false,
                            .is_optional = true,
                            .is_peer = false,
                        });
                    }
                }
            }
        }
    }
    
    // Process packages
    var package_id: Install.PackageID = 1; // Start from 1 since 0 is root
    for (packages_obj.properties.slice()) |prop| {
        if (prop.key == null or prop.value == null) continue;
        
        const package_spec = if (prop.key.?.data == .e_string) prop.key.?.data.e_string.data else continue;
        if (prop.value.?.data != .e_object) continue;
        
        const pkg_obj = prop.value.?.data.e_object;
        
        // Parse package name and version from spec (e.g. "/lodash@4.17.21")
        var pkg_name: string = "";
        var pkg_version: string = "";
        
        if (package_spec.len > 0 and package_spec[0] == '/') {
            // Find the last '@' character
            const at_index = strings.lastIndexOfChar(package_spec, '@') orelse package_spec.len;
            if (at_index > 1) {
                pkg_name = package_spec[1..at_index]; // Skip leading '/'
                if (at_index < package_spec.len) {
                    pkg_version = package_spec[at_index+1..];
                }
            }
        }
        
        if (pkg_name.len == 0) continue; // Skip invalid package specs
        
        // Get resolution info
        var resolution_url: string = "";
        var integrity: string = "";
        
        if (pkg_obj.get("resolution")) |res| {
            if (res.data == .e_object) {
                const res_obj = res.data.e_object;
                if (res_obj.get("tarball")) |tarball| {
                    if (tarball.data == .e_string) {
                        resolution_url = tarball.data.e_string.data;
                    }
                } else if (res_obj.get("integrity")) |integ| {
                    if (integ.data == .e_string) {
                        integrity = integ.data.e_string.data;
                    }
                }
            } else if (res.data == .e_string) {
                // Handle flow-style objects that might have been parsed as strings
                const flow_str = res.data.e_string.data;
                if (strings.indexOf(flow_str, "integrity:") != null) {
                    // Try to extract integrity from the string
                    const integrity_start = strings.indexOf(flow_str, "integrity:") orelse flow_str.len;
                    const integrity_end = strings.indexOfAnyPos(flow_str, integrity_start, " }") orelse flow_str.len;
                    if (integrity_start < integrity_end and integrity_start + "integrity:".len < flow_str.len) {
                        integrity = std.mem.trim(u8, flow_str[integrity_start+"integrity:".len..integrity_end], " '\"");
                        debug("Extracted integrity from flow-style object: {s}", .{integrity});
                    }
                }
            }
        }
        
        // Fallback integrity
        if (integrity.len == 0) {
            // Try the direct integrity field
            if (pkg_obj.get("integrity")) |integ| {
                if (integ.data == .e_string) {
                    integrity = integ.data.e_string.data;
                    debug("Using direct integrity field: {s}", .{integrity});
                }
            }
            
            // Try looking in the resolution as a string
            if (integrity.len == 0 and pkg_obj.get("resolution")) |res| {
                if (res.data == .e_string) {
                    const resolution_str = res.data.e_string.data;
                    if (strings.indexOf(resolution_str, "sha512-") != null) {
                        // This is likely an integrity hash
                        integrity = std.mem.trim(u8, resolution_str, " '\"{");
                        debug("Extracted integrity hash from resolution string: {s}", .{integrity});
                    }
                }
            }
        }
        
        // Get bin info
        var bin_value = Bin.init();
        var has_bin = false;
        
        if (pkg_obj.get("bin")) |bin| {
            if (bin.data == .e_string) {
                has_bin = true;
                bin_value = .{
                    .tag = .file,
                    .value = Bin.Value.init(.{
                        .file = try string_buf.append(bin.data.e_string.data),
                    }),
                };
            } else if (bin.data == .e_object and bin.data.e_object.properties.len > 0) {
                has_bin = true;
                const bin_obj = bin.data.e_object;
                
                if (bin_obj.properties.len == 1) {
                    // Single bin entry
                    const bin_prop = bin_obj.properties.at(0);
                    if (bin_prop.key != null and bin_prop.value != null) {
                        if (bin_prop.key.?.data == .e_string and bin_prop.value.?.data == .e_string) {
                            const key = bin_prop.key.?.data.e_string.data;
                            const value = bin_prop.value.?.data.e_string.data;
                            
                            if (strings.eql(key, pkg_name)) {
                                bin_value = .{
                                    .tag = .file,
                                    .value = Bin.Value.init(.{
                                        .file = try string_buf.append(value),
                                    }),
                                };
                            } else {
                                bin_value = .{
                                    .tag = .named_file,
                                    .value = Bin.Value.init(.{
                                        .named_file = .{
                                            try string_buf.append(key),
                                            try string_buf.append(value),
                                        },
                                    }),
                                };
                            }
                        }
                    }
                } else {
                    // Multiple bin entries
                    const view: Install.ExternalStringList = .{
                        .off = @truncate(this.buffers.extern_strings.items.len),
                        .len = @intCast(bin_obj.properties.len * 2),
                    };
                    
                    for (bin_obj.properties.slice()) |bin_entry| {
                        if (bin_entry.key != null and bin_entry.value != null) {
                            if (bin_entry.key.?.data == .e_string and bin_entry.value.?.data == .e_string) {
                                const key = bin_entry.key.?.data.e_string.data;
                                const value = bin_entry.value.?.data.e_string.data;
                                this.buffers.extern_strings.appendAssumeCapacity(try string_buf.appendExternal(key));
                                this.buffers.extern_strings.appendAssumeCapacity(try string_buf.appendExternal(value));
                            }
                        }
                    }
                    
                    bin_value = .{
                        .tag = .map,
                        .value = Bin.Value.init(.{
                            .map = view,
                        }),
                    };
                }
            }
        }
        
        // Parse has_install_script flag
        var has_install_script = false;
        if (pkg_obj.get("hasInstallScript")) |script| {
            if (script.data == .e_boolean) {
                has_install_script = script.data.e_boolean.value;
            }
        }
        
        // Parse architecture and OS constraints
        var arch_constraint = Npm.Architecture.none.negatable();
        var os_constraint = Npm.OperatingSystem.none.negatable();
        
        if (pkg_obj.get("cpu")) |cpu_expr| {
            if (cpu_expr.data == .e_array) {
                for (cpu_expr.data.e_array.items.slice()) |item| {
                    if (item.data == .e_string) {
                        arch_constraint.apply(item.data.e_string.data);
                    }
                }
            }
        }
        
        if (pkg_obj.get("os")) |os_expr| {
            if (os_expr.data == .e_array) {
                for (os_expr.data.e_array.items.slice()) |item| {
                    if (item.data == .e_string) {
                        os_constraint.apply(item.data.e_string.data);
                    }
                }
            }
        }
        
        // Convert architecture and OS constraints
        const arch = if (@intFromEnum(arch_constraint.added) == 0 and @intFromEnum(arch_constraint.removed) == 0)
            Npm.Architecture.all
        else
            arch_constraint.combine();
        
        const os = if (@intFromEnum(os_constraint.added) == 0 and @intFromEnum(os_constraint.removed) == 0)
            Npm.OperatingSystem.all
        else
            os_constraint.combine();
        
        // Add the package
        const name_hash = stringHash(pkg_name);
        const pkg_id = package_id;
        package_id += 1;
        
        // Map the package spec to its ID
        try package_id_map.put(package_spec, pkg_id);
        
        // Create resolution
        var resolution = Resolution{};
        if (resolution_url.len > 0) {
            debug("Setting resolution URL for {s}: {s}", .{pkg_name, resolution_url});
            
            // Check for github URLs
            if (strings.indexOf(resolution_url, "github.com") != null) {
                if (strings.startsWith(resolution_url, "https://codeload.github.com/")) {
                    const parts_iter = std.mem.split(u8, resolution_url, "/");
                    var parts = std.ArrayList([]const u8).init(allocator);
                    defer parts.deinit();
                    
                    while (parts_iter.next()) |part| {
                        try parts.append(part);
                    }
                    
                    if (parts.items.len >= 6) {
                        const owner = parts.items[3];
                        const repo = parts.items[4];
                        const commit = parts.items[5];
                        
                        debug("GitHub resolution: owner={s}, repo={s}, commit={s}", .{owner, repo, commit});
                        
                        resolution = Resolution.init(.{
                            .git = .{
                                .owner = try string_buf.append(owner),
                                .repo = try string_buf.append(repo),
                                .committish = try string_buf.append(commit),
                                .resolved = try string_buf.append(commit),
                                .package_name = try string_buf.appendWithHash(pkg_name, name_hash),
                            },
                        });
                    } else {
                        // Fallback to tarball resolution
                        resolution = Resolution.init(.{
                            .remote_tarball = try string_buf.append(resolution_url),
                        });
                    }
                } else {
                    // Other GitHub URL formats
                    resolution = Resolution.init(.{
                        .remote_tarball = try string_buf.append(resolution_url),
                    });
                }
            } else {
                // Standard npm registry URL
                resolution = Resolution.init(.{
                    .npm = .{
                        .url = try string_buf.append(resolution_url),
                        .version = Semver.Version.parse(Semver.SlicedString.init(pkg_version, pkg_version)).version.min(),
                    },
                });
            }
        } else {
            // Construct registry URL from package name and version
            resolution = Resolution.init(.{
                .npm = .{
                    .url = blk: {
                        var url_buf: [1024]u8 = undefined;
                        // Get the last segment of the package name after the last '/'
                        const name_segment = blk2: {
                            const last_slash = std.mem.lastIndexOfScalar(u8, pkg_name, '/') orelse break :blk2 pkg_name;
                            break :blk2 pkg_name[last_slash + 1..];
                        };
                        const url_str = std.fmt.bufPrint(
                            &url_buf, 
                            "{s}/-/{s}-{s}.tgz", 
                            .{
                                manager.scopeForPackageName(pkg_name).url.href,
                                name_segment,
                                pkg_version,
                            }
                        ) catch break :blk String{};
                        break :blk try string_buf.append(url_str);
                    },
                    .version = Semver.Version.parse(Semver.SlicedString.init(pkg_version, pkg_version)).version.min(),
                },
            });
        }
        
        // Add package to the lockfile
        this.packages.appendAssumeCapacity(Lockfile.Package{
            .name = try string_buf.appendWithHash(pkg_name, name_hash),
            .name_hash = name_hash,
            .resolution = resolution,
            .dependencies = undefined,
            .resolutions = undefined,
            .meta = .{
                .id = pkg_id,
                .origin = .npm,
                .arch = arch,
                .os = os,
                .man_dir = String{},
                .has_install_script = if (has_install_script) .true else .false,
                .integrity = if (integrity.len > 0) Integrity.parse(integrity) else Integrity{},
            },
            .bin = bin_value,
            .scripts = .{},
        });
        
        try this.getOrPutID(pkg_id, name_hash);
        
        // Process dependencies
        inline for (.{ 
            .{ "dependencies", false, false, false },
            .{ "peerDependencies", false, false, true },
            .{ "optionalDependencies", false, true, false },
        }) |dep_info| {
            const dep_type = dep_info[0];
            const is_dev = dep_info[1];
            const is_optional = dep_info[2];
            const is_peer = dep_info[3];
            
            if (pkg_obj.get(dep_type)) |deps_expr| {
                if (deps_expr.data == .e_object) {
                    for (deps_expr.data.e_object.properties.slice()) |dep_prop| {
                        if (dep_prop.key != null and dep_prop.value != null) {
                            if (dep_prop.key.?.data != .e_string) continue;
                            const dep_name = dep_prop.key.?.data.e_string.data;
                            
                            const dep_version = if (dep_prop.value.?.data == .e_string) 
                                dep_prop.value.?.data.e_string.data 
                            else "";
                            
                            try all_deps.append(.{
                                .package_id = pkg_id,
                                .dep_name = dep_name,
                                .dep_version = dep_version,
                                .is_dev = is_dev,
                                .is_optional = is_optional,
                                .is_peer = is_peer,
                            });
                        }
                    }
                }
            }
        }
    }
    
    // Set up dependencies and resolutions
    var dependencies_buf = this.buffers.dependencies.items.ptr[0..num_deps];
    var resolutions_buf = this.buffers.resolutions.items.ptr[0..num_deps];
    
    // Initialize dependency lists
    var dependencies_list = this.packages.items(.dependencies);
    var resolution_list = this.packages.items(.resolutions);
    
    // Count dependencies per package
    var package_dep_counts = try allocator.alloc(u32, this.packages.len);
    defer allocator.free(package_dep_counts);
    @memset(package_dep_counts, 0);
    
    for (all_deps.items) |dep| {
        package_dep_counts[dep.package_id] += 1;
    }
    
    // Set up offsets
    var dep_offset: u32 = 0;
    for (package_dep_counts, 0..) |count, i| {
        if (count == 0) {
            dependencies_list[i] = .{ .len = 0 };
            resolution_list[i] = .{ .len = 0 };
        } else {
            dependencies_list[i] = .{
                .off = dep_offset,
                .len = count,
            };
            resolution_list[i] = .{
                .off = dep_offset,
                .len = count,
            };
            dep_offset += count;
        }
    }
    
    // Reset counts for filling in dependencies
    @memset(package_dep_counts, 0);
    
    // Build dependency and resolution entries
    for (all_deps.items) |dep| {
        const pkg_id = dep.package_id;
        const dep_list = &dependencies_list[pkg_id];
        const dep_index = dep_list.off + package_dep_counts[pkg_id];
        
        // Create dependency entry
        const dep_name = dep.dep_name;
        const name_hash = stringHash(dep_name);
        const dep_name_str = try string_buf.appendWithHash(dep_name, name_hash);
        
        // Parse version specifier
        var sliced = try string_buf.append(dep.dep_version);
        const version_sliced = sliced.sliced(string_buf.bytes.items);
        
        const version = Dependency.parse(
            allocator,
            dep_name_str,
            name_hash,
            version_sliced.slice,
            &version_sliced,
            log,
            manager,
        ) orelse {
            debug("Failed to parse version: {s}", .{dep.dep_version});
            continue;
        };
        
        // Create dependency object
        dependencies_buf[dep_index] = Dependency{
            .name = dep_name_str,
            .name_hash = name_hash,
            .version = version,
            .behavior = .{
                .prod = !dep.is_dev,
                .optional = dep.is_optional,
                .dev = dep.is_dev,
                .peer = dep.is_peer,
                .workspace = false,
            },
        };
        
        // Resolve the dependency
        var resolved_id: Install.PackageID = Install.invalid_package_id;
        
        // Try exact match first
        var package_spec_buf: [1024]u8 = undefined;
        const package_spec = if (dep.dep_version.len > 0) 
            std.fmt.bufPrint(&package_spec_buf, "/{s}@{s}", .{dep_name, dep.dep_version}) catch continue
        else
            std.fmt.bufPrint(&package_spec_buf, "/{s}", .{dep_name}) catch continue;
        
        if (package_id_map.get(package_spec)) |id| {
            resolved_id = id;
        } else {
            // Try to find by name only
            var found_id: ?Install.PackageID = null;
            var it = package_id_map.iterator();
            while (it.next()) |entry| {
                const spec = entry.key_ptr.*;
                const at_index = strings.lastIndexOfChar(spec, '@') orelse spec.len;
                if (at_index > 0) {
                    const spec_name = spec[1..at_index]; // Skip leading '/'
                    if (strings.eql(spec_name, dep_name)) {
                        found_id = entry.value_ptr.*;
                        break;
                    }
                }
            }
            
            if (found_id) |id| {
                resolved_id = id;
            }
        }
        
        // Store resolution
        resolutions_buf[dep_index] = resolved_id;
        package_dep_counts[pkg_id] += 1;
    }
    
    // Update buffer lengths
    this.buffers.dependencies.items.len = dep_offset;
    this.buffers.resolutions.items.len = dep_offset;
    
    // Resolve dependencies
    try this.resolve(log);
    
    if (Environment.allow_assert) {
        try this.verifyData();
    }
    
    this.meta_hash = try this.generateMetaHash(false, this.packages.len);
    
    return LoadResult{
        .ok = .{
            .lockfile = this,
            .was_migrated = true,
            .loaded_from_binary_lockfile = false,
            .serializer_result = .{},
            .format = .binary,
        },
    };
}