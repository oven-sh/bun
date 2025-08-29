const std = @import("std");
const bun = @import("bun");
const logger = bun.logger;
const Expr = bun.ast.Expr;
const E = bun.ast.E;
const G = bun.ast.G;

pub const XML = struct {
    const ParseError = error{ OutOfMemory, SyntaxError, StackOverflow };

    pub fn parse(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) ParseError!Expr {
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
        // Check if we have any content at all
        if (self.source.contents.len == 0) {
            return self.parseError("Empty XML document");
        }
        
        // Skip any leading whitespace
        self.skipWhitespace();
        
        // Skip XML declaration if present
        if (self.match("<?xml")) {
            self.skipUntil("?>");
            if (self.match("?>")) {
                self.advance();
                self.advance();
            }
            self.skipWhitespace();
        }
        
        // Make sure we still have content after processing
        if (self.current >= self.source.contents.len) {
            return self.parseError("No root element found");
        }
        
        // Parse root element
        return self.parseElement();
    }

    fn parseElement(self: *Parser) !Expr {
        if (!self.match('<')) {
            return self.parseError("Expected '<' to start element");
        }
        self.advance(); // consume '<'

        // Get tag name
        const tag_start = self.current;
        while (self.current < self.source.contents.len and 
               isNameChar(self.source.contents[self.current])) {
            self.advance();
        }
        
        if (self.current == tag_start) {
            return self.parseError("Expected element name");
        }

        const tag_name_slice = self.source.contents[tag_start..self.current];
        self.skipWhitespace();

        // Parse attributes into an object
        var attrs_properties = std.ArrayList(G.Property).init(self.allocator);
        
        while (self.current < self.source.contents.len and 
               self.source.contents[self.current] != '>' and
               self.source.contents[self.current] != '/') {
            const attr = try self.parseAttribute();
            try attrs_properties.append(attr);
            self.skipWhitespace();
        }

        // Check for self-closing tag
        if (self.match("/>")) {
            self.advance();
            self.advance();
            
            // Create object with just attributes if any, or empty object
            var all_properties = std.ArrayList(G.Property).init(self.allocator);
            
            // Add attributes under __attrs if there are any
            if (attrs_properties.items.len > 0) {
                const attrs_obj = Expr.init(E.Object, .{ .properties = .fromList(attrs_properties) }, .Empty);
                const attrs_key = try self.createStringExpr("__attrs");
                try all_properties.append(.{ .key = attrs_key, .value = attrs_obj });
            }
            
            return Expr.init(E.Object, .{ .properties = .fromList(all_properties) }, .Empty);
        }

        if (!self.match('>')) {
            return self.parseError("Expected '>' to close opening tag");
        }
        self.advance(); // consume '>'

        // Parse content and children
        var children = std.ArrayList(Expr).init(self.allocator);
        var text_parts = std.ArrayList(u8).init(self.allocator);
        defer text_parts.deinit();

        while (self.current < self.source.contents.len) {
            if (self.match("</")) {
                // End tag
                break;
            } else if (self.match('<')) {
                // Child element
                const child = try self.parseElement();
                try children.append(child);
            } else {
                // Text content
                const text_start = self.current;
                while (self.current < self.source.contents.len and
                       self.source.contents[self.current] != '<') {
                    self.advance();
                }
                
                if (self.current > text_start) {
                    const text = self.source.contents[text_start..self.current];
                    try text_parts.appendSlice(text);
                }
            }
        }

        // Parse closing tag
        if (!self.match("</")) {
            return self.parseError("Expected closing tag");
        }
        self.advance();
        self.advance();

        // Verify closing tag name matches opening tag
        const closing_start = self.current;
        while (self.current < self.source.contents.len and
               isNameChar(self.source.contents[self.current])) {
            self.advance();
        }

        const closing_name = self.source.contents[closing_start..self.current];
        if (!std.mem.eql(u8, tag_name_slice, closing_name)) {
            return self.parseError("Mismatched closing tag");
        }

        self.skipWhitespace();
        if (!self.match('>')) {
            return self.parseError("Expected '>' to close closing tag");
        }
        self.advance();

        // Build the result object
        var all_properties = std.ArrayList(G.Property).init(self.allocator);
        
        // Add attributes under __attrs if there are any
        if (attrs_properties.items.len > 0) {
            const attrs_obj = Expr.init(E.Object, .{ .properties = .fromList(attrs_properties) }, .Empty);
            const attrs_key = try self.createStringExpr("__attrs");
            try all_properties.append(.{ .key = attrs_key, .value = attrs_obj });
        }

        // Handle text content and children
        if (children.items.len == 0) {
            // No children - check for text content
            if (text_parts.items.len > 0) {
                const trimmed = std.mem.trim(u8, text_parts.items, " \t\n\r");
                if (trimmed.len > 0) {
                    // Just text content - return as string if no attributes, otherwise add as __text
                    if (attrs_properties.items.len == 0) {
                        return try self.createStringExpr(trimmed);
                    } else {
                        const text_expr = try self.createStringExpr(trimmed);
                        const text_key = try self.createStringExpr("__text");
                        try all_properties.append(.{ .key = text_key, .value = text_expr });
                    }
                }
            }
        } else {
            // Has children - group them by tag name
            var child_groups = std.HashMap([]const u8, std.ArrayList(Expr), std.hash_map.StringContext, std.hash_map.default_max_load_percentage).init(self.allocator);
            defer {
                var iterator = child_groups.iterator();
                while (iterator.next()) |entry| {
                    entry.value_ptr.deinit();
                }
                child_groups.deinit();
            }

            // Group children (this is simplified - in reality we'd need to extract tag names from child objects)
            // For now, just add all children as an array under "children"
            if (children.items.len > 0) {
                const children_array = Expr.init(E.Array, .{ .items = .fromList(children) }, .Empty);
                const children_key = try self.createStringExpr("children");
                try all_properties.append(.{ .key = children_key, .value = children_array });
            }

            // Add text content if present alongside children
            if (text_parts.items.len > 0) {
                const trimmed = std.mem.trim(u8, text_parts.items, " \t\n\r");
                if (trimmed.len > 0) {
                    const text_expr = try self.createStringExpr(trimmed);
                    const text_key = try self.createStringExpr("__text");
                    try all_properties.append(.{ .key = text_key, .value = text_expr });
                }
            }
        }

        return Expr.init(E.Object, .{ .properties = .fromList(all_properties) }, .Empty);
    }

    fn parseAttribute(self: *Parser) !G.Property {
        const name_start = self.current;
        while (self.current < self.source.contents.len and
               isNameChar(self.source.contents[self.current])) {
            self.advance();
        }

        if (self.current == name_start) {
            return self.parseError("Expected attribute name");
        }

        const name_slice = self.source.contents[name_start..self.current];
        
        self.skipWhitespace();
        if (!self.match('=')) {
            return self.parseError("Expected '=' after attribute name");
        }
        self.advance();

        self.skipWhitespace();
        
        const quote = self.source.contents[self.current];
        if (quote != '"' and quote != '\'') {
            return self.parseError("Expected quote to start attribute value");
        }
        self.advance();

        const value_start = self.current;
        while (self.current < self.source.contents.len and
               self.source.contents[self.current] != quote) {
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
        const string_data = try self.allocator.dupe(u8, slice);
        return Expr.init(E.String, .{ .data = string_data }, .Empty);
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

    fn skipUntil(self: *Parser, target: []const u8) void {
        while (self.current + target.len <= self.source.contents.len) {
            if (std.mem.startsWith(u8, self.source.contents[self.current..], target)) {
                return;
            }
            self.advance();
        }
    }

    fn match(self: *Parser, expected: anytype) bool {
        const T = @TypeOf(expected);
        if (T == u8) {
            return self.current < self.source.contents.len and 
                   self.source.contents[self.current] == expected;
        } else if (T == []const u8) {
            return self.current + expected.len <= self.source.contents.len and
                   std.mem.startsWith(u8, self.source.contents[self.current..], expected);
        }
        return false;
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

fn isNameChar(c: u8) bool {
    return std.ascii.isAlphanumeric(c) or c == '_' or c == '-' or c == ':' or c == '.';
}