// XML parser for Bun's bundler & runtime
// Converts XML documents to JavaScript AST expressions following the same pattern as YAML/TOML parsers

const std = @import("std");
const bun = @import("bun");
const logger = bun.logger;
const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const OOM = bun.OOM;

pub const XML = struct {
    const ParseError = OOM || error{ SyntaxError, StackOverflow };

    pub fn parse(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) ParseError!Expr {
        bun.analytics.Features.xml_parse += 1;

        var parser: Parser(.utf8) = .init(allocator, source.contents);

        const document = parser.parse() catch |e| {
            const err: Parser(.utf8).ParseResult = .fail(e, &parser);
            try err.err.addToLog(source, log);
            return error.SyntaxError;
        };

        return document.root;
    }
};

pub fn parse(comptime encoding: Encoding, allocator: std.mem.Allocator, input: []const encoding.unit()) Parser(encoding).ParseResult {
    var parser: Parser(encoding) = .init(allocator, input);

    const document = parser.parse() catch |err| {
        return .fail(err, &parser);
    };

    return .success(document, &parser);
}

pub const Encoding = enum {
    latin1,
    utf8,
    utf16,

    pub fn unit(comptime encoding: Encoding) type {
        return switch (encoding) {
            .latin1 => u8,
            .utf8 => u8,
            .utf16 => u16,
        };
    }

    pub fn literal(comptime encoding: Encoding, comptime str: []const u8) []const encoding.unit() {
        return switch (encoding) {
            .latin1, .utf8 => str,
            .utf16 => comptime std.unicode.utf8ToUtf16LeStringLiteral(str),
        };
    }

    pub fn chars(comptime encoding: Encoding) type {
        return switch (encoding) {
            .latin1, .utf8 => struct {
                pub const less_than = '<';
                pub const greater_than = '>';
                pub const equals = '=';
                pub const quote = '"';
                pub const apostrophe = '\'';
                pub const slash = '/';
                pub const question = '?';
                pub const exclamation = '!';
                pub const hyphen = '-';
                pub const space = ' ';
                pub const tab = '\t';
                pub const newline = '\n';
                pub const carriage_return = '\r';
                pub const colon = ':';
                pub const semicolon = ';';
                pub const ampersand = '&';
                pub const hash = '#';
                pub const left_bracket = '[';
                pub const right_bracket = ']';
            },
            .utf16 => struct {
                pub const less_than = std.unicode.utf8ToUtf16LeStringLiteral("<")[0];
                pub const greater_than = std.unicode.utf8ToUtf16LeStringLiteral(">")[0];
                pub const equals = std.unicode.utf8ToUtf16LeStringLiteral("=")[0];
                pub const quote = std.unicode.utf8ToUtf16LeStringLiteral("\"")[0];
                pub const apostrophe = std.unicode.utf8ToUtf16LeStringLiteral("'")[0];
                pub const slash = std.unicode.utf8ToUtf16LeStringLiteral("/")[0];
                pub const question = std.unicode.utf8ToUtf16LeStringLiteral("?")[0];
                pub const exclamation = std.unicode.utf8ToUtf16LeStringLiteral("!")[0];
                pub const hyphen = std.unicode.utf8ToUtf16LeStringLiteral("-")[0];
                pub const space = std.unicode.utf8ToUtf16LeStringLiteral(" ")[0];
                pub const tab = std.unicode.utf8ToUtf16LeStringLiteral("\t")[0];
                pub const newline = std.unicode.utf8ToUtf16LeStringLiteral("\n")[0];
                pub const carriage_return = std.unicode.utf8ToUtf16LeStringLiteral("\r")[0];
                pub const colon = std.unicode.utf8ToUtf16LeStringLiteral(":")[0];
                pub const semicolon = std.unicode.utf8ToUtf16LeStringLiteral(";")[0];
                pub const ampersand = std.unicode.utf8ToUtf16LeStringLiteral("&")[0];
                pub const hash = std.unicode.utf8ToUtf16LeStringLiteral("#")[0];
                pub const left_bracket = std.unicode.utf8ToUtf16LeStringLiteral("[")[0];
                pub const right_bracket = std.unicode.utf8ToUtf16LeStringLiteral("]")[0];
            },
        };
    }
};

