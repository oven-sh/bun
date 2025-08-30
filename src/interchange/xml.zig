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
        // Skip leading whitespace, XML declaration(s), DOCTYPE declaration(s), and top-level comments
        while (true) {
            self.skipWhitespace();

            // XML declaration
            if (self.current + 5 < self.source.contents.len and std.mem.startsWith(u8, self.source.contents[self.current..], "<?xml")) {
                var found = false;
                // Scan for the closing "?>"
                while (self.current + 1 < self.source.contents.len) {
                    if (std.mem.startsWith(u8, self.source.contents[self.current..], "?>")) {
                        self.advance(); // skip '?'
                        self.advance(); // skip '>'
                        found = true;
                        break;
                    }
                    self.advance();
                }
                if (!found) {
                    return self.parseError("Unterminated XML declaration");
                }
                continue;
            }

            // DOCTYPE declaration
            if (self.current + 9 < self.source.contents.len and std.mem.startsWith(u8, self.source.contents[self.current..], "<!DOCTYPE")) {
                try self.skipDoctypeDeclaration();
                continue;
            }

            // Top-level processing instructions (not XML declaration)
            if (self.current + 1 < self.source.contents.len and std.mem.startsWith(u8, self.source.contents[self.current..], "<?")) {
                self.skipProcessingInstruction();
                continue;
            }

            // Top-level comments
            if (self.current + 3 < self.source.contents.len and std.mem.startsWith(u8, self.source.contents[self.current..], "<!--")) {
                self.skipComment();
                continue;
            }

            break;
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

            // Create object with __name and optionally __attrs
            var properties = std.ArrayList(G.Property).init(self.allocator);

            // Always add __name
            const name_key = try self.createStringExpr("__name");
            const name_value = try self.createStringExpr(tag_name_slice);
            try properties.append(.{ .key = name_key, .value = name_value });

            // Add __attrs if present
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
            } else if (self.current + 1 < self.source.contents.len and
                std.mem.startsWith(u8, self.source.contents[self.current..], "<?"))
            {
                // Processing instruction found - skip it
                self.skipProcessingInstruction();
            } else if (self.current + 9 < self.source.contents.len and
                std.mem.startsWith(u8, self.source.contents[self.current..], "<![CDATA["))
            {
                // CDATA section
                self.current += 9; // move past "<![CDATA["
                const cdata_start = self.current;
                // scan until "]]>"
                while (self.current + 2 < self.source.contents.len and
                    !std.mem.startsWith(u8, self.source.contents[self.current..], "]]>"))
                {
                    self.advance();
                }
                if (self.current + 2 >= self.source.contents.len) {
                    return self.parseError("Unterminated CDATA section");
                }
                const cdata_text = self.source.contents[cdata_start..self.current];
                try text_parts.appendSlice(cdata_text);
                self.current += 3; // skip "]]>"
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

        // Build result - always return object with __name and other properties
        const trimmed_text = std.mem.trim(u8, text_parts.items, " \t\n\r");
        var properties = std.ArrayList(G.Property).init(self.allocator);

        // Always add __name
        const name_key = try self.createStringExpr("__name");
        const name_value = try self.createStringExpr(tag_name_slice);
        try properties.append(.{ .key = name_key, .value = name_value });

        // Add __attrs if present
        if (attributes.items.len > 0) {
            const attrs_obj = Expr.init(E.Object, .{ .properties = .fromList(attributes) }, .Empty);
            const attrs_key = try self.createStringExpr("__attrs");
            try properties.append(.{ .key = attrs_key, .value = attrs_obj });
        }

        // Add __children if present
        if (children.items.len > 0) {
            var child_array = std.ArrayList(Expr).init(self.allocator);
            for (children.items) |child| {
                try child_array.append(child.element);
            }
            const children_array = Expr.init(E.Array, .{ .items = .fromList(child_array) }, .Empty);
            const children_key = try self.createStringExpr("__children");
            try properties.append(.{ .key = children_key, .value = children_array });
        }

        // Add __text if present (preserve original text including whitespace)
        // But only if we don't have children, or if the text contains non-whitespace content
        if (text_parts.items.len > 0 and trimmed_text.len > 0 and children.items.len == 0) {
            const text_expr = try self.createStringExpr(text_parts.items);
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

        const key_expr = try self.createRawStringExpr(name_slice);
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

    fn createRawStringExpr(self: *Parser, slice: []const u8) !Expr {
        // Create string without entity decoding (for tag names and attribute names)
        return Expr.init(E.String, .{ .data = try self.allocator.dupe(u8, slice) }, .Empty);
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
                const key_expr = try self.createRawStringExpr(tag_name);
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
                    const key_expr = try self.createRawStringExpr(tag_name);
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
                const key_expr = try self.createRawStringExpr(tag_name);
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
                    const key_expr = try self.createRawStringExpr(tag_name);
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
                            var codepoint: u32 = 0;

                            if (num_str.len > 1 and (num_str[0] == 'x' or num_str[0] == 'X')) {
                                // Hexadecimal entity
                                codepoint = std.fmt.parseInt(u32, num_str[1..], 16) catch {
                                    // If parsing fails, keep the original entity
                                    try result.appendSlice(input[i .. end + 1]);
                                    i = end + 1;
                                    continue;
                                };
                            } else {
                                // Decimal entity
                                codepoint = std.fmt.parseInt(u32, num_str, 10) catch {
                                    // If parsing fails, keep the original entity
                                    try result.appendSlice(input[i .. end + 1]);
                                    i = end + 1;
                                    continue;
                                };
                            }

                            // Convert Unicode codepoint to UTF-8
                            if (codepoint < 0x80) {
                                // ASCII range
                                try result.append(@intCast(codepoint));
                            } else if (codepoint < 0x800) {
                                // 2-byte UTF-8
                                try result.append(@intCast(0xC0 | (codepoint >> 6)));
                                try result.append(@intCast(0x80 | (codepoint & 0x3F)));
                            } else if (codepoint < 0x10000) {
                                // 3-byte UTF-8
                                try result.append(@intCast(0xE0 | (codepoint >> 12)));
                                try result.append(@intCast(0x80 | ((codepoint >> 6) & 0x3F)));
                                try result.append(@intCast(0x80 | (codepoint & 0x3F)));
                            } else if (codepoint <= 0x10FFFF) {
                                // 4-byte UTF-8
                                try result.append(@intCast(0xF0 | (codepoint >> 18)));
                                try result.append(@intCast(0x80 | ((codepoint >> 12) & 0x3F)));
                                try result.append(@intCast(0x80 | ((codepoint >> 6) & 0x3F)));
                                try result.append(@intCast(0x80 | (codepoint & 0x3F)));
                            } else {
                                // Invalid codepoint, keep the original entity
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

    fn skipProcessingInstruction(self: *Parser) void {
        // Skip "<?"
        self.current += 2;

        // Find "?>"
        while (self.current + 1 < self.source.contents.len) {
            if (std.mem.startsWith(u8, self.source.contents[self.current..], "?>")) {
                self.current += 2; // Skip "?>"
                return;
            }
            self.advance();
        }

        // If we reach here, PI was not properly closed
        // But we'll just consume the rest to be lenient
    }

    fn skipDoctypeDeclaration(self: *Parser) !void {
        // Skip "<!DOCTYPE"
        self.current += 9;
        self.skipWhitespace();

        // Skip the document type name (root element name)
        while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
            self.advance();
        }
        self.skipWhitespace();

        // Check if we have an external DTD
        if (self.current < self.source.contents.len and
            (std.mem.startsWith(u8, self.source.contents[self.current..], "SYSTEM") or
                std.mem.startsWith(u8, self.source.contents[self.current..], "PUBLIC")))
        {
            // Skip external DTD reference
            try self.skipExternalDTD();
            self.skipWhitespace();
        }

        // Check for internal DTD subset
        if (self.current < self.source.contents.len and self.source.contents[self.current] == '[') {
            self.advance(); // consume '['
            try self.skipInternalDTD();

            // Expect closing ']'
            if (self.current >= self.source.contents.len or self.source.contents[self.current] != ']') {
                return self.parseError("Expected ']' to close internal DTD subset");
            }
            self.advance(); // consume ']'
        }

        self.skipWhitespace();

        // Expect closing '>'
        if (self.current >= self.source.contents.len or self.source.contents[self.current] != '>') {
            return self.parseError("Expected '>' to close DOCTYPE declaration");
        }
        self.advance(); // consume '>'
    }

    fn skipExternalDTD(self: *Parser) !void {
        // Skip "SYSTEM" or "PUBLIC"
        if (std.mem.startsWith(u8, self.source.contents[self.current..], "SYSTEM")) {
            self.current += 6;
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "PUBLIC")) {
            self.current += 6;
            self.skipWhitespace();
            // Skip public ID (quoted string)
            try self.skipQuotedString();
        }

        self.skipWhitespace();
        // Skip system ID (quoted string)
        try self.skipQuotedString();
    }

    fn skipQuotedString(self: *Parser) !void {
        if (self.current >= self.source.contents.len) {
            return self.parseError("Expected quoted string");
        }

        const quote = self.source.contents[self.current];
        if (quote != '"' and quote != '\'') {
            return self.parseError("Expected quote to start string literal");
        }
        self.advance(); // consume opening quote

        // Find closing quote
        while (self.current < self.source.contents.len and self.source.contents[self.current] != quote) {
            self.advance();
        }

        if (self.current >= self.source.contents.len) {
            return self.parseError("Unterminated string literal");
        }
        self.advance(); // consume closing quote
    }

    fn skipInternalDTD(self: *Parser) !void {
        var bracket_depth: u32 = 0;

        while (self.current < self.source.contents.len) {
            self.skipWhitespace();

            if (self.current >= self.source.contents.len) break;

            // Check for end of internal DTD
            if (bracket_depth == 0 and self.source.contents[self.current] == ']') {
                break;
            }

            // Handle nested brackets in parameter entity values
            if (self.source.contents[self.current] == '[') {
                bracket_depth += 1;
                self.advance();
                continue;
            } else if (self.source.contents[self.current] == ']') {
                if (bracket_depth > 0) {
                    bracket_depth -= 1;
                }
                self.advance();
                continue;
            }

            // Skip comments
            if (self.current + 3 < self.source.contents.len and
                std.mem.startsWith(u8, self.source.contents[self.current..], "<!--"))
            {
                self.skipComment();
                continue;
            }

            // Skip processing instructions
            if (self.current + 1 < self.source.contents.len and
                std.mem.startsWith(u8, self.source.contents[self.current..], "<?"))
            {
                self.skipProcessingInstruction();
                continue;
            }

            // Skip parameter entity references
            if (self.source.contents[self.current] == '%') {
                self.advance(); // consume '%'
                // Skip entity name
                while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
                    self.advance();
                }
                if (self.current < self.source.contents.len and self.source.contents[self.current] == ';') {
                    self.advance(); // consume ';'
                }
                continue;
            }

            // Skip declaration markup
            if (self.current + 1 < self.source.contents.len and
                std.mem.startsWith(u8, self.source.contents[self.current..], "<!"))
            {
                try self.skipDeclarationMarkup();
                continue;
            }

            // Unknown character, just advance
            self.advance();
        }
    }

    fn skipDeclarationMarkup(self: *Parser) !void {
        // Skip "<!"
        self.current += 2;

        // Determine the type of declaration
        if (std.mem.startsWith(u8, self.source.contents[self.current..], "ELEMENT")) {
            try self.skipElementDecl();
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "ATTLIST")) {
            try self.skipAttlistDecl();
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "ENTITY")) {
            try self.skipEntityDecl();
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "NOTATION")) {
            try self.skipNotationDecl();
        } else {
            // Unknown declaration, skip until '>' while handling quoted strings
            var depth: u32 = 0;
            while (self.current < self.source.contents.len) {
                const c = self.source.contents[self.current];

                if (c == '"' or c == '\'') {
                    try self.skipQuotedString();
                } else if (c == '<') {
                    depth += 1;
                    self.advance();
                } else if (c == '>') {
                    if (depth == 0) {
                        self.advance(); // consume the closing '>'
                        break;
                    } else {
                        depth -= 1;
                        self.advance();
                    }
                } else {
                    self.advance();
                }
            }
        }
    }

    fn skipElementDecl(self: *Parser) !void {
        // Skip "ELEMENT"
        self.current += 7;
        self.skipWhitespace();

        // Skip element name
        while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
            self.advance();
        }
        self.skipWhitespace();

        // Skip content model
        try self.skipContentModel();

        self.skipWhitespace();
        if (self.current < self.source.contents.len and self.source.contents[self.current] == '>') {
            self.advance();
        }
    }

    fn skipAttlistDecl(self: *Parser) !void {
        // Skip "ATTLIST"
        self.current += 7;
        self.skipWhitespace();

        // Skip element name
        while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
            self.advance();
        }

        // Skip attribute definitions
        while (self.current < self.source.contents.len and self.source.contents[self.current] != '>') {
            self.skipWhitespace();

            if (self.current < self.source.contents.len and self.source.contents[self.current] == '>') {
                break;
            }

            // Skip attribute name
            while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
                self.advance();
            }
            self.skipWhitespace();

            // Skip attribute type
            try self.skipAttributeType();
            self.skipWhitespace();

            // Skip default declaration
            try self.skipDefaultDecl();
        }

        if (self.current < self.source.contents.len and self.source.contents[self.current] == '>') {
            self.advance();
        }
    }

    fn skipEntityDecl(self: *Parser) !void {
        // Skip "ENTITY"
        self.current += 6;
        self.skipWhitespace();

        // Check for parameter entity
        if (self.current < self.source.contents.len and self.source.contents[self.current] == '%') {
            self.advance();
            self.skipWhitespace();
        }

        // Skip entity name
        while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
            self.advance();
        }
        self.skipWhitespace();

        // Skip entity definition
        if (self.current < self.source.contents.len and
            (self.source.contents[self.current] == '"' or self.source.contents[self.current] == '\''))
        {
            // Internal entity - skip quoted string
            try self.skipQuotedString();
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "SYSTEM") or
            std.mem.startsWith(u8, self.source.contents[self.current..], "PUBLIC"))
        {
            // External entity
            try self.skipExternalDTD();
            self.skipWhitespace();

            // Check for NDATA declaration
            if (std.mem.startsWith(u8, self.source.contents[self.current..], "NDATA")) {
                self.current += 5;
                self.skipWhitespace();
                // Skip notation name
                while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
                    self.advance();
                }
            }
        }

        self.skipWhitespace();
        if (self.current < self.source.contents.len and self.source.contents[self.current] == '>') {
            self.advance();
        }
    }

    fn skipNotationDecl(self: *Parser) !void {
        // Skip "NOTATION"
        self.current += 8;
        self.skipWhitespace();

        // Skip notation name
        while (self.current < self.source.contents.len and self.isNameChar(self.source.contents[self.current])) {
            self.advance();
        }
        self.skipWhitespace();

        // Skip external or public ID
        if (std.mem.startsWith(u8, self.source.contents[self.current..], "SYSTEM")) {
            self.current += 6;
            self.skipWhitespace();
            try self.skipQuotedString();
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "PUBLIC")) {
            self.current += 6;
            self.skipWhitespace();
            try self.skipQuotedString();
            self.skipWhitespace();
            // Optional system literal
            if (self.current < self.source.contents.len and
                (self.source.contents[self.current] == '"' or self.source.contents[self.current] == '\''))
            {
                try self.skipQuotedString();
            }
        }

        self.skipWhitespace();
        if (self.current < self.source.contents.len and self.source.contents[self.current] == '>') {
            self.advance();
        }
    }

    fn skipContentModel(self: *Parser) !void {
        // Skip content models: EMPTY, ANY, or mixed/element content
        if (std.mem.startsWith(u8, self.source.contents[self.current..], "EMPTY")) {
            self.current += 5;
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "ANY")) {
            self.current += 3;
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "(#PCDATA")) {
            // Mixed content model
            self.advance(); // consume '('
            try self.skipUntilBalanced(')', 0);
        } else if (self.current < self.source.contents.len and self.source.contents[self.current] == '(') {
            // Element content model
            try self.skipUntilBalanced(')', 0);
            // Skip occurrence indicator
            if (self.current < self.source.contents.len and
                (self.source.contents[self.current] == '?' or
                    self.source.contents[self.current] == '*' or
                    self.source.contents[self.current] == '+'))
            {
                self.advance();
            }
        }
    }

    fn skipAttributeType(self: *Parser) !void {
        if (std.mem.startsWith(u8, self.source.contents[self.current..], "CDATA")) {
            self.current += 5;
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "ID")) {
            if (std.mem.startsWith(u8, self.source.contents[self.current..], "IDREFS")) {
                self.current += 6;
            } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "IDREF")) {
                self.current += 5;
            } else {
                self.current += 2;
            }
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "ENTIT")) {
            if (std.mem.startsWith(u8, self.source.contents[self.current..], "ENTITIES")) {
                self.current += 8;
            } else {
                self.current += 6; // ENTITY
            }
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "NMTOKENS")) {
            self.current += 8;
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "NMTOKEN")) {
            self.current += 7;
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "NOTATION")) {
            self.current += 8;
            self.skipWhitespace();
            if (self.current < self.source.contents.len and self.source.contents[self.current] == '(') {
                try self.skipUntilBalanced(')', 0);
            }
        } else if (self.current < self.source.contents.len and self.source.contents[self.current] == '(') {
            // Enumerated type
            try self.skipUntilBalanced(')', 0);
        } else {
            // Unknown type, skip until whitespace
            while (self.current < self.source.contents.len and
                !std.ascii.isWhitespace(self.source.contents[self.current]) and
                self.source.contents[self.current] != '>' and
                self.source.contents[self.current] != '#' and
                self.source.contents[self.current] != '"' and
                self.source.contents[self.current] != '\'')
            {
                self.advance();
            }
        }
    }

    fn skipDefaultDecl(self: *Parser) !void {
        if (std.mem.startsWith(u8, self.source.contents[self.current..], "#REQUIRED")) {
            self.current += 9;
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "#IMPLIED")) {
            self.current += 8;
        } else if (std.mem.startsWith(u8, self.source.contents[self.current..], "#FIXED")) {
            self.current += 6;
            self.skipWhitespace();
            try self.skipQuotedString();
        } else if (self.current < self.source.contents.len and
            (self.source.contents[self.current] == '"' or self.source.contents[self.current] == '\''))
        {
            // Default value
            try self.skipQuotedString();
        }
    }

    fn skipUntilBalanced(self: *Parser, close_char: u8, depth: u32) !void {
        var current_depth = depth;
        const open_char: u8 = switch (close_char) {
            ')' => '(',
            ']' => '[',
            '}' => '{',
            '>' => '<',
            else => return self.parseError("Invalid close character for balanced parsing"),
        };

        if (self.current < self.source.contents.len and self.source.contents[self.current] == open_char) {
            self.advance();
            current_depth += 1;
        }

        while (self.current < self.source.contents.len and current_depth > 0) {
            const c = self.source.contents[self.current];

            if (c == '"' or c == '\'') {
                try self.skipQuotedString();
            } else if (c == open_char) {
                current_depth += 1;
                self.advance();
            } else if (c == close_char) {
                current_depth -= 1;
                self.advance();
            } else {
                self.advance();
            }
        }
    }

    fn isNameChar(self: *Parser, c: u8) bool {
        _ = self;
        // Basic ASCII alphanumeric and common XML name characters
        if (std.ascii.isAlphanumeric(c) or c == '_' or c == '-' or c == ':' or c == '.') {
            return true;
        }

        // Allow high-bit characters for Unicode support
        // This is a simplified approach - a full XML implementation would need
        // proper Unicode character classification
        return c >= 0x80;
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
