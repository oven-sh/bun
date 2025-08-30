const ChildElement = struct {
    tag_name: []const u8,
    element: Expr,
};

pub const XML = struct {
    const ParseError = error{ OutOfMemory, SyntaxError, StackOverflow };

    pub fn parse(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) ParseError!Expr {
        if (source.contents.len == 0) {
            return Expr.init(E.Null, .{}, .Empty);
        }

        var parser = Parser{
            .source = source,
            .log = log,
            .allocator = allocator,
            .current = 0,
            .line = 1,
            .column = 1,
        };

        return parser.parseDocument() catch |err| switch (err) {
            error.XMLParseError => error.SyntaxError,
            else => |e| e,
        };
    }
};

const Parser = struct {
    source: *const logger.Source,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    current: usize,
    line: u32,
    column: u32,

    fn parseDocument(self: *Parser) !Expr {
        self.skipWhitespace();

        // Skip XML declaration if present
        if (self.current + 5 < self.source.contents.len and std.mem.startsWith(u8, self.source.contents[self.current..], "<?xml")) {
            while (self.current < self.source.contents.len and !std.mem.startsWith(u8, self.source.contents[self.current..], "?>")) {
                self.advance();
            }
            if (self.current + 1 < self.source.contents.len) {
                self.advance(); // skip '?'
                self.advance(); // skip '>'
            }
            self.skipWhitespace();
        }

        if (self.current >= self.source.contents.len) {
            return self.parseError("No root element found");
        }

        const result = try self.parseElementWithName();
        return result.element;
    }

    fn parseElementWithName(self: *Parser) !ChildElement {
        if (self.current >= self.source.contents.len or self.source.contents[self.current] != '<') {
            return self.parseError("Expected '<' to start element");
        }
        self.advance(); // consume '<'

        // Get tag name
        const tag_start = self.current;
        while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
            self.advance();
        }

        if (self.current == tag_start) {
            return self.parseError("Expected element name");
        }

        const tag_name_slice = self.source.contents[tag_start..self.current];
        self.skipWhitespace();

        // Parse attributes
        var attributes = std.ArrayList(G.Property).init(self.allocator);

        while (self.current < self.source.contents.len and
            self.source.contents[self.current] != '>' and
            self.source.contents[self.current] != '/')
        {
            const attr = try self.parseAttribute();
            try attributes.append(attr);
            self.skipWhitespace();
        }

        // Check for self-closing tag
        if (self.current < self.source.contents.len and self.source.contents[self.current] == '/') {
            self.advance(); // consume '/'
            if (self.current >= self.source.contents.len or self.source.contents[self.current] != '>') {
                return self.parseError("Expected '>' after '/' in self-closing tag");
            }
            self.advance(); // consume '>'

            // Create object with attributes only
            var properties = std.ArrayList(G.Property).init(self.allocator);

            if (attributes.items.len > 0) {
                const attrs_obj = Expr.init(E.Object, .{ .properties = .fromList(attributes) }, .Empty);
                const attrs_key = try self.createStringExpr("__attrs");
                try properties.append(.{ .key = attrs_key, .value = attrs_obj });
            }

            const element = Expr.init(E.Object, .{ .properties = .fromList(properties) }, .Empty);
            return ChildElement{
                .tag_name = tag_name_slice,
                .element = element,
            };
        }

        // Must be closing '>'
        if (self.current >= self.source.contents.len or self.source.contents[self.current] != '>') {
            return self.parseError("Expected '>' to close opening tag");
        }
        self.advance(); // consume '>'

        // Parse content (text and child elements)
        var children = std.ArrayList(ChildElement).init(self.allocator);
        var text_parts = std.ArrayList(u8).init(self.allocator);
        defer text_parts.deinit();

        while (self.current < self.source.contents.len) {
            if (self.current + 1 < self.source.contents.len and
                self.source.contents[self.current] == '<' and
                self.source.contents[self.current + 1] == '/')
            {
                // End tag found
                break;
            } else if (self.current + 3 < self.source.contents.len and
                std.mem.startsWith(u8, self.source.contents[self.current..], "<!--"))
            {
                // Comment found - skip it
                self.skipComment();
            } else if (self.source.contents[self.current] == '<') {
                // Child element
                const child = try self.parseElementWithName();
                try children.append(child);
            } else {
                // Text content
                const text_start = self.current;
                while (self.current < self.source.contents.len and self.source.contents[self.current] != '<') {
                    self.advance();
                }

                if (self.current > text_start) {
                    const text = self.source.contents[text_start..self.current];
                    try text_parts.appendSlice(text);
                }
            }
        }

        // Parse closing tag
        if (self.current + 1 >= self.source.contents.len or
            self.source.contents[self.current] != '<' or
            self.source.contents[self.current + 1] != '/')
        {
            return self.parseError("Expected closing tag");
        }
        self.advance(); // consume '<'
        self.advance(); // consume '/'

        // Verify closing tag name
        const closing_start = self.current;
        while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
            self.advance();
        }

        const closing_name = self.source.contents[closing_start..self.current];
        if (!std.mem.eql(u8, tag_name_slice, closing_name)) {
            return self.parseError("Mismatched closing tag");
        }

        self.skipWhitespace();
        if (self.current >= self.source.contents.len or self.source.contents[self.current] != '>') {
            return self.parseError("Expected '>' to close closing tag");
        }
        self.advance(); // consume '>'

        // Build result based on content
        const trimmed_text = std.mem.trim(u8, text_parts.items, " \t\n\r");

        // If only text content and no attributes, return as string
        if (children.items.len == 0 and attributes.items.len == 0 and trimmed_text.len > 0) {
            const element = try self.createStringExpr(trimmed_text);
            return ChildElement{
                .tag_name = tag_name_slice,
                .element = element,
            };
        }

        // If only children and no attributes/text, return children directly as object properties
        if (children.items.len > 0 and attributes.items.len == 0 and trimmed_text.len == 0) {
            const element = try self.createChildrenAsProperties(children.items);
            return ChildElement{
                .tag_name = tag_name_slice,
                .element = element,
            };
        }

        // Otherwise create object with mixed content
        var properties = std.ArrayList(G.Property).init(self.allocator);

        // Add attributes
        if (attributes.items.len > 0) {
            const attrs_obj = Expr.init(E.Object, .{ .properties = .fromList(attributes) }, .Empty);
            const attrs_key = try self.createStringExpr("__attrs");
            try properties.append(.{ .key = attrs_key, .value = attrs_obj });
        }

        // Add children as properties if we have other properties
        if (children.items.len > 0) {
            try self.addChildrenAsProperties(&properties, children.items);
        }

        // Add text content if present
        if (trimmed_text.len > 0) {
            const text_expr = try self.createStringExpr(trimmed_text);
            const text_key = try self.createStringExpr("__text");
            try properties.append(.{ .key = text_key, .value = text_expr });
        }

        const element = Expr.init(E.Object, .{ .properties = .fromList(properties) }, .Empty);
        return ChildElement{
            .tag_name = tag_name_slice,
            .element = element,
        };
    }

    fn parseAttribute(self: *Parser) !G.Property {
        // Skip any whitespace before attribute
        self.skipWhitespace();

        const name_start = self.current;
        while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
            self.advance();
        }

        if (self.current == name_start) {
            return self.parseError("Expected attribute name");
        }

        const name_slice = self.source.contents[name_start..self.current];
        self.skipWhitespace();

        if (self.current >= self.source.contents.len or self.source.contents[self.current] != '=') {
            return self.parseError("Expected '=' after attribute name");
        }
        self.advance(); // consume '='

        self.skipWhitespace();

        if (self.current >= self.source.contents.len) {
            return self.parseError("Expected attribute value");
        }

        const quote = self.source.contents[self.current];
        if (quote != '"' and quote != '\'') {
            return self.parseError("Expected quote to start attribute value");
        }
        self.advance(); // consume opening quote

        const value_start = self.current;
        while (self.current < self.source.contents.len and self.source.contents[self.current] != quote) {
            self.advance();
        }

        if (self.current >= self.source.contents.len) {
            return self.parseError("Unterminated attribute value");
        }

        const value_slice = self.source.contents[value_start..self.current];
        self.advance(); // consume closing quote

        const key_expr = try self.createStringExpr(name_slice);
        const value_expr = try self.createStringExpr(value_slice);

        return G.Property{
            .key = key_expr,
            .value = value_expr,
        };
    }

    fn createStringExpr(self: *Parser, slice: []const u8) !Expr {
        // Decode XML entities before creating string
        const decoded_data = try self.decodeXmlEntities(slice);
        return Expr.init(E.String, .{ .data = decoded_data }, .Empty);
    }

    fn createChildrenAsProperties(self: *Parser, children: []ChildElement) !Expr {
        var properties = std.ArrayList(G.Property).init(self.allocator);
        var child_counts = std.StringHashMap(u32).init(self.allocator);
        defer child_counts.deinit();

        // First pass: count occurrences of each tag name to handle duplicates
        for (children) |child| {
            const tag_name = child.tag_name;
            const count = child_counts.get(tag_name) orelse 0;
            try child_counts.put(tag_name, count + 1);
        }

        // Second pass: create properties
        var processed_tags = std.StringHashMap(u32).init(self.allocator);
        defer processed_tags.deinit();

        for (children) |child| {
            const tag_name = child.tag_name;
            const total_count = child_counts.get(tag_name).?;
            const current_count = processed_tags.get(tag_name) orelse 0;

            if (total_count == 1) {
                // Single occurrence - add as property
                const key_expr = try self.createStringExpr(tag_name);
                try properties.append(.{ .key = key_expr, .value = child.element });
            } else {
                // Multiple occurrences - create array
                if (current_count == 0) {
                    // First occurrence - create array
                    var child_array = std.ArrayList(Expr).init(self.allocator);
                    for (children) |other_child| {
                        const other_tag_name = other_child.tag_name;
                        if (std.mem.eql(u8, tag_name, other_tag_name)) {
                            try child_array.append(other_child.element);
                        }
                    }
                    const array_expr = Expr.init(E.Array, .{ .items = .fromList(child_array) }, .Empty);
                    const key_expr = try self.createStringExpr(tag_name);
                    try properties.append(.{ .key = key_expr, .value = array_expr });
                }
            }

            try processed_tags.put(tag_name, current_count + 1);
        }

        return Expr.init(E.Object, .{ .properties = .fromList(properties) }, .Empty);
    }

    fn addChildrenAsProperties(self: *Parser, properties: *std.ArrayList(G.Property), children: []ChildElement) !void {
        var child_counts = std.StringHashMap(u32).init(self.allocator);
        defer child_counts.deinit();

        // First pass: count occurrences of each tag name
        for (children) |child| {
            const tag_name = child.tag_name;
            const count = child_counts.get(tag_name) orelse 0;
            try child_counts.put(tag_name, count + 1);
        }

        // Second pass: create properties
        var processed_tags = std.StringHashMap(u32).init(self.allocator);
        defer processed_tags.deinit();

        for (children) |child| {
            const tag_name = child.tag_name;
            const total_count = child_counts.get(tag_name).?;
            const current_count = processed_tags.get(tag_name) orelse 0;

            if (total_count == 1) {
                // Single occurrence - add as property
                const key_expr = try self.createStringExpr(tag_name);
                try properties.append(.{ .key = key_expr, .value = child.element });
            } else {
                // Multiple occurrences - create array
                if (current_count == 0) {
                    // First occurrence - create array
                    var child_array = std.ArrayList(Expr).init(self.allocator);
                    for (children) |other_child| {
                        const other_tag_name = other_child.tag_name;
                        if (std.mem.eql(u8, tag_name, other_tag_name)) {
                            try child_array.append(other_child.element);
                        }
                    }
                    const array_expr = Expr.init(E.Array, .{ .items = .fromList(child_array) }, .Empty);
                    const key_expr = try self.createStringExpr(tag_name);
                    try properties.append(.{ .key = key_expr, .value = array_expr });
                }
            }

            try processed_tags.put(tag_name, current_count + 1);
        }
    }

    fn decodeXmlEntities(self: *Parser, input: []const u8) ![]u8 {
        var result = std.ArrayList(u8).init(self.allocator);
        defer result.deinit();

        var i: usize = 0;
        while (i < input.len) {
            if (input[i] == '&') {
                // Find the ending ';'
                var end: usize = i + 1;
                while (end < input.len and input[end] != ';') {
                    end += 1;
                }

                if (end < input.len) {
                    const entity = input[i + 1 .. end];

                    // Decode common XML entities
                    if (std.mem.eql(u8, entity, "lt")) {
                        try result.append('<');
                    } else if (std.mem.eql(u8, entity, "gt")) {
                        try result.append('>');
                    } else if (std.mem.eql(u8, entity, "amp")) {
                        try result.append('&');
                    } else if (std.mem.eql(u8, entity, "quot")) {
                        try result.append('"');
                    } else if (std.mem.eql(u8, entity, "apos")) {
                        try result.append('\'');
                    } else if (entity.len > 1 and entity[0] == '#') {
                        // Numeric entity
                        const num_str = entity[1..];
                        if (num_str.len > 0) {
                            const codepoint = std.fmt.parseInt(u32, num_str, 10) catch {
                                // If parsing fails, keep the original entity
                                try result.appendSlice(input[i .. end + 1]);
                                i = end + 1;
                                continue;
                            };

                            // Convert Unicode codepoint to UTF-8
                            if (codepoint < 128) {
                                try result.append(@intCast(codepoint));
                            } else {
                                // For simplicity, just handle ASCII range for now
                                // A full implementation would need proper UTF-8 encoding
                                try result.appendSlice(input[i .. end + 1]);
                            }
                        } else {
                            try result.appendSlice(input[i .. end + 1]);
                        }
                    } else {
                        // Unknown entity, keep as-is
                        try result.appendSlice(input[i .. end + 1]);
                    }

                    i = end + 1;
                } else {
                    // No closing ';' found, keep the '&'
                    try result.append(input[i]);
                    i += 1;
                }
            } else {
                try result.append(input[i]);
                i += 1;
            }
        }

        return try result.toOwnedSlice();
    }

    fn skipComment(self: *Parser) void {
        // Skip "<!--"
        self.current += 4;

        // Find "-->"
        while (self.current + 2 < self.source.contents.len) {
            if (std.mem.startsWith(u8, self.source.contents[self.current..], "-->")) {
                self.current += 3; // Skip "-->"
                return;
            }
            self.advance();
        }

        // If we reach here, comment was not properly closed
        // But we'll just consume the rest to be lenient
    }

    fn isNameChar(self: *Parser, c: u8) bool {
        _ = self;
        return std.ascii.isAlphanumeric(c) or c == '_' or c == '-' or c == ':' or c == '.';
    }

    fn skipWhitespace(self: *Parser) void {
        while (self.current < self.source.contents.len) {
            const c = self.source.contents[self.current];
            if (c == ' ' or c == '\t' or c == '\n' or c == '\r') {
                if (c == '\n') {
                    self.line += 1;
                    self.column = 1;
                } else {
                    self.column += 1;
                }
                self.current += 1;
            } else {
                break;
            }
        }
    }

    fn advance(self: *Parser) void {
        if (self.current < self.source.contents.len) {
            if (self.source.contents[self.current] == '\n') {
                self.line += 1;
                self.column = 1;
            } else {
                self.column += 1;
            }
            self.current += 1;
        }
    }

    fn parseError(self: *Parser, msg: []const u8) error{XMLParseError} {
        self.log.addError(
            self.source,
            logger.Loc{ .start = @intCast(self.current) },
            msg,
        ) catch {};
        return error.XMLParseError;
    }
};

const std = @import("std");

const bun = @import("bun");
const logger = bun.logger;

const E = bun.ast.E;
const Expr = bun.ast.Expr;
const G = bun.ast.G;
