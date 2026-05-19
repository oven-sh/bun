/// XML Parser
///
/// Parses XML text into the same Expr AST used by the JSON, TOML, and YAML
/// parsers so that `.xml` files can be imported directly, bundled, and used
/// from `Bun.XML.parse`.
///
/// The XML → JS mapping follows the same shape popularized by
/// `fast-xml-parser`:
///
///   <root version="1.0">           {
///     <item id="1">hello</item>      "root": {
///     <item id="2">world</item>        "@version": "1.0",
///     <empty/>                         "item": [
///   </root>                              { "@id": "1", "#text": "hello" },
///                                        { "@id": "2", "#text": "world" }
///                                      ],
///                                      "empty": ""
///                                    }
///                                  }
///
/// - Attributes are prefixed with `@`.
/// - Mixed content text is stored under `#text`.
/// - Repeated sibling elements with the same name become arrays.
/// - An element with no attributes and only text becomes the text string.
/// - An element with no attributes and no children becomes the empty string.
///
/// Reference: https://www.w3.org/TR/xml/
pub const XML = struct {
    source: []const u8,
    pos: usize,
    allocator: std.mem.Allocator,
    stack_check: bun.StackCheck,

    const ParseError = OOM || error{
        UnexpectedEof,
        UnexpectedCharacter,
        InvalidTagName,
        InvalidAttributeName,
        InvalidAttributeValue,
        MismatchedClosingTag,
        UnexpectedClosingTag,
        UnterminatedComment,
        UnterminatedCData,
        UnterminatedProcessingInstruction,
        UnterminatedDoctype,
        InvalidEntityReference,
        MultipleRootElements,
        MissingRootElement,
        TrailingData,
        StackOverflow,
    };

    pub const Error = union(enum) {
        oom,
        stack_overflow,
        unexpected_eof: struct { pos: usize },
        unexpected_character: struct { pos: usize },
        invalid_tag_name: struct { pos: usize },
        invalid_attribute_name: struct { pos: usize },
        invalid_attribute_value: struct { pos: usize },
        mismatched_closing_tag: struct { pos: usize },
        unexpected_closing_tag: struct { pos: usize },
        unterminated_comment: struct { pos: usize },
        unterminated_cdata: struct { pos: usize },
        unterminated_processing_instruction: struct { pos: usize },
        unterminated_doctype: struct { pos: usize },
        invalid_entity_reference: struct { pos: usize },
        multiple_root_elements: struct { pos: usize },
        missing_root_element: struct { pos: usize },
        trailing_data: struct { pos: usize },

        pub fn addToLog(this: *const Error, source: *const logger.Source, log: *logger.Log) (OOM || error{StackOverflow})!void {
            const err_loc: logger.Loc = switch (this.*) {
                .oom => return error.OutOfMemory,
                .stack_overflow => return error.StackOverflow,
                inline else => |e| .{ .start = @intCast(e.pos) },
            };
            const msg: []const u8 = switch (this.*) {
                .oom, .stack_overflow => unreachable,
                .unexpected_eof => "Unexpected end of input",
                .unexpected_character => "Unexpected character",
                .invalid_tag_name => "Invalid tag name",
                .invalid_attribute_name => "Invalid attribute name",
                .invalid_attribute_value => "Invalid attribute value",
                .mismatched_closing_tag => "Closing tag does not match opening tag",
                .unexpected_closing_tag => "Unexpected closing tag",
                .unterminated_comment => "Unterminated comment",
                .unterminated_cdata => "Unterminated CDATA section",
                .unterminated_processing_instruction => "Unterminated processing instruction",
                .unterminated_doctype => "Unterminated DOCTYPE declaration",
                .invalid_entity_reference => "Invalid entity reference",
                .multiple_root_elements => "XML document must have exactly one root element",
                .missing_root_element => "XML document must have a root element",
                .trailing_data => "Unexpected content after root element",
            };
            try log.addError(source, err_loc, msg);
        }
    };

    fn toError(err: ParseError, p: *const XML) Error {
        const pos = @min(p.pos, p.source.len -| 1);
        return switch (err) {
            error.OutOfMemory => .oom,
            error.StackOverflow => .stack_overflow,
            error.UnexpectedEof => .{ .unexpected_eof = .{ .pos = pos } },
            error.UnexpectedCharacter => .{ .unexpected_character = .{ .pos = pos } },
            error.InvalidTagName => .{ .invalid_tag_name = .{ .pos = pos } },
            error.InvalidAttributeName => .{ .invalid_attribute_name = .{ .pos = pos } },
            error.InvalidAttributeValue => .{ .invalid_attribute_value = .{ .pos = pos } },
            error.MismatchedClosingTag => .{ .mismatched_closing_tag = .{ .pos = pos } },
            error.UnexpectedClosingTag => .{ .unexpected_closing_tag = .{ .pos = pos } },
            error.UnterminatedComment => .{ .unterminated_comment = .{ .pos = pos } },
            error.UnterminatedCData => .{ .unterminated_cdata = .{ .pos = pos } },
            error.UnterminatedProcessingInstruction => .{ .unterminated_processing_instruction = .{ .pos = pos } },
            error.UnterminatedDoctype => .{ .unterminated_doctype = .{ .pos = pos } },
            error.InvalidEntityReference => .{ .invalid_entity_reference = .{ .pos = pos } },
            error.MultipleRootElements => .{ .multiple_root_elements = .{ .pos = pos } },
            error.MissingRootElement => .{ .missing_root_element = .{ .pos = pos } },
            error.TrailingData => .{ .trailing_data = .{ .pos = pos } },
        };
    }

    const ExternalError = OOM || error{ SyntaxError, StackOverflow };

    pub fn parse(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) ExternalError!Expr {
        bun.analytics.Features.xml_parse += 1;

        if (source.contents.len == 0) {
            // Match TOML/JSON behaviour: empty input → empty object.
            return Expr.init(E.Object, E.Object{}, logger.Loc.Empty);
        }

        var parser: XML = .{
            .source = source.contents,
            .pos = 0,
            .allocator = allocator,
            .stack_check = .init(),
        };

        const result = parser.parseDocument() catch |err| {
            const e = toError(err, &parser);
            try e.addToLog(source, log);
            return error.SyntaxError;
        };

        return result;
    }

    // ── Scanner helpers ──

    inline fn peek(self: *const XML) u8 {
        if (self.pos < self.source.len) return self.source[self.pos];
        return 0;
    }

    inline fn peekAt(self: *const XML, offset: usize) u8 {
        const i = self.pos + offset;
        if (i < self.source.len) return self.source[i];
        return 0;
    }

    inline fn remaining(self: *const XML) []const u8 {
        return self.source[self.pos..];
    }

    inline fn loc(self: *const XML) logger.Loc {
        return .{ .start = @intCast(@min(self.pos, std.math.maxInt(i32))) };
    }

    fn isWhitespace(c: u8) bool {
        return switch (c) {
            ' ', '\t', '\r', '\n' => true,
            else => false,
        };
    }

    fn skipWhitespace(self: *XML) void {
        while (self.pos < self.source.len and isWhitespace(self.source[self.pos])) {
            self.pos += 1;
        }
    }

    fn hasPrefix(self: *const XML, comptime prefix: []const u8) bool {
        return strings.hasPrefixComptime(self.remaining(), prefix);
    }

    /// NameStartChar per the XML 1.0 spec (ASCII fast-path; multi-byte UTF-8
    /// accepted conservatively since validating the full Unicode table here
    /// would be overkill for a data-interchange loader).
    fn isNameStart(c: u8) bool {
        return switch (c) {
            'A'...'Z', 'a'...'z', '_', ':' => true,
            else => c >= 0x80,
        };
    }

    fn isNameChar(c: u8) bool {
        return switch (c) {
            'A'...'Z', 'a'...'z', '0'...'9', '_', ':', '-', '.' => true,
            else => c >= 0x80,
        };
    }

    fn scanName(self: *XML) ParseError![]const u8 {
        const start = self.pos;
        if (self.pos >= self.source.len) return error.UnexpectedEof;
        if (!isNameStart(self.source[self.pos])) return error.InvalidTagName;
        self.pos += 1;
        while (self.pos < self.source.len and isNameChar(self.source[self.pos])) {
            self.pos += 1;
        }
        return self.source[start..self.pos];
    }

    // ── Document ──

    fn parseDocument(self: *XML) ParseError!Expr {
        // Skip UTF-8 BOM.
        if (self.hasPrefix("\xEF\xBB\xBF")) {
            self.pos += 3;
        }

        try self.skipProlog();

        self.skipWhitespace();
        if (self.pos >= self.source.len) {
            return error.MissingRootElement;
        }
        if (self.peek() != '<') {
            return error.UnexpectedCharacter;
        }
        if (self.peekAt(1) == '/') {
            return error.UnexpectedClosingTag;
        }

        const root_loc = self.loc();
        const name, const value = try self.parseElement();

        // Misc* after the root element.
        try self.skipMiscTrailing();
        if (self.pos < self.source.len) {
            return error.TrailingData;
        }

        var properties = std.array_list.Managed(G.Property).init(self.allocator);
        try properties.append(.{
            .key = Expr.init(E.String, E.String.init(name), root_loc),
            .value = value,
        });

        return Expr.init(E.Object, .{
            .properties = .moveFromList(&properties),
        }, root_loc);
    }

    /// Skip the XML prolog: `<?xml ... ?>`, comments, PIs, whitespace, and an
    /// optional DOCTYPE. Stops at the first element start tag.
    fn skipProlog(self: *XML) ParseError!void {
        while (true) {
            self.skipWhitespace();
            if (self.pos >= self.source.len) return;
            if (self.peek() != '<') return;

            if (self.hasPrefix("<!--")) {
                try self.skipComment();
                continue;
            }
            if (self.hasPrefix("<?")) {
                try self.skipProcessingInstruction();
                continue;
            }
            if (self.hasPrefix("<!DOCTYPE") or self.hasPrefix("<!doctype")) {
                try self.skipDoctype();
                continue;
            }
            // Either an element start tag or a closing tag — hand back to caller.
            return;
        }
    }

    /// After the root element only comments, PIs, and whitespace are allowed.
    fn skipMiscTrailing(self: *XML) ParseError!void {
        while (true) {
            self.skipWhitespace();
            if (self.pos >= self.source.len) return;
            if (self.hasPrefix("<!--")) {
                try self.skipComment();
                continue;
            }
            if (self.hasPrefix("<?")) {
                try self.skipProcessingInstruction();
                continue;
            }
            if (self.peek() == '<' and isNameStart(self.peekAt(1))) {
                return error.MultipleRootElements;
            }
            return;
        }
    }

    fn skipComment(self: *XML) ParseError!void {
        // Caller guarantees we're at "<!--".
        self.pos += 4;
        while (self.pos + 2 < self.source.len) {
            if (self.source[self.pos] == '-' and
                self.source[self.pos + 1] == '-' and
                self.source[self.pos + 2] == '>')
            {
                self.pos += 3;
                return;
            }
            self.pos += 1;
        }
        self.pos = self.source.len;
        return error.UnterminatedComment;
    }

    fn skipProcessingInstruction(self: *XML) ParseError!void {
        // Caller guarantees we're at "<?".
        self.pos += 2;
        while (self.pos + 1 < self.source.len) {
            if (self.source[self.pos] == '?' and self.source[self.pos + 1] == '>') {
                self.pos += 2;
                return;
            }
            self.pos += 1;
        }
        self.pos = self.source.len;
        return error.UnterminatedProcessingInstruction;
    }

    fn skipDoctype(self: *XML) ParseError!void {
        // Caller guarantees we're at "<!DOCTYPE" or "<!doctype".
        self.pos += "<!DOCTYPE".len;
        var depth: usize = 1;
        var quote: u8 = 0;
        while (self.pos < self.source.len) {
            // Comments and PIs inside the internal subset may contain
            // unbalanced '<' / '>' — skip them atomically so they can't
            // confuse the depth counter.
            if (quote == 0) {
                if (self.hasPrefix("<!--")) {
                    self.skipComment() catch return error.UnterminatedDoctype;
                    continue;
                }
                if (self.hasPrefix("<?")) {
                    self.skipProcessingInstruction() catch return error.UnterminatedDoctype;
                    continue;
                }
            }
            const c = self.source[self.pos];
            self.pos += 1;
            if (quote != 0) {
                if (c == quote) quote = 0;
                continue;
            }
            switch (c) {
                '"', '\'' => quote = c,
                '<' => depth += 1,
                '>' => {
                    depth -= 1;
                    if (depth == 0) return;
                },
                else => {},
            }
        }
        return error.UnterminatedDoctype;
    }

    // ── Elements ──

    const Child = struct {
        name: []const u8,
        value: Expr,
    };

    /// Parse an element starting at '<'. Returns the (allocated) element name
    /// and its converted Expr value.
    fn parseElement(self: *XML) ParseError!struct { []const u8, Expr } {
        if (!self.stack_check.isSafeToRecurse()) {
            return error.StackOverflow;
        }

        const start_loc = self.loc();
        // Caller guarantees we're at '<' and the next char starts a name.
        self.pos += 1;

        const raw_name = try self.scanName();
        const tag_name = try self.allocator.dupe(u8, raw_name);

        var attrs = std.array_list.Managed(G.Property).init(self.allocator);
        var self_closing = false;

        // Attributes.
        while (true) {
            self.skipWhitespace();
            if (self.pos >= self.source.len) return error.UnexpectedEof;
            const c = self.source[self.pos];
            if (c == '>') {
                self.pos += 1;
                break;
            }
            if (c == '/') {
                if (self.peekAt(1) != '>') {
                    return error.UnexpectedCharacter;
                }
                self.pos += 2;
                self_closing = true;
                break;
            }
            if (!isNameStart(c)) {
                return error.InvalidAttributeName;
            }

            const attr_loc = self.loc();
            const attr_name_raw = try self.scanName();
            self.skipWhitespace();
            if (self.peek() != '=') {
                return error.InvalidAttributeValue;
            }
            self.pos += 1;
            self.skipWhitespace();
            const attr_value = try self.scanAttributeValue(attr_loc);

            const key = try std.fmt.allocPrint(self.allocator, "@{s}", .{attr_name_raw});
            try attrs.append(.{
                .key = Expr.init(E.String, E.String.init(key), attr_loc),
                .value = attr_value,
            });
        }

        if (self_closing) {
            if (attrs.items.len == 0) {
                return .{ tag_name, Expr.init(E.String, E.String.empty, start_loc) };
            }
            return .{ tag_name, Expr.init(E.Object, .{
                .properties = .moveFromList(&attrs),
            }, start_loc) };
        }

        // Content.
        var text = std.array_list.Managed(u8).init(self.allocator);
        var children = std.array_list.Managed(Child).init(self.allocator);
        var has_text = false;
        var only_whitespace_text = true;

        while (true) {
            if (self.pos >= self.source.len) return error.UnexpectedEof;
            const c = self.source[self.pos];

            if (c == '<') {
                if (self.peekAt(1) == '/') {
                    // Closing tag.
                    self.pos += 2;
                    const close_name = try self.scanName();
                    if (!strings.eqlLong(close_name, tag_name, true)) {
                        return error.MismatchedClosingTag;
                    }
                    self.skipWhitespace();
                    if (self.peek() != '>') {
                        if (self.pos >= self.source.len) return error.UnexpectedEof;
                        return error.UnexpectedCharacter;
                    }
                    self.pos += 1;
                    break;
                }
                if (self.hasPrefix("<!--")) {
                    try self.skipComment();
                    continue;
                }
                if (self.hasPrefix("<![CDATA[")) {
                    try self.scanCData(&text);
                    has_text = true;
                    only_whitespace_text = false;
                    continue;
                }
                if (self.hasPrefix("<?")) {
                    try self.skipProcessingInstruction();
                    continue;
                }
                if (self.peekAt(1) == '!') {
                    // Any other <! construct inside content is not supported.
                    return error.UnexpectedCharacter;
                }
                if (!isNameStart(self.peekAt(1))) {
                    return error.InvalidTagName;
                }

                const child_name, const child_value = try self.parseElement();
                try children.append(.{ .name = child_name, .value = child_value });
                continue;
            }

            if (c == '&') {
                const before = text.items.len;
                try self.scanEntity(&text);
                has_text = true;
                // A character reference like `&#32;` may expand to
                // whitespace — don't count that as significant text.
                for (text.items[before..]) |b| {
                    if (!isWhitespace(b)) {
                        only_whitespace_text = false;
                        break;
                    }
                }
                continue;
            }

            // Character data.
            if (!isWhitespace(c)) only_whitespace_text = false;
            has_text = true;
            try text.append(c);
            self.pos += 1;
        }

        // Decide on representation.
        const significant_text = has_text and !only_whitespace_text;
        const has_children = children.items.len > 0;
        const has_attrs = attrs.items.len > 0;

        if (!has_attrs and !has_children) {
            // Text-only or empty element → plain string.
            if (has_text) {
                if (significant_text) {
                    const trimmed = try self.trimAndCollapse(text.items);
                    return .{ tag_name, Expr.init(E.String, E.String.init(trimmed), start_loc) };
                }
                // Whitespace-only content.
                return .{ tag_name, Expr.init(E.String, E.String.empty, start_loc) };
            }
            return .{ tag_name, Expr.init(E.String, E.String.empty, start_loc) };
        }

        // Build the object: attributes first, then children grouped by name,
        // then #text if present.
        var properties = attrs;

        if (has_children) {
            try self.groupChildren(&properties, children.items, start_loc);
        }

        if (significant_text) {
            const trimmed = try self.trimAndCollapse(text.items);
            if (trimmed.len > 0) {
                try properties.append(.{
                    .key = Expr.init(E.String, E.String.init(try self.allocator.dupe(u8, "#text")), start_loc),
                    .value = Expr.init(E.String, E.String.init(trimmed), start_loc),
                });
            }
        }

        return .{ tag_name, Expr.init(E.Object, .{
            .properties = .moveFromList(&properties),
        }, start_loc) };
    }

    const NameSlot = struct {
        count: u32,
        /// Index into `properties` once emitted, else maxInt.
        prop_index: u32,
        list: std.array_list.Managed(Expr),
    };

    /// Group children by tag name, preserving first-appearance order of the
    /// distinct names. Repeated names become arrays. Runs in O(N).
    fn groupChildren(
        self: *XML,
        properties: *std.array_list.Managed(G.Property),
        children: []const Child,
        start_loc: logger.Loc,
    ) ParseError!void {
        var slots = bun.StringHashMap(NameSlot).init(self.allocator);
        try slots.ensureTotalCapacity(@intCast(children.len));

        // Pass 1: count occurrences of each name.
        for (children) |child| {
            const entry = try slots.getOrPut(child.name);
            if (entry.found_existing) {
                entry.value_ptr.count += 1;
            } else {
                entry.value_ptr.* = .{
                    .count = 1,
                    .prop_index = std.math.maxInt(u32),
                    .list = undefined,
                };
            }
        }

        try properties.ensureUnusedCapacity(slots.count());

        // Pass 2: emit in child order, grouping duplicates into arrays.
        for (children) |child| {
            const slot = slots.getPtr(child.name).?;
            if (slot.count == 1) {
                properties.appendAssumeCapacity(.{
                    .key = Expr.init(E.String, E.String.init(child.name), start_loc),
                    .value = child.value,
                });
                continue;
            }
            if (slot.prop_index == std.math.maxInt(u32)) {
                slot.list = try std.array_list.Managed(Expr).initCapacity(self.allocator, slot.count);
                slot.prop_index = @intCast(properties.items.len);
                properties.appendAssumeCapacity(.{
                    .key = Expr.init(E.String, E.String.init(child.name), start_loc),
                    // Placeholder; filled in below.
                    .value = Expr.init(E.Array, .{}, start_loc),
                });
            }
            slot.list.appendAssumeCapacity(child.value);
        }

        // Pass 3: attach the gathered arrays.
        var it = slots.valueIterator();
        while (it.next()) |slot| {
            if (slot.count > 1) {
                properties.items[slot.prop_index].value = Expr.init(E.Array, .{
                    .items = .moveFromList(&slot.list),
                }, start_loc);
            }
        }
    }

    /// Trim leading/trailing XML whitespace and collapse internal runs of
    /// whitespace to a single space. Returns newly-allocated memory.
    fn trimAndCollapse(self: *XML, input: []const u8) OOM![]u8 {
        var out = try std.array_list.Managed(u8).initCapacity(self.allocator, input.len);
        var start: usize = 0;
        while (start < input.len and isWhitespace(input[start])) start += 1;
        var end: usize = input.len;
        while (end > start and isWhitespace(input[end - 1])) end -= 1;

        var in_ws = false;
        var i: usize = start;
        while (i < end) : (i += 1) {
            const c = input[i];
            if (isWhitespace(c)) {
                if (!in_ws) {
                    out.appendAssumeCapacity(' ');
                    in_ws = true;
                }
            } else {
                out.appendAssumeCapacity(c);
                in_ws = false;
            }
        }
        return try out.toOwnedSlice();
    }

    // ── Attribute values ──

    fn scanAttributeValue(self: *XML, attr_loc: logger.Loc) ParseError!Expr {
        if (self.pos >= self.source.len) return error.UnexpectedEof;
        const quote = self.source[self.pos];
        if (quote != '"' and quote != '\'') {
            return error.InvalidAttributeValue;
        }
        self.pos += 1;

        var buf = std.array_list.Managed(u8).init(self.allocator);
        while (self.pos < self.source.len) {
            const c = self.source[self.pos];
            if (c == quote) {
                self.pos += 1;
                const owned = try buf.toOwnedSlice();
                return Expr.init(E.String, E.String.init(owned), attr_loc);
            }
            if (c == '<') {
                // '<' is illegal in attribute values.
                return error.InvalidAttributeValue;
            }
            if (c == '&') {
                try self.scanEntity(&buf);
                continue;
            }
            try buf.append(c);
            self.pos += 1;
        }
        return error.UnexpectedEof;
    }

    // ── Entities ──

    fn scanEntity(self: *XML, buf: *std.array_list.Managed(u8)) ParseError!void {
        // Caller guarantees we're at '&'.
        self.pos += 1;
        if (self.pos >= self.source.len) return error.InvalidEntityReference;

        if (self.source[self.pos] == '#') {
            self.pos += 1;
            var radix: u8 = 10;
            if (self.pos < self.source.len and (self.source[self.pos] == 'x' or self.source[self.pos] == 'X')) {
                radix = 16;
                self.pos += 1;
            }
            const start = self.pos;
            while (self.pos < self.source.len) {
                const c = self.source[self.pos];
                const is_digit = switch (radix) {
                    16 => (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f') or (c >= 'A' and c <= 'F'),
                    else => c >= '0' and c <= '9',
                };
                if (!is_digit) break;
                self.pos += 1;
            }
            if (self.pos == start) return error.InvalidEntityReference;
            if (self.peek() != ';') return error.InvalidEntityReference;
            const digits = self.source[start..self.pos];
            self.pos += 1;

            const cp = std.fmt.parseUnsigned(u21, digits, radix) catch return error.InvalidEntityReference;
            if (cp > 0x10FFFF) return error.InvalidEntityReference;
            // Reject UTF-16 surrogate halves — never valid XML Chars.
            if (cp >= 0xD800 and cp <= 0xDFFF) return error.InvalidEntityReference;

            var encoded: [4]u8 = undefined;
            const len = strings.encodeWTF8Rune(&encoded, @intCast(cp));
            try buf.appendSlice(encoded[0..len]);
            return;
        }

        const start = self.pos;
        while (self.pos < self.source.len and isNameChar(self.source[self.pos])) {
            self.pos += 1;
        }
        if (self.pos == start) return error.InvalidEntityReference;
        if (self.peek() != ';') return error.InvalidEntityReference;
        const name = self.source[start..self.pos];
        self.pos += 1;

        if (strings.eqlComptime(name, "lt")) {
            try buf.append('<');
        } else if (strings.eqlComptime(name, "gt")) {
            try buf.append('>');
        } else if (strings.eqlComptime(name, "amp")) {
            try buf.append('&');
        } else if (strings.eqlComptime(name, "apos")) {
            try buf.append('\'');
        } else if (strings.eqlComptime(name, "quot")) {
            try buf.append('"');
        } else {
            return error.InvalidEntityReference;
        }
    }

    // ── CDATA ──

    fn scanCData(self: *XML, buf: *std.array_list.Managed(u8)) ParseError!void {
        // Caller guarantees we're at "<![CDATA[".
        self.pos += "<![CDATA[".len;
        while (self.pos + 2 < self.source.len) {
            if (self.source[self.pos] == ']' and
                self.source[self.pos + 1] == ']' and
                self.source[self.pos + 2] == '>')
            {
                self.pos += 3;
                return;
            }
            try buf.append(self.source[self.pos]);
            self.pos += 1;
        }
        self.pos = self.source.len;
        return error.UnterminatedCData;
    }
};

const std = @import("std");

const bun = @import("bun");
const OOM = bun.OOM;
const logger = bun.logger;
const strings = bun.strings;

const E = bun.ast.E;
const Expr = bun.ast.Expr;
const G = bun.ast.G;