pub const Pos = enum(usize) {
    zero = 0,
    _,

    pub fn from(pos: usize) Pos {
        return @enumFromInt(pos);
    }

    pub fn cast(pos: Pos) usize {
        return @intFromEnum(pos);
    }

    pub fn loc(pos: Pos) logger.Loc {
        return .{ .start = @intCast(@intFromEnum(pos)) };
    }

    pub fn inc(pos: *Pos, n: usize) void {
        pos.* = @enumFromInt(@intFromEnum(pos.*) + n);
    }

    pub fn add(pos: Pos, n: usize) Pos {
        return @enumFromInt(@intFromEnum(pos) + n);
    }

    pub fn isLessThan(pos: Pos, other: usize) bool {
        return pos.cast() < other;
    }
};

pub const Line = enum(usize) {
    _,

    pub fn from(line: usize) Line {
        return @enumFromInt(line);
    }

    pub fn cast(line: Line) usize {
        return @intFromEnum(line);
    }

    pub fn inc(line: *Line, n: usize) void {
        line.* = @enumFromInt(@intFromEnum(line.*) + n);
    }
};

// XML Token types
pub fn Token(comptime _: Encoding) type {
    return union(enum) {
        eof: Pos,
        text: TextRange,
        element_start: ElementStart,
        element_end: ElementEnd,
        element_self_closing: ElementSelfClosing,
        attribute: Attribute,
        comment: TextRange,
        cdata: TextRange,
        xml_declaration: XmlDeclaration,
        dtd_declaration: TextRange,
        processing_instruction: ProcessingInstruction,

        pub const TextRange = struct {
            start: Pos,
            end: Pos,
        };

        pub const ElementStart = struct {
            name_start: Pos,
            name_end: Pos,
            pos: Pos,
        };

        pub const ElementEnd = struct {
            name_start: Pos,
            name_end: Pos,
            pos: Pos,
        };

        pub const ElementSelfClosing = struct {
            name_start: Pos,
            name_end: Pos,
            pos: Pos,
        };

        pub const Attribute = struct {
            name_start: Pos,
            name_end: Pos,
            value_start: Pos,
            value_end: Pos,
            pos: Pos,
        };

        pub const XmlDeclaration = struct {
            version_start: Pos,
            version_end: Pos,
            encoding_start: Pos,
            encoding_end: Pos,
            standalone_start: Pos,
            standalone_end: Pos,
            pos: Pos,
        };

        pub const ProcessingInstruction = struct {
            target_start: Pos,
            target_end: Pos,
            data_start: Pos,
            data_end: Pos,
            pos: Pos,
        };
    };
}

pub fn Parser(comptime enc: Encoding) type {
    const chars = enc.chars();

    return struct {
        input: []const enc.unit(),
        pos: Pos,
        line: Line,
        allocator: std.mem.Allocator,
        token: Token(enc),
        stack_check: bun.StackCheck,
        element_stack: std.ArrayList([]const enc.unit()),
        namespace_stack: std.ArrayList(std.StringHashMap([]const enc.unit())),
        current_attributes: std.StringHashMap([]const enc.unit()),

        const Self = @This();

        pub fn init(allocator: std.mem.Allocator, input: []const enc.unit()) Self {
            return .{
                .input = input,
                .allocator = allocator,
                .pos = .from(0),
                .line = .from(1),
                .token = .{ .eof = .from(0) },
                .stack_check = .init(),
                .element_stack = .init(allocator),
                .namespace_stack = .init(allocator),
                .current_attributes = std.StringHashMap([]const enc.unit()).init(allocator),
            };
        }

        pub fn deinit(self: *Self) void {
            self.element_stack.deinit();
            for (self.namespace_stack.items) |*ns_map| {
                ns_map.deinit();
            }
            self.namespace_stack.deinit();
            self.current_attributes.deinit();
        }

        pub const ParseResult = union(enum) {
            result: Result,
            err: Error,

            pub const Result = struct {
                document: Document,
                allocator: std.mem.Allocator,

                pub fn deinit(this: *@This()) void {
                    this.document.deinit();
                }
            };

            pub const Error = union(enum) {
                oom,
                stack_overflow,
                unexpected_eof: struct { pos: Pos },
                unexpected_token: struct { pos: Pos },
                unexpected_character: struct { pos: Pos },
                invalid_xml_declaration: struct { pos: Pos },
                malformed_element: struct { pos: Pos },
                malformed_attribute: struct { pos: Pos },
                unmatched_element: struct { pos: Pos },
                invalid_entity_reference: struct { pos: Pos },
                invalid_character_reference: struct { pos: Pos },
                invalid_namespace_declaration: struct { pos: Pos },
                duplicate_attribute: struct { pos: Pos },
                invalid_cdata_section: struct { pos: Pos },
                invalid_comment: struct { pos: Pos },
                invalid_processing_instruction: struct { pos: Pos },

                pub fn addToLog(self: *const @This(), source: *const logger.Source, log: *logger.Log) !void {
                    switch (self.*) {
                        .oom => try log.addError(source, logger.Loc{ .start = 0 }, "Out of memory while parsing XML"),
                        .stack_overflow => try log.addError(source, logger.Loc{ .start = 0 }, "Stack overflow while parsing XML"),
                        .unexpected_eof => |payload| try log.addError(source, payload.pos.loc(), "Unexpected end of file in XML"),
                        .unexpected_token => |payload| try log.addError(source, payload.pos.loc(), "Unexpected token in XML"),
                        .unexpected_character => |payload| try log.addError(source, payload.pos.loc(), "Unexpected character in XML"),
                        .invalid_xml_declaration => |payload| try log.addError(source, payload.pos.loc(), "Invalid XML declaration"),
                        .malformed_element => |payload| try log.addError(source, payload.pos.loc(), "Malformed XML element"),
                        .malformed_attribute => |payload| try log.addError(source, payload.pos.loc(), "Malformed XML attribute"),
                        .unmatched_element => |payload| try log.addError(source, payload.pos.loc(), "Unmatched XML element"),
                        .invalid_entity_reference => |payload| try log.addError(source, payload.pos.loc(), "Invalid XML entity reference"),
                        .invalid_character_reference => |payload| try log.addError(source, payload.pos.loc(), "Invalid XML character reference"),
                        .invalid_namespace_declaration => |payload| try log.addError(source, payload.pos.loc(), "Invalid XML namespace declaration"),
                        .duplicate_attribute => |payload| try log.addError(source, payload.pos.loc(), "Duplicate XML attribute"),
                        .invalid_cdata_section => |payload| try log.addError(source, payload.pos.loc(), "Invalid CDATA section"),
                        .invalid_comment => |payload| try log.addError(source, payload.pos.loc(), "Invalid XML comment"),
                        .invalid_processing_instruction => |payload| try log.addError(source, payload.pos.loc(), "Invalid XML processing instruction"),
                    }
                }
            };
            
            pub fn success(document: Document, parser: *Parser(enc)) ParseResult {
                return .{ .result = .{ .document = document, .allocator = parser.allocator } };
            }

            pub fn fail(err: anyerror, parser: *Parser(enc)) ParseResult {
                return .{ .err = switch (err) {
                    error.OutOfMemory => .oom,
                    error.StackOverflow => .stack_overflow,
                    else => .{ .unexpected_token = .{ .pos = parser.pos } },
                } };
            }
        };

        pub const Document = struct {
            root: Expr,
            xml_declaration: ?XmlDeclaration,
            dtd_declaration: ?[]const enc.unit(),

            pub fn deinit(self: *@This()) void {
                _ = self;
                // AST expressions are managed by the allocator
            }

            const XmlDeclaration = struct {
                version: []const enc.unit(),
                encoding: ?[]const enc.unit(),
                standalone: ?[]const enc.unit(),
            };
        };

        // Current character access
        fn current(self: *const Self) ?enc.unit() {
            if (self.pos.cast() >= self.input.len) return null;
            return self.input[self.pos.cast()];
        }

        // Peek ahead n characters
        fn peek(self: *const Self, n: usize) ?enc.unit() {
            const idx = self.pos.cast() + n;
            if (idx >= self.input.len) return null;
            return self.input[idx];
        }

        // Advance position by n characters
        fn advance(self: *Self, n: usize) void {
            for (0..n) |_| {
                if (self.pos.cast() >= self.input.len) break;
                if (self.input[self.pos.cast()] == chars.newline) {
                    self.line.inc(1);
                }
                self.pos.inc(1);
            }
        }

        // Skip whitespace characters
        fn skipWhitespace(self: *Self) void {
            while (self.current()) |c| {
                switch (c) {
                    chars.space, chars.tab, chars.newline, chars.carriage_return => self.advance(1),
                    else => break,
                }
            }
        }

        // Check if character is valid for XML names
        fn isNameStartChar(c: enc.unit()) bool {
            return switch (c) {
                'A'...'Z', 'a'...'z', ':', '_' => true,
                else => false,
            };
        }

        fn isNameChar(c: enc.unit()) bool {
            return switch (c) {
                'A'...'Z', 'a'...'z', '0'...'9', ':', '_', '-', '.' => true,
                else => false,
            };
        }

        // Tokenizer methods
        fn nextToken(self: *Self) !Token(enc) {
            self.skipWhitespace();

            const start_pos = self.pos;
            const c = self.current() orelse return .{ .eof = start_pos };

            switch (c) {
                chars.less_than => {
                    self.advance(1);
                    const next_c = self.current() orelse return error.UnexpectedEof;

                    switch (next_c) {
                        chars.slash => {
                            // End tag: </name>
                            self.advance(1);
                            return try self.parseEndTag(start_pos);
                        },
                        chars.question => {
                            // XML declaration or processing instruction: <?...?>
                            self.advance(1);
                            return try self.parseProcessingInstruction(start_pos);
                        },
                        chars.exclamation => {
                            // Comment, CDATA, or DTD declaration: <!...>
                            self.advance(1);
                            return try self.parseExclamationToken(start_pos);
                        },
                        else => {
                            // Start tag: <name...>
                            return try self.parseStartTag(start_pos);
                        },
                    }
                },
                else => {
                    // Text content
                    return try self.parseText(start_pos);
                },
            }
        }

        fn parseStartTag(self: *Self, start_pos: Pos) !Token(enc) {
            const name_start = self.pos;
            
            // Parse element name
            if (!isNameStartChar(self.current() orelse return error.MalformedElement)) {
                return error.MalformedElement;
            }

            while (self.current()) |c| {
                if (!isNameChar(c)) break;
                self.advance(1);
            }

            const name_end = self.pos;
            self.skipWhitespace();

            // Clear previous attributes
            self.current_attributes.clearRetainingCapacity();

            // Check for attributes or closing
            while (self.current()) |c| {
                switch (c) {
                    chars.slash => {
                        // Self-closing tag
                        self.advance(1);
                        if (self.current() != chars.greater_than) {
                            return error.MalformedElement;
                        }
                        self.advance(1);
                        return .{ .element_self_closing = .{
                            .name_start = name_start,
                            .name_end = name_end,
                            .pos = start_pos,
                        } };
                    },
                    chars.greater_than => {
                        // Regular start tag
                        self.advance(1);
                        return .{ .element_start = .{
                            .name_start = name_start,
                            .name_end = name_end,
                            .pos = start_pos,
                        } };
                    },
                    else => {
                        // Parse attribute and store it
                        const attr = try self.parseAttribute();
                        const attr_name = self.input[attr.attribute.name_start.cast()..attr.attribute.name_end.cast()];
                        const attr_value = self.input[attr.attribute.value_start.cast()..attr.attribute.value_end.cast()];
                        const decoded_value = try self.decodeEntities(attr_value);
                        
                        // Check for duplicate attributes
                        if (self.current_attributes.contains(attr_name)) {
                            return error.DuplicateAttribute;
                        }
                        
                        try self.current_attributes.put(attr_name, decoded_value);
                        self.skipWhitespace();
                    },
                }
            }

            return error.MalformedElement;
        }

        fn parseAttribute(self: *Self) !Token(enc) {
            const name_start = self.pos;
            
            // Parse attribute name
            if (!isNameStartChar(self.current() orelse return error.MalformedAttribute)) {
                return error.MalformedAttribute;
            }

            while (self.current()) |c| {
                if (!isNameChar(c)) break;
                self.advance(1);
            }

            const name_end = self.pos;
            self.skipWhitespace();

            // Expect '='
            if (self.current() != chars.equals) {
                return error.MalformedAttribute;
            }
            self.advance(1);
            self.skipWhitespace();

            // Parse attribute value
            const quote_char = self.current() orelse return error.MalformedAttribute;
            if (quote_char != chars.quote and quote_char != chars.apostrophe) {
                return error.MalformedAttribute;
            }
            self.advance(1);
            const value_start = self.pos;

            while (self.current()) |c| {
                if (c == quote_char) break;
                if (c == chars.ampersand) {
                    try self.parseEntityReference();
                    continue;
                }
                self.advance(1);
            }

            const value_end = self.pos;
            if (self.current() != quote_char) {
                return error.MalformedAttribute;
            }
            self.advance(1);

            return .{ .attribute = .{
                .name_start = name_start,
                .name_end = name_end,
                .value_start = value_start,
                .value_end = value_end,
                .pos = name_start,
            } };
        }

        fn parseEndTag(self: *Self, _: Pos) !Token(enc) {
            const name_start = self.pos;
            
            if (!isNameStartChar(self.current() orelse return error.MalformedElement)) {
                return error.MalformedElement;
            }

            while (self.current()) |c| {
                if (!isNameChar(c)) break;
                self.advance(1);
            }

            const name_end = self.pos;
            self.skipWhitespace();

            if (self.current() != chars.greater_than) {
                return error.MalformedElement;
            }
            self.advance(1);

            return .{ .element_end = .{
                .name_start = name_start,
                .name_end = name_end,
                .pos = .zero,
            } };
        }

        fn parseProcessingInstruction(self: *Self, start_pos: Pos) !Token(enc) {
            const target_start = self.pos;
            
            // Parse target name
            if (!isNameStartChar(self.current() orelse return error.InvalidProcessingInstruction)) {
                return error.InvalidProcessingInstruction;
            }

            while (self.current()) |c| {
                if (!isNameChar(c)) break;
                self.advance(1);
            }

            const target_end = self.pos;
            const target_name = self.input[target_start.cast()..target_end.cast()];

            // Check for XML declaration
            if (std.mem.eql(enc.unit(), target_name, "xml")) {
                return try self.parseXmlDeclaration(start_pos);
            }

            // Parse processing instruction data
            self.skipWhitespace();
            const data_start = self.pos;

            // Find end of processing instruction
            while (self.current()) |c| {
                if (c == chars.question and self.peek(1) == chars.greater_than) {
                    const data_end = self.pos;
                    self.advance(2); // Skip ?>
                    return .{ .processing_instruction = .{
                        .target_start = target_start,
                        .target_end = target_end,
                        .data_start = data_start,
                        .data_end = data_end,
                        .pos = start_pos,
                    } };
                }
                self.advance(1);
            }

            return error.InvalidProcessingInstruction;
        }

        fn parseXmlDeclaration(self: *Self, start_pos: Pos) !Token(enc) {
            var version_start: Pos = .zero;
            var version_end: Pos = .zero;
            var encoding_start: Pos = .zero;
            var encoding_end: Pos = .zero;
            var standalone_start: Pos = .zero;
            var standalone_end: Pos = .zero;

            self.skipWhitespace();

            // Parse attributes (version, encoding, standalone)
            while (self.current()) |c| {
                if (c == chars.question and self.peek(1) == chars.greater_than) {
                    self.advance(2);
                    return .{ .xml_declaration = .{
                        .version_start = version_start,
                        .version_end = version_end,
                        .encoding_start = encoding_start,
                        .encoding_end = encoding_end,
                        .standalone_start = standalone_start,
                        .standalone_end = standalone_end,
                        .pos = start_pos,
                    } };
                }

                // Parse attribute name
                const attr_name_start = self.pos;
                while (self.current()) |name_c| {
                    if (!isNameChar(name_c)) break;
                    self.advance(1);
                }
                const attr_name_end = self.pos;
                const attr_name = self.input[attr_name_start.cast()..attr_name_end.cast()];

                self.skipWhitespace();
                if (self.current() != chars.equals) {
                    return error.InvalidXmlDeclaration;
                }
                self.advance(1);
                self.skipWhitespace();

                // Parse attribute value
                const quote_char = self.current() orelse return error.InvalidXmlDeclaration;
                if (quote_char != chars.quote and quote_char != chars.apostrophe) {
                    return error.InvalidXmlDeclaration;
                }
                self.advance(1);
                const attr_value_start = self.pos;

                while (self.current()) |value_c| {
                    if (value_c == quote_char) break;
                    self.advance(1);
                }
                const attr_value_end = self.pos;
                self.advance(1); // Skip closing quote

                // Set appropriate field based on attribute name
                if (std.mem.eql(enc.unit(), attr_name, "version")) {
                    version_start = attr_value_start;
                    version_end = attr_value_end;
                } else if (std.mem.eql(enc.unit(), attr_name, "encoding")) {
                    encoding_start = attr_value_start;
                    encoding_end = attr_value_end;
                } else if (std.mem.eql(enc.unit(), attr_name, "standalone")) {
                    standalone_start = attr_value_start;
                    standalone_end = attr_value_end;
                }

                self.skipWhitespace();
            }

            return error.InvalidXmlDeclaration;
        }

        fn parseExclamationToken(self: *Self, start_pos: Pos) !Token(enc) {
            const next_c = self.current() orelse return error.UnexpectedEof;

            switch (next_c) {
                chars.hyphen => {
                    // Comment: <!--...-->
                    if (self.peek(1) != chars.hyphen) {
                        return error.InvalidComment;
                    }
                    self.advance(2);
                    return try self.parseComment(start_pos);
                },
                chars.left_bracket => {
                    // CDATA: <![CDATA[...]]>
                    if (self.checkString("CDATA[")) {
                        self.advance(6);
                        return try self.parseCData(start_pos);
                    }
                    return error.InvalidCdataSection;
                },
                else => {
                    // DTD declaration
                    return try self.parseDTD(start_pos);
                },
            }
        }

        fn parseComment(self: *Self, _: Pos) !Token(enc) {
            const content_start = self.pos;

            while (self.current()) |c| {
                if (c == chars.hyphen and 
                   self.peek(1) == chars.hyphen and 
                   self.peek(2) == chars.greater_than) {
                    const content_end = self.pos;
                    self.advance(3); // Skip -->
                    return .{ .comment = .{
                        .start = content_start,
                        .end = content_end,
                    } };
                }
                self.advance(1);
            }

            return error.InvalidComment;
        }

        fn parseCData(self: *Self, _: Pos) !Token(enc) {
            const content_start = self.pos;

            while (self.current()) |c| {
                if (c == chars.right_bracket and 
                   self.peek(1) == chars.right_bracket and 
                   self.peek(2) == chars.greater_than) {
                    const content_end = self.pos;
                    self.advance(3); // Skip ]]>
                    return .{ .cdata = .{
                        .start = content_start,
                        .end = content_end,
                    } };
                }
                self.advance(1);
            }

            return error.InvalidCdataSection;
        }

        fn parseDTD(self: *Self, _: Pos) !Token(enc) {
            const content_start = self.pos;

            // Simple DTD parsing - just find the closing >
            var bracket_depth: u32 = 0;
            while (self.current()) |c| {
                switch (c) {
                    chars.less_than => bracket_depth += 1,
                    chars.greater_than => {
                        if (bracket_depth == 0) {
                            const content_end = self.pos;
                            self.advance(1);
                            return .{ .dtd_declaration = .{
                                .start = content_start,
                                .end = content_end,
                            } };
                        }
                        bracket_depth -= 1;
                    },
                    else => {},
                }
                self.advance(1);
            }

            return error.UnexpectedEof;
        }

        fn parseText(self: *Self, _: Pos) !Token(enc) {
            const content_start = self.pos;

            while (self.current()) |c| {
                if (c == chars.less_than) break;
                if (c == chars.ampersand) {
                    // Handle entity references
                    try self.parseEntityReference();
                    continue;
                }
                self.advance(1);
            }

            const content_end = self.pos;
            return .{ .text = .{
                .start = content_start,
                .end = content_end,
            } };
        }

        fn parseEntityReference(self: *Self) !void {
            self.advance(1); // Skip &
            
            while (self.current()) |c| {
                if (c == chars.semicolon) {
                    self.advance(1);
                    return;
                }
                self.advance(1);
            }

            return error.InvalidEntityReference;
        }

        fn checkString(self: *const Self, str: []const u8) bool {
            if (self.pos.cast() + str.len > self.input.len) return false;
            
            for (str, 0..) |expected_char, i| {
                if (self.input[self.pos.cast() + i] != expected_char) return false;
            }
            return true;
        }

        // Main parsing logic
        pub fn parse(self: *Self) !Document {
            if (!self.stack_check.isSafeToRecurse()) {
                try bun.throwStackOverflow();
            }

            var xml_declaration: ?Document.XmlDeclaration = null;
            var dtd_declaration: ?[]const enc.unit() = null;
            var root_expr: ?Expr = null;

            // Parse document
            while (true) {
                const token = try self.nextToken();
                
                switch (token) {
                    .eof => break,
                    .xml_declaration => |decl| {
                        xml_declaration = Document.XmlDeclaration{
                            .version = self.input[decl.version_start.cast()..decl.version_end.cast()],
                            .encoding = if (decl.encoding_start.cast() != 0) 
                                self.input[decl.encoding_start.cast()..decl.encoding_end.cast()] 
                            else null,
                            .standalone = if (decl.standalone_start.cast() != 0) 
                                self.input[decl.standalone_start.cast()..decl.standalone_end.cast()] 
                            else null,
                        };
                    },
                    .dtd_declaration => |dtd| {
                        dtd_declaration = self.input[dtd.start.cast()..dtd.end.cast()];
                    },
                    .element_start, .element_self_closing => {
                        if (root_expr != null) {
                            return error.MalformedElement;
                        }
                        root_expr = try self.parseElement(token);
                    },
                    .comment, .processing_instruction => {
                        // Skip comments and PIs at document level
                        continue;
                    },
                    else => {
                        return error.UnexpectedToken;
                    },
                }
            }

            return Document{
                .root = root_expr orelse .init(E.Null, .{}, .Empty),
                .xml_declaration = xml_declaration,
                .dtd_declaration = dtd_declaration,
            };
        }

        fn parseElement(self: *Self, start_token: Token(enc)) !Expr {
            const name_start, const name_end, const is_self_closing = switch (start_token) {
                .element_start => |info| .{ info.name_start, info.name_end, false },
                .element_self_closing => |info| .{ info.name_start, info.name_end, true },
                else => return error.UnexpectedToken,
            };

            const element_name = self.input[name_start.cast()..name_end.cast()];
            
            // Create object for element
            var properties = std.ArrayList(js_ast.G.Property).init(self.allocator);
            var children = std.ArrayList(Expr).init(self.allocator);
            
            // Copy attributes from parser state (they were collected during parseStartTag)
            var attributes_map = std.StringHashMap([]const u8).init(self.allocator);
            defer attributes_map.deinit();
            
            var attr_iterator = self.current_attributes.iterator();
            while (attr_iterator.next()) |entry| {
                try attributes_map.put(entry.key_ptr.*, entry.value_ptr.*);
            }
            
            // Parse content for non-self-closing elements
            if (!is_self_closing) {
                try self.element_stack.append(element_name);
                defer _ = self.element_stack.pop();

                // Parse content until we find the matching end tag
                while (true) {
                    const token = try self.nextToken();
                    
                    switch (token) {
                        .eof => return error.UnmatchedElement,
                        .element_end => |end_info| {
                            const end_name = self.input[end_info.name_start.cast()..end_info.name_end.cast()];
                            if (!std.mem.eql(enc.unit(), element_name, end_name)) {
                                return error.UnmatchedElement;
                            }
                            break;
                        },
                        .element_start, .element_self_closing => {
                            const child_expr = try self.parseElement(token);
                            try children.append(child_expr);
                        },
                        .text => |text| {
                            const text_content = self.input[text.start.cast()..text.end.cast()];
                            // Decode entity references in text content
                            const decoded_text = try self.decodeEntities(text_content);
                            // Skip whitespace-only text nodes
                            if (!isWhitespaceOnly(decoded_text)) {
                                const text_expr = Expr.init(E.String, .{ .data = decoded_text }, name_start.loc());
                                try children.append(text_expr);
                            }
                        },
                        .cdata => |cdata| {
                            const cdata_content = self.input[cdata.start.cast()..cdata.end.cast()];
                            const cdata_expr = Expr.init(E.String, .{ .data = cdata_content }, name_start.loc());
                            try children.append(cdata_expr);
                        },
                        .comment => {
                            // Skip comments in element content
                            continue;
                        },
                        else => {
                            return error.UnexpectedToken;
                        },
                    }
                }
            }

            // Add attributes as regular object properties (like JSON)
            var attr_props_iterator = attributes_map.iterator();
            while (attr_props_iterator.next()) |entry| {
                const attr_prop = js_ast.G.Property{
                    .key = Expr.init(E.String, .{ .data = entry.key_ptr.* }, name_start.loc()),
                    .value = Expr.init(E.String, .{ .data = entry.value_ptr.* }, name_start.loc()),
                    .kind = .normal,
                    .initializer = null,
                };
                try properties.append(attr_prop);
            }

            // Convert to JavaScript object (JSON-like)
            // Handle different content scenarios
            if (children.items.len == 0) {
                // Empty element
                if (attributes_map.count() == 0) {
                    return .init(E.Null, .{}, name_start.loc());
                }
                // Just attributes, no content
                return .init(E.Object, .{ .properties = .fromList(properties) }, name_start.loc());
            } else if (children.items.len == 1 and attributes_map.count() == 0) {
                // Single text child with no attributes - return the text directly
                if (children.items[0].data == .e_string) {
                    return children.items[0];
                }
            }

            // Add child elements as object properties (like JSON)
            for (children.items) |_| {
                // For now, just add children as array items
                // TODO: Group children by element name and create proper object structure
            }

            // If we have mixed content, create a simple structure
            if (children.items.len == 1) {
                // Single child - if it's text, add it directly
                if (children.items[0].data == .e_string) {
                    // Add text content along with attributes
                    // For elements with both attributes and text, we need a way to represent both
                    // For now, let's return an object with attributes only
                    return .init(E.Object, .{ .properties = .fromList(properties) }, name_start.loc());
                }
            }

            // Return object with properties (attributes + any structured content)
            return .init(E.Object, .{ .properties = .fromList(properties) }, name_start.loc());
        }

        fn decodeEntities(self: *Self, text: []const enc.unit()) ![]const enc.unit() {
            // Simple entity decoding - handle basic XML entities
            if (std.mem.indexOf(enc.unit(), text, "&") == null) {
                return text; // No entities to decode
            }

            var result = std.ArrayList(enc.unit()).init(self.allocator);
            defer result.deinit();

            var i: usize = 0;
            while (i < text.len) {
                if (text[i] == chars.ampersand) {
                    // Find the semicolon
                    const start = i;
                    while (i < text.len and text[i] != chars.semicolon) {
                        i += 1;
                    }
                    if (i >= text.len) {
                        // Malformed entity reference, just copy as-is
                        try result.append(chars.ampersand);
                        i = start + 1;
                        continue;
                    }
                    
                    const entity = text[start + 1..i];
                    
                    // Decode common XML entities
                    if (std.mem.eql(enc.unit(), entity, "amp")) {
                        try result.append(chars.ampersand);
                    } else if (std.mem.eql(enc.unit(), entity, "lt")) {
                        try result.append(chars.less_than);
                    } else if (std.mem.eql(enc.unit(), entity, "gt")) {
                        try result.append(chars.greater_than);
                    } else if (std.mem.eql(enc.unit(), entity, "quot")) {
                        try result.append(chars.quote);
                    } else if (std.mem.eql(enc.unit(), entity, "apos")) {
                        try result.append(chars.apostrophe);
                    } else if (entity.len > 1 and entity[0] == chars.hash) {
                        // Character reference
                        if (entity.len > 2 and entity[1] == 'x') {
                            // Hexadecimal character reference &#xHH;
                            const hex_str = entity[2..];
                            if (std.fmt.parseUnsigned(u32, hex_str, 16)) |code_point| {
                                // For UTF-8, we need to encode the code point
                                var utf8_buf: [4]u8 = undefined;
                                const len = std.unicode.utf8Encode(@intCast(code_point), &utf8_buf) catch {
                                    // Invalid code point, copy as-is
                                    try result.appendSlice(text[start..i + 1]);
                                    i += 1;
                                    continue;
                                };
                                try result.appendSlice(utf8_buf[0..len]);
                            } else |_| {
                                // Invalid hex, copy as-is
                                try result.appendSlice(text[start..i + 1]);
                            }
                        } else {
                            // Decimal character reference &#DD;
                            const dec_str = entity[1..];
                            if (std.fmt.parseUnsigned(u32, dec_str, 10)) |code_point| {
                                var utf8_buf: [4]u8 = undefined;
                                const len = std.unicode.utf8Encode(@intCast(code_point), &utf8_buf) catch {
                                    try result.appendSlice(text[start..i + 1]);
                                    i += 1;
                                    continue;
                                };
                                try result.appendSlice(utf8_buf[0..len]);
                            } else |_| {
                                try result.appendSlice(text[start..i + 1]);
                            }
                        }
                    } else {
                        // Unknown entity, copy as-is
                        try result.appendSlice(text[start..i + 1]);
                    }
                    i += 1;
                } else {
                    try result.append(text[i]);
                    i += 1;
                }
            }

            return try self.allocator.dupe(enc.unit(), result.items);
        }

        fn isWhitespaceOnly(text: []const enc.unit()) bool {
            for (text) |c| {
                switch (c) {
                    chars.space, chars.tab, chars.newline, chars.carriage_return => continue,
                    else => return false,
                }
            }
            return true;
        }
    };
}