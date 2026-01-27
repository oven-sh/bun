pub const YAML = struct {
    const ParseError = OOM || error{ SyntaxError, StackOverflow };

    pub fn parse(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) ParseError!Expr {
        bun.analytics.Features.yaml_parse += 1;

        var parser: Parser(.utf8) = .init(allocator, source.contents);

        const stream = parser.parse() catch |e| {
            const err: Parser(.utf8).ParseResult = .fail(e, &parser);
            try err.err.addToLog(source, log);
            return error.SyntaxError;
        };

        return switch (stream.docs.items.len) {
            0 => .init(E.Null, .{}, .Empty),
            1 => stream.docs.items[0].root,
            else => {

                // multi-document yaml streams are converted into arrays

                var items: bun.BabyList(Expr) = try .initCapacity(allocator, stream.docs.items.len);

                for (stream.docs.items) |doc| {
                    items.appendAssumeCapacity(doc.root);
                }

                return .init(E.Array, .{ .items = items }, .Empty);
            },
        };
    }
};

pub fn parse(comptime encoding: Encoding, allocator: std.mem.Allocator, input: []const encoding.unit()) Parser(encoding).ParseResult {
    var parser: Parser(encoding) = .init(allocator, input);

    const stream = parser.parse() catch |err| {
        return .fail(err, &parser);
    };

    return .success(stream, &parser);
}

pub fn print(comptime encoding: Encoding, allocator: std.mem.Allocator, stream: Parser(encoding).Stream, writer: anytype) std.Io.Writer.Error!void {
    var printer: Parser(encoding).Printer(@TypeOf(writer)) = .{
        .input = stream.input,
        .stream = stream,
        .indent = .none,
        .writer = writer,
        .allocator = allocator,
    };

    try printer.print();
}

pub const Context = enum {
    block_out,
    block_in,
    // block_key,
    flow_in,
    flow_key,

    pub const Stack = struct {
        list: std.array_list.Managed(Context),

        pub fn init(allocator: std.mem.Allocator) Stack {
            return .{ .list = .init(allocator) };
        }

        pub fn set(this: *@This(), context: Context) OOM!void {
            try this.list.append(context);
        }

        pub fn unset(this: *@This(), context: Context) void {
            const prev_context = this.list.pop();
            bun.assert(prev_context != null and prev_context.? == context);
        }

        pub fn get(this: *const @This()) Context {
            // top level context is always BLOCK-OUT
            return this.list.getLastOrNull() orelse .block_out;
        }
    };
};

pub const Chomp = enum {
    /// '-'
    /// remove all trailing newlines
    strip,
    /// ''
    /// exclude the last trailing newline (default)
    clip,
    /// '+'
    /// include all trailing newlines
    keep,

    pub const default: Chomp = .clip;
};

pub const Indent = enum(usize) {
    none = 0,
    _,

    pub fn from(indent: usize) Indent {
        return @enumFromInt(indent);
    }

    pub fn cast(indent: Indent) usize {
        return @intFromEnum(indent);
    }

    pub fn inc(indent: *Indent, n: usize) void {
        indent.* = @enumFromInt(@intFromEnum(indent.*) + n);
    }

    pub fn dec(indent: *Indent, n: usize) void {
        indent.* = @enumFromInt(@intFromEnum(indent.*) - n);
    }

    pub fn add(indent: Indent, n: usize) Indent {
        return @enumFromInt(@intFromEnum(indent) + n);
    }

    pub fn sub(indent: Indent, n: usize) Indent {
        return @enumFromInt(@intFromEnum(indent) - n);
    }

    pub fn isLessThan(indent: Indent, other: Indent) bool {
        return @intFromEnum(indent) < @intFromEnum(other);
    }

    pub fn isLessThanOrEqual(indent: Indent, other: Indent) bool {
        return @intFromEnum(indent) <= @intFromEnum(other);
    }

    pub fn cmp(l: Indent, r: Indent) std.math.Order {
        if (@intFromEnum(l) > @intFromEnum(r)) return .gt;
        if (@intFromEnum(l) < @intFromEnum(r)) return .lt;
        return .eq;
    }

    pub const Indicator = enum(u8) {
        /// trim leading indentation (spaces) (default)
        auto = 0,

        @"1",
        @"2",
        @"3",
        @"4",
        @"5",
        @"6",
        @"7",
        @"8",
        @"9",

        pub const default: Indicator = .auto;

        pub fn get(indicator: Indicator) u8 {
            return @intFromEnum(indicator);
        }
    };

    pub const Stack = struct {
        list: std.array_list.Managed(Indent),

        pub fn init(allocator: std.mem.Allocator) Stack {
            return .{ .list = .init(allocator) };
        }

        pub fn push(this: *@This(), indent: Indent) OOM!void {
            try this.list.append(indent);
        }

        pub fn pop(this: *@This()) void {
            bun.assert(this.list.items.len != 0);
            _ = this.list.pop();
        }

        pub fn get(this: *@This()) ?Indent {
            return this.list.getLastOrNull();
        }
    };
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

    pub fn dec(pos: *Pos, n: usize) void {
        pos.* = @enumFromInt(@intFromEnum(pos.*) - n);
    }

    pub fn add(pos: Pos, n: usize) Pos {
        return @enumFromInt(@intFromEnum(pos) + n);
    }

    pub fn sub(pos: Pos, n: usize) Pos {
        return @enumFromInt(@intFromEnum(pos) - n);
    }

    pub fn isLessThan(pos: Pos, other: usize) bool {
        return pos.cast() < other;
    }

    pub fn cmp(l: Pos, r: usize) std.math.Order {
        if (l.cast() < r) return .lt;
        if (l.cast() > r) return .gt;
        return .eq;
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

    pub fn dec(line: *Line, n: usize) void {
        line.* = @enumFromInt(@intFromEnum(line.*) - n);
    }

    pub fn add(line: Line, n: usize) Line {
        return @enumFromInt(@intFromEnum(line) + n);
    }

    pub fn sub(line: Line, n: usize) Line {
        return @enumFromInt(@intFromEnum(line) - n);
    }
};

comptime {
    bun.assert(Pos != Indent);
    bun.assert(Pos != Line);
    bun.assert(Pos == Pos);
    bun.assert(Indent != Line);
    bun.assert(Indent == Indent);
    bun.assert(Line == Line);
}

pub fn Parser(comptime enc: Encoding) type {
    const chars = enc.chars();

    return struct {
        input: []const enc.unit(),

        pos: Pos,
        line_indent: Indent,
        line: Line,
        token: Token(enc),

        allocator: std.mem.Allocator,

        context: Context.Stack,
        block_indents: Indent.Stack,

        explicit_document_start_line: ?Line,

        // anchors: Anchors,
        anchors: bun.StringHashMap(Expr),
        // aliases: PendingAliases,

        tag_handles: bun.StringHashMap(void),

        // const PendingAliases = struct {
        //     list: std.array_list.Managed(State),

        //     const State = struct {
        //         name: String.Range,
        //         index: usize,
        //         prop: enum { key, value },
        //         collection_node: *Node,
        //     };
        // };

        whitespace_buf: std.array_list.Managed(Whitespace),

        stack_check: bun.StackCheck,

        const Whitespace = union(enum) {
            source: struct {
                pos: Pos,
                unit: enc.unit(),
            },
            new: enc.unit(),
        };

        pub fn init(allocator: std.mem.Allocator, input: []const enc.unit()) @This() {
            return .{
                .input = input,
                .allocator = allocator,
                .pos = .from(0),
                .line_indent = .none,
                .line = .from(1),
                .token = .eof(.{ .start = .from(0), .indent = .none, .line = .from(1) }),
                // .key = null,
                // .literal = null,
                .context = .init(allocator),
                .block_indents = .init(allocator),
                .explicit_document_start_line = null,
                // .anchors = .{ .map = .init(allocator) },
                .anchors = .init(allocator),
                // .aliases = .{ .list = .init(allocator) },
                .tag_handles = .init(allocator),
                .whitespace_buf = .init(allocator),
                .stack_check = .init(),
            };
        }

        pub fn deinit(self: *@This()) void {
            self.context.list.deinit();
            self.block_indents.list.deinit();
            self.anchors.deinit();
            self.tag_handles.deinit();
            self.whitespace_buf.deinit();
            // std.debug.assert(self.future == null);
        }

        pub const ParseResult = union(enum) {
            result: Result,
            err: Error,

            pub const Result = struct {
                stream: Stream,
                allocator: std.mem.Allocator,

                pub fn deinit(this: *@This()) void {
                    for (this.stream.docs.items) |doc| {
                        doc.deinit();
                    }
                }
            };

            pub const Error = union(enum) {
                oom,
                stack_overflow,
                unexpected_eof: struct {
                    pos: Pos,
                },
                unexpected_token: struct {
                    pos: Pos,
                },
                unexpected_character: struct {
                    pos: Pos,
                },
                invalid_directive: struct {
                    pos: Pos,
                },
                unresolved_tag_handle: struct {
                    pos: Pos,
                },
                unresolved_alias: struct {
                    pos: Pos,
                },
                // scalar_type_mismatch: struct {
                //     pos: Pos,
                // },
                multiline_implicit_key: struct {
                    pos: Pos,
                },
                multiple_anchors: struct {
                    pos: Pos,
                },
                multiple_tags: struct {
                    pos: Pos,
                },
                unexpected_document_start: struct {
                    pos: Pos,
                },
                unexpected_document_end: struct {
                    pos: Pos,
                },
                multiple_yaml_directives: struct {
                    pos: Pos,
                },
                invalid_indentation: struct {
                    pos: Pos,
                },

                pub fn addToLog(this: *const Error, source: *const logger.Source, log: *logger.Log) (OOM || error{StackOverflow})!void {
                    switch (this.*) {
                        .oom => return error.OutOfMemory,
                        .stack_overflow => return error.StackOverflow,
                        .unexpected_eof => |e| {
                            try log.addError(source, e.pos.loc(), "Unexpected EOF");
                        },
                        .unexpected_token => |e| {
                            try log.addError(source, e.pos.loc(), "Unexpected token");
                        },
                        .unexpected_character => |e| {
                            try log.addError(source, e.pos.loc(), "Unexpected character");
                        },
                        .invalid_directive => |e| {
                            try log.addError(source, e.pos.loc(), "Invalid directive");
                        },
                        .unresolved_tag_handle => |e| {
                            try log.addError(source, e.pos.loc(), "Unresolved tag handle");
                        },
                        .unresolved_alias => |e| {
                            try log.addError(source, e.pos.loc(), "Unresolved alias");
                        },
                        .multiline_implicit_key => |e| {
                            try log.addError(source, e.pos.loc(), "Multiline implicit key");
                        },
                        .multiple_anchors => |e| {
                            try log.addError(source, e.pos.loc(), "Multiple anchors");
                        },
                        .multiple_tags => |e| {
                            try log.addError(source, e.pos.loc(), "Multiple tags");
                        },
                        .unexpected_document_start => |e| {
                            try log.addError(source, e.pos.loc(), "Unexpected document start");
                        },
                        .unexpected_document_end => |e| {
                            try log.addError(source, e.pos.loc(), "Unexpected document end");
                        },
                        .multiple_yaml_directives => |e| {
                            try log.addError(source, e.pos.loc(), "Multiple YAML directives");
                        },
                        .invalid_indentation => |e| {
                            try log.addError(source, e.pos.loc(), "Invalid indentation");
                        },
                    }
                }
            };

            pub fn success(stream: Stream, parser: *const Parser(enc)) ParseResult {
                return .{
                    .result = .{
                        .stream = stream,
                        .allocator = parser.allocator,
                    },
                };
            }

            pub fn fail(err: ParseError, parser: *const Parser(enc)) ParseResult {
                return .{
                    .err = switch (err) {
                        error.OutOfMemory => .oom,
                        error.StackOverflow => .stack_overflow,
                        // error.UnexpectedToken => if (parser.token.data == .eof)
                        //     .{ .unexpected_eof = .{ .pos = parser.token.start } }
                        // else
                        //     .{ .unexpected_token = .{ .pos = parser.token.start } },
                        error.UnexpectedToken => .{ .unexpected_token = .{ .pos = parser.token.start } },
                        error.UnexpectedEof => .{ .unexpected_eof = .{ .pos = parser.token.start } },
                        error.InvalidDirective => .{ .invalid_directive = .{ .pos = parser.token.start } },
                        error.UnexpectedCharacter => if (!parser.pos.isLessThan(parser.input.len))
                            .{ .unexpected_eof = .{ .pos = parser.pos } }
                        else
                            .{ .unexpected_character = .{ .pos = parser.pos } },
                        error.UnresolvedTagHandle => .{ .unresolved_tag_handle = .{ .pos = parser.pos } },
                        error.UnresolvedAlias => .{ .unresolved_alias = .{ .pos = parser.token.start } },
                        // error.ScalarTypeMismatch => .{ .scalar_type_mismatch = .{ .pos = parser.token.start } },
                        error.MultilineImplicitKey => .{ .multiline_implicit_key = .{ .pos = parser.token.start } },
                        error.MultipleAnchors => .{ .multiple_anchors = .{ .pos = parser.token.start } },
                        error.MultipleTags => .{ .multiple_tags = .{ .pos = parser.token.start } },
                        error.UnexpectedDocumentStart => .{ .unexpected_document_start = .{ .pos = parser.pos } },
                        error.UnexpectedDocumentEnd => .{ .unexpected_document_end = .{ .pos = parser.pos } },
                        error.MultipleYamlDirectives => .{ .multiple_yaml_directives = .{ .pos = parser.token.start } },
                        error.InvalidIndentation => .{ .invalid_indentation = .{ .pos = parser.pos } },
                    },
                };
            }
        };

        fn unexpectedToken() error{UnexpectedToken} {
            return error.UnexpectedToken;
        }

        pub fn parse(self: *@This()) ParseError!Stream {
            try self.scan(.{ .first_scan = true });

            return try self.parseStream();
        }

        const ParseError = OOM || error{
            UnexpectedToken,
            UnexpectedEof,
            InvalidDirective,
            UnexpectedCharacter,
            UnresolvedTagHandle,
            UnresolvedAlias,
            MultilineImplicitKey,
            MultipleAnchors,
            MultipleTags,
            UnexpectedDocumentStart,
            UnexpectedDocumentEnd,
            MultipleYamlDirectives,
            InvalidIndentation,
            StackOverflow,
            // ScalarTypeMismatch,

            // InvalidSyntax,
            // UnexpectedDirective,
        };

        pub fn parseStream(self: *@This()) ParseError!Stream {
            var docs: std.array_list.Managed(Document) = .init(self.allocator);

            // we want one null document if eof, not zero documents.
            var first = true;
            while (first or self.token.data != .eof) {
                first = false;

                const doc = try self.parseDocument();

                try docs.append(doc);
            }

            return .{ .docs = docs, .input = self.input };
        }

        fn peek(self: *const @This(), comptime n: usize) enc.unit() {
            const pos = self.pos.add(n);
            if (pos.isLessThan(self.input.len)) {
                return self.input[pos.cast()];
            }

            return 0;
        }

        fn inc(self: *@This(), n: usize) void {
            self.pos = .from(@min(self.pos.cast() + n, self.input.len));
        }

        fn newline(self: *@This()) void {
            self.line_indent = .none;
            self.line.inc(1);
        }

        fn slice(self: *const @This(), off: Pos, end: Pos) []const enc.unit() {
            return self.input[off.cast()..end.cast()];
        }

        fn remain(self: *const @This()) []const enc.unit() {
            return self.input[self.pos.cast()..];
        }

        fn remainStartsWith(self: *const @This(), cs: []const enc.unit()) bool {
            return std.mem.startsWith(enc.unit(), self.remain(), cs);
        }

        fn remainStartsWithChar(self: *const @This(), char: enc.unit()) bool {
            const r = self.remain();
            return r.len != 0 and r[0] == char;
        }

        fn remainStartsWithAny(self: *const @This(), cs: []const enc.unit()) bool {
            const r = self.remain();
            if (r.len == 0) {
                return false;
            }

            return std.mem.indexOfScalar(enc.unit(), cs, r[0]) != null;
        }

        // this looks different from node parsing code because directives
        // exist mostly outside of the normal token scanning logic. they are
        // not part of the root expression.

        // TODO: move most of this into `scan()`
        fn parseDirective(self: *@This()) ParseError!Directive {
            if (self.token.indent != .none) {
                return error.InvalidDirective;
            }

            // yaml directive
            if (self.remainStartsWith(enc.literal("YAML")) and self.isSWhiteAt(4)) {
                self.inc(4);

                try self.trySkipSWhite();
                try self.trySkipNsDecDigits();
                try self.trySkipChar('.');
                try self.trySkipNsDecDigits();

                // s-l-comments
                try self.trySkipToNewLine();

                return .yaml;
            }

            // tag directive
            if (self.remainStartsWith(enc.literal("TAG")) and self.isSWhiteAt(3)) {
                self.inc(3);

                try self.trySkipSWhite();
                try self.trySkipChar('!');

                // primary tag handle
                if (self.isSWhite()) {
                    self.skipSWhite();
                    const prefix = try self.parseDirectiveTagPrefix();
                    try self.trySkipToNewLine();
                    return .{ .tag = .{ .handle = .primary, .prefix = prefix } };
                }

                // secondary tag handle
                if (self.isChar('!')) {
                    self.inc(1);
                    try self.trySkipSWhite();
                    const prefix = try self.parseDirectiveTagPrefix();
                    try self.trySkipToNewLine();
                    return .{ .tag = .{ .handle = .secondary, .prefix = prefix } };
                }

                // named tag handle
                var range = self.stringRange();
                try self.trySkipNsWordChars();
                const handle = range.end();
                try self.trySkipChar('!');
                try self.trySkipSWhite();

                try self.tag_handles.put(handle.slice(self.input), {});

                const prefix = try self.parseDirectiveTagPrefix();
                try self.trySkipToNewLine();
                return .{ .tag = .{ .handle = .{ .named = handle }, .prefix = prefix } };
            }

            // reserved directive
            var range = self.stringRange();
            try self.trySkipNsChars();
            const reserved = range.end();

            self.skipSWhite();

            while (self.isNsChar()) {
                self.skipNsChars();
                self.skipSWhite();
            }

            try self.trySkipToNewLine();

            return .{ .reserved = reserved };
        }

        pub fn parseDirectiveTagPrefix(self: *@This()) ParseError!Directive.Tag.Prefix {
            // local tag prefix
            if (self.isChar('!')) {
                self.inc(1);
                var range = self.stringRange();
                self.skipNsUriChars();
                return .{ .local = range.end() };
            }

            // global tag prefix
            if (self.isNsTagChar()) |char_len| {
                var range = self.stringRange();
                self.inc(char_len);
                self.skipNsUriChars();
                return .{ .global = range.end() };
            }

            return error.InvalidDirective;
        }

        pub fn parseDocument(self: *@This()) ParseError!Document {
            var directives: std.array_list.Managed(Directive) = .init(self.allocator);

            self.anchors.clearRetainingCapacity();
            self.tag_handles.clearRetainingCapacity();

            var has_yaml_directive = false;

            while (self.token.data == .directive) {
                const directive = try self.parseDirective();
                if (directive == .yaml) {
                    if (has_yaml_directive) {
                        return error.MultipleYamlDirectives;
                    }
                    has_yaml_directive = true;
                }
                try directives.append(directive);
                try self.scan(.{});
            }

            self.explicit_document_start_line = null;

            if (self.token.data == .document_start) {
                self.explicit_document_start_line = self.token.line;
                try self.scan(.{});
            } else if (directives.items.len > 0) {
                // if there's directives they must end with '---'
                return unexpectedToken();
            }

            const root = try self.parseNode(.{});

            // If document_start it needs to create a new document.
            // If document_end, consume as many as possible. They should
            // not create new documents.
            switch (self.token.data) {
                .eof => {},
                .document_start => {},
                .document_end => {
                    const document_end_line = self.token.line;
                    try self.scan(.{});

                    // consume all bare documents
                    while (self.token.data == .document_end) {
                        try self.scan(.{});
                    }

                    if (self.token.line == document_end_line) {
                        return unexpectedToken();
                    }
                },
                else => {
                    return unexpectedToken();
                },
            }

            return .{ .root = root, .directives = directives };
        }

        fn parseFlowSequence(self: *@This()) ParseError!Expr {
            const sequence_start = self.token.start;
            const sequence_indent = self.token.indent;
            _ = sequence_indent;
            const sequence_line = self.line;
            _ = sequence_line;

            var seq: std.array_list.Managed(Expr) = .init(self.allocator);

            {
                try self.context.set(.flow_in);
                defer self.context.unset(.flow_in);

                try self.scan(.{});
                while (self.token.data != .sequence_end) {
                    const item = try self.parseNode(.{});
                    try seq.append(item);

                    if (self.token.data == .sequence_end) {
                        break;
                    }

                    if (self.token.data != .collect_entry) {
                        return unexpectedToken();
                    }

                    try self.scan(.{});
                }
            }

            try self.scan(.{});

            return .init(E.Array, .{ .items = .moveFromList(&seq) }, sequence_start.loc());
        }

        fn parseFlowMapping(self: *@This()) ParseError!Expr {
            const mapping_start = self.token.start;
            const mapping_indent = self.token.indent;
            _ = mapping_indent;
            const mapping_line = self.token.line;
            _ = mapping_line;

            var props: MappingProps = .init(self.allocator);

            {
                try self.context.set(.flow_in);

                try self.context.set(.flow_key);
                try self.scan(.{});
                self.context.unset(.flow_key);

                while (self.token.data != .mapping_end) {
                    try self.context.set(.flow_key);
                    const key = try self.parseNode(.{});
                    self.context.unset(.flow_key);

                    switch (self.token.data) {
                        .collect_entry => {
                            const value: Expr = .init(E.Null, .{}, self.token.start.loc());
                            try props.append(.{
                                .key = key,
                                .value = value,
                            });

                            try self.context.set(.flow_key);
                            try self.scan(.{});
                            self.context.unset(.flow_key);
                            continue;
                        },
                        .mapping_end => {
                            const value: Expr = .init(E.Null, .{}, self.token.start.loc());
                            try props.append(.{
                                .key = key,
                                .value = value,
                            });
                            continue;
                        },
                        .mapping_value => {},
                        else => {
                            return unexpectedToken();
                        },
                    }

                    try self.scan(.{});

                    if (self.token.data == .mapping_end or
                        self.token.data == .collect_entry)
                    {
                        const value: Expr = .init(E.Null, .{}, self.token.start.loc());
                        try props.append(.{
                            .key = key,
                            .value = value,
                        });
                    } else {
                        const value = try self.parseNode(.{});
                        try props.appendMaybeMerge(key, value);
                    }

                    if (self.token.data == .collect_entry) {
                        try self.context.set(.flow_key);
                        try self.scan(.{});
                        self.context.unset(.flow_key);
                    }
                }

                self.context.unset(.flow_in);
            }

            try self.scan(.{});

            return .init(E.Object, .{ .properties = props.moveList() }, mapping_start.loc());
        }

        fn parseBlockSequence(self: *@This()) ParseError!Expr {
            const sequence_start = self.token.start;
            const sequence_indent = self.token.indent;
            // const sequence_line = self.token.line;

            try self.block_indents.push(sequence_indent);
            defer self.block_indents.pop();

            var seq: std.array_list.Managed(Expr) = .init(self.allocator);

            var prev_line: Line = .from(0);

            while (self.token.data == .sequence_entry and self.token.indent == sequence_indent) {
                const entry_line = self.token.line;
                _ = entry_line;
                const entry_start = self.token.start;
                const entry_indent = self.token.indent;

                if (seq.items.len != 0 and prev_line == self.token.line) {
                    // only the first entry can be another sequence entry on the
                    // same line
                    break;
                }

                prev_line = self.token.line;

                try self.scan(.{ .additional_parent_indent = entry_indent.add(1) });

                {
                    // check if the sequence entry is a null value
                    //
                    // 1: eof.
                    // ```
                    // - item
                    // - # becomes null
                    // ```
                    //
                    // 2: another entry afterwards.
                    // ```
                    // - # becomes null
                    // - item
                    // ```
                    //
                    // 3: indent must be < base indent to be excluded from this sequence
                    // ```
                    // - - # becomes null
                    // - item
                    // ```
                    //
                    // 4: check line for compact sequences. the first entry is a sequence, not null!
                    // ```
                    // - - item
                    // ```
                    const item: Expr = switch (self.token.data) {
                        .eof => .init(E.Null, .{}, entry_start.add(2).loc()),
                        .sequence_entry => item: {
                            if (self.token.indent.isLessThanOrEqual(sequence_indent)) {
                                break :item .init(E.Null, .{}, entry_start.add(2).loc());
                            }

                            break :item try self.parseNode(.{});
                        },
                        .tag,
                        .anchor,
                        => item: {
                            // consume anchor and/or tag, then decide if the next node
                            // should be parsed.
                            var has_tag: ?Token(enc) = null;
                            var has_anchor: ?Token(enc) = null;

                            next: switch (self.token.data) {
                                .tag => {
                                    if (has_tag != null) {
                                        return unexpectedToken();
                                    }
                                    has_tag = self.token;

                                    try self.scan(.{ .additional_parent_indent = entry_indent.add(1), .tag = self.token.data.tag });
                                    continue :next self.token.data;
                                },
                                .anchor => |anchor| {
                                    _ = anchor;
                                    if (has_anchor != null) {
                                        return unexpectedToken();
                                    }
                                    has_anchor = self.token;

                                    const tag = if (has_tag) |tag| tag.data.tag else .none;
                                    try self.scan(.{ .additional_parent_indent = entry_indent.add(1), .tag = tag });
                                    continue :next self.token.data;
                                },
                                .sequence_entry => {
                                    if (self.token.indent.isLessThanOrEqual(sequence_indent)) {
                                        const tag = if (has_tag) |tag| tag.data.tag else .none;
                                        break :item tag.resolveNull(entry_start.add(2).loc());
                                    }
                                    break :item try self.parseNode(.{ .scanned_tag = has_tag, .scanned_anchor = has_anchor });
                                },
                                else => break :item try self.parseNode(.{ .scanned_tag = has_tag, .scanned_anchor = has_anchor }),
                            }
                        },
                        else => try self.parseNode(.{}),
                    };

                    try seq.append(item);
                }
            }

            return .init(E.Array, .{ .items = .moveFromList(&seq) }, sequence_start.loc());
        }

        /// Should only be used with expressions created with the YAML parser. It assumes
        /// only null, boolean, number, string, array, object are possible. It also only
        /// does pointer comparison with arrays and objects (so exponential merges are avoided)
        fn yamlMergeKeyExprEql(l: Expr, r: Expr) bool {
            if (std.meta.activeTag(l.data) != std.meta.activeTag(r.data)) {
                return false;
            }

            return switch (l.data) {
                .e_null => true,
                .e_boolean => |l_boolean| l_boolean.value == r.data.e_boolean.value,
                .e_number => |l_number| l_number.value == r.data.e_number.value,
                .e_string => |l_string| l_string.eql(E.String, r.data.e_string),

                .e_array => |l_array| l_array == r.data.e_array,
                .e_object => |l_object| l_object == r.data.e_object,

                else => false,
            };
        }

        const MappingProps = struct {
            #list: bun.collections.ArrayList(G.Property),

            pub fn init(allocator: std.mem.Allocator) MappingProps {
                return .{ .#list = .initIn(allocator) };
            }

            pub fn merge(self: *MappingProps, merge_props: []const G.Property) OOM!void {
                try self.#list.ensureUnusedCapacity(merge_props.len);
                var iter = std.mem.reverseIterator(merge_props);
                next_merge_prop: while (iter.next()) |merge_prop| {
                    const merge_key = merge_prop.key.?;
                    for (self.#list.items()) |existing_prop| {
                        const existing_key = existing_prop.key.?;
                        if (yamlMergeKeyExprEql(existing_key, merge_key)) {
                            continue :next_merge_prop;
                        }
                    }
                    self.#list.appendAssumeCapacity(merge_prop);
                }
            }

            pub fn append(self: *MappingProps, prop: G.Property) OOM!void {
                try self.#list.append(prop);
            }

            pub fn appendMaybeMerge(self: *MappingProps, key: Expr, value: Expr) OOM!void {
                if (switch (key.data) {
                    .e_string => |key_str| !key_str.eqlComptime("<<"),
                    else => true,
                }) {
                    return self.#list.append(.{ .key = key, .value = value });
                }

                return switch (value.data) {
                    .e_object => |value_obj| self.merge(value_obj.properties.slice()),
                    .e_array => |value_arr| {
                        for (value_arr.items.slice()) |item| {
                            const item_obj = switch (item.data) {
                                .e_object => |obj| obj,
                                else => continue,
                            };

                            try self.merge(item_obj.properties.slice());
                        }
                    },

                    else => self.#list.append(.{ .key = key, .value = value }),
                };
            }

            pub fn moveList(self: *MappingProps) G.Property.List {
                return .moveFromList(&self.#list);
            }
        };

        fn parseBlockMapping(
            self: *@This(),
            first_key: Expr,
            mapping_start: Pos,
            mapping_indent: Indent,
            mapping_line: Line,
        ) ParseError!Expr {
            if (self.explicit_document_start_line) |explicit_document_start_line| {
                if (mapping_line == explicit_document_start_line) {
                    // TODO: more specific error
                    return error.UnexpectedToken;
                }
            }

            try self.block_indents.push(mapping_indent);
            defer self.block_indents.pop();

            var props: MappingProps = .init(self.allocator);

            {
                // try self.context.set(.block_in);
                // defer self.context.unset(.block_in);

                // get the first value

                const mapping_value_start = self.token.start;
                const mapping_value_line = self.token.line;

                const value: Expr = switch (self.token.data) {
                    // it's a !!set entry
                    .mapping_key => value: {
                        if (self.token.line == mapping_line) {
                            return unexpectedToken();
                        }
                        break :value .init(E.Null, .{}, mapping_value_start.loc());
                    },
                    else => value: {
                        try self.scan(.{});

                        switch (self.token.data) {
                            .sequence_entry => {
                                if (self.token.line == mapping_value_line) {
                                    return unexpectedToken();
                                }

                                if (self.token.indent.isLessThan(mapping_indent)) {
                                    break :value .init(E.Null, .{}, mapping_value_start.loc());
                                }

                                break :value try self.parseNode(.{ .current_mapping_indent = mapping_indent });
                            },
                            else => {
                                if (self.token.line != mapping_value_line and self.token.indent.isLessThanOrEqual(mapping_indent)) {
                                    break :value .init(E.Null, .{}, mapping_value_start.loc());
                                }

                                break :value try self.parseNode(.{ .current_mapping_indent = mapping_indent });
                            },
                        }
                    },
                };

                try props.appendMaybeMerge(first_key, value);
            }

            if (self.context.get() == .flow_in) {
                return .init(E.Object, .{ .properties = props.moveList() }, mapping_start.loc());
            }

            try self.context.set(.block_in);
            defer self.context.unset(.block_in);

            var previous_line = mapping_line;

            while (switch (self.token.data) {
                .eof,
                .document_start,
                .document_end,
                => false,
                else => true,
            } and self.token.indent == mapping_indent and self.token.line != previous_line) {
                const key_line = self.token.line;
                previous_line = key_line;
                const explicit_key = self.token.data == .mapping_key;

                const key = try self.parseNode(.{ .current_mapping_indent = mapping_indent });

                switch (self.token.data) {
                    .eof,
                    => {
                        if (explicit_key) {
                            const value: Expr = .init(E.Null, .{}, self.pos.loc());
                            try props.append(.{
                                .key = key,
                                .value = value,
                            });
                            continue;
                        }
                        return unexpectedToken();
                    },
                    .mapping_value => {
                        if (key_line != self.token.line) {
                            return error.MultilineImplicitKey;
                        }
                    },
                    .mapping_key => {},
                    else => {
                        return unexpectedToken();
                    },
                }

                const mapping_value_line = self.token.line;
                const mapping_value_start = self.token.start;

                const value: Expr = switch (self.token.data) {
                    // it's a !!set entry
                    .mapping_key => value: {
                        if (self.token.line == key_line) {
                            return unexpectedToken();
                        }
                        break :value .init(E.Null, .{}, mapping_value_start.loc());
                    },
                    else => value: {
                        try self.scan(.{});

                        switch (self.token.data) {
                            .sequence_entry => {
                                if (self.token.line == key_line) {
                                    return unexpectedToken();
                                }

                                if (self.token.indent.isLessThan(mapping_indent)) {
                                    break :value .init(E.Null, .{}, mapping_value_start.loc());
                                }

                                break :value try self.parseNode(.{ .current_mapping_indent = mapping_indent });
                            },
                            else => {
                                if (self.token.line != mapping_value_line and self.token.indent.isLessThanOrEqual(mapping_indent)) {
                                    break :value .init(E.Null, .{}, mapping_value_start.loc());
                                }

                                break :value try self.parseNode(.{ .current_mapping_indent = mapping_indent });
                            },
                        }
                    },
                };

                try props.appendMaybeMerge(key, value);
            }

            return .init(E.Object, .{ .properties = props.moveList() }, mapping_start.loc());
        }

        const NodeProperties = struct {
            // c-ns-properties
            has_anchor: ?Token(enc) = null,
            has_tag: ?Token(enc) = null,

            // when properties for mapping and first key
            // are right next to eachother
            // ```
            // &mapanchor !!map
            // &keyanchor !!bool true: false
            // ```
            has_mapping_anchor: ?Token(enc) = null,
            has_mapping_tag: ?Token(enc) = null,

            pub fn hasAnchorOrTag(this: *const NodeProperties) bool {
                return this.has_anchor != null or this.has_tag != null;
            }

            pub fn setAnchor(this: *NodeProperties, anchor_token: Token(enc)) error{MultipleAnchors}!void {
                if (this.has_anchor) |previous_anchor| {
                    if (previous_anchor.line == anchor_token.line) {
                        return error.MultipleAnchors;
                    }

                    this.has_mapping_anchor = previous_anchor;
                }
                this.has_anchor = anchor_token;
            }

            pub fn anchor(this: *NodeProperties) ?String.Range {
                return if (this.has_anchor) |anchor_token| anchor_token.data.anchor else null;
            }

            pub fn anchorLine(this: *NodeProperties) ?Line {
                return if (this.has_anchor) |anchor_token| anchor_token.line else null;
            }

            pub fn anchorIndent(this: *NodeProperties) ?Indent {
                return if (this.has_anchor) |anchor_token| anchor_token.indent else null;
            }

            pub fn mappingAnchor(this: *NodeProperties) ?String.Range {
                return if (this.has_mapping_anchor) |mapping_anchor_token| mapping_anchor_token.data.anchor else null;
            }

            const ImplicitKeyAnchors = struct {
                key_anchor: ?String.Range,
                mapping_anchor: ?String.Range,
            };

            pub fn implicitKeyAnchors(this: *NodeProperties, implicit_key_line: Line) ImplicitKeyAnchors {
                if (this.has_mapping_anchor) |mapping_anchor| {
                    bun.assert(this.has_anchor != null);
                    return .{
                        .key_anchor = if (this.has_anchor) |key_anchor| key_anchor.data.anchor else null,
                        .mapping_anchor = mapping_anchor.data.anchor,
                    };
                }

                if (this.has_anchor) |mystery_anchor| {
                    // might be the anchor for the key, or anchor for the mapping
                    if (mystery_anchor.line == implicit_key_line) {
                        return .{
                            .key_anchor = mystery_anchor.data.anchor,
                            .mapping_anchor = null,
                        };
                    }

                    return .{
                        .key_anchor = null,
                        .mapping_anchor = mystery_anchor.data.anchor,
                    };
                }

                return .{
                    .key_anchor = null,
                    .mapping_anchor = null,
                };
            }

            pub fn setTag(this: *NodeProperties, tag_token: Token(enc)) error{MultipleTags}!void {
                if (this.has_tag) |previous_tag| {
                    if (previous_tag.line == tag_token.line) {
                        return error.MultipleTags;
                    }

                    this.has_mapping_tag = previous_tag;
                }

                this.has_tag = tag_token;
            }

            pub fn tag(this: *NodeProperties) NodeTag {
                return if (this.has_tag) |tag_token| tag_token.data.tag else .none;
            }

            pub fn tagLine(this: *NodeProperties) ?Line {
                return if (this.has_tag) |tag_token| tag_token.line else null;
            }

            pub fn tagIndent(this: *NodeProperties) ?Indent {
                return if (this.has_tag) |tag_token| tag_token.indent else null;
            }
        };

        const ParseNodeOptions = struct {
            current_mapping_indent: ?Indent = null,
            explicit_mapping_key: bool = false,
            scanned_tag: ?Token(enc) = null,
            scanned_anchor: ?Token(enc) = null,
        };

        fn parseNode(self: *@This(), opts: ParseNodeOptions) ParseError!Expr {
            if (!self.stack_check.isSafeToRecurse()) {
                try bun.throwStackOverflow();
            }

            // c-ns-properties
            var node_props: NodeProperties = .{};

            if (opts.scanned_tag) |tag| {
                try node_props.setTag(tag);
            }

            if (opts.scanned_anchor) |anchor| {
                try node_props.setAnchor(anchor);
            }

            const node: Expr = node: switch (self.token.data) {
                .eof,
                .document_start,
                .document_end,
                => {
                    break :node .init(E.Null, .{}, self.token.start.loc());
                },

                .anchor => |anchor| {
                    _ = anchor;
                    try node_props.setAnchor(self.token);

                    try self.scan(.{ .tag = node_props.tag() });

                    continue :node self.token.data;
                },

                .tag => |tag| {
                    try node_props.setTag(self.token);

                    try self.scan(.{ .tag = tag });

                    continue :node self.token.data;
                },

                .alias => |alias| {
                    const alias_start = self.token.start;
                    const alias_indent = self.token.indent;
                    const alias_line = self.token.line;

                    if (node_props.has_anchor) |anchor| {
                        if (anchor.line == alias_line) {
                            return unexpectedToken();
                        }
                    }
                    if (node_props.has_tag) |tag| {
                        if (tag.line == alias_line) {
                            return unexpectedToken();
                        }
                    }

                    var copy = self.anchors.get(alias.slice(self.input)) orelse {
                        // we failed to find the alias, but it might be cyclic and
                        // and available later. to resolve this we need to check
                        // nodes for parent collection types. this alias is added
                        // to a list with a pointer to *Mapping or *Sequence, an
                        // index (and whether is key/value), and the alias name.
                        // then, when we actually have Node for the parent we
                        // fill in the data pointer at the index with the node.
                        return error.UnresolvedAlias;
                    };

                    // update position from the anchor node to the alias node.
                    copy.loc = alias_start.loc();

                    try self.scan(.{});

                    if (self.token.data == .mapping_value) {
                        if (alias_line != self.token.line and !opts.explicit_mapping_key) {
                            return error.MultilineImplicitKey;
                        }

                        if (self.context.get() == .flow_key) {
                            return copy;
                        }

                        if (opts.current_mapping_indent) |current_mapping_indent| {
                            if (current_mapping_indent == alias_indent) {
                                return copy;
                            }
                        }

                        const map = try self.parseBlockMapping(
                            copy,
                            alias_start,
                            alias_indent,
                            alias_line,
                        );

                        return map;
                    }

                    break :node copy;
                },

                .sequence_start => {
                    const sequence_start = self.token.start;
                    const sequence_indent = self.token.indent;
                    const sequence_line = self.token.line;
                    const seq = try self.parseFlowSequence();

                    if (self.token.data == .mapping_value) {
                        if (sequence_line != self.token.line and !opts.explicit_mapping_key) {
                            return error.MultilineImplicitKey;
                        }

                        if (self.context.get() == .flow_key) {
                            break :node seq;
                        }

                        if (opts.current_mapping_indent) |current_mapping_indent| {
                            if (current_mapping_indent == sequence_indent) {
                                break :node seq;
                            }
                        }

                        const implicit_key_anchors = node_props.implicitKeyAnchors(sequence_line);

                        if (implicit_key_anchors.key_anchor) |key_anchor| {
                            try self.anchors.put(key_anchor.slice(self.input), seq);
                        }

                        const map = try self.parseBlockMapping(
                            seq,
                            sequence_start,
                            sequence_indent,
                            sequence_line,
                        );

                        if (implicit_key_anchors.mapping_anchor) |mapping_anchor| {
                            try self.anchors.put(mapping_anchor.slice(self.input), map);
                        }

                        return map;
                    }

                    break :node seq;
                },
                .collect_entry,
                .sequence_end,
                .mapping_end,
                => {
                    if (node_props.hasAnchorOrTag()) {
                        break :node .init(E.Null, .{}, self.pos.loc());
                    }
                    return unexpectedToken();
                },
                .sequence_entry => {
                    if (node_props.anchorLine()) |anchor_line| {
                        if (anchor_line == self.token.line) {
                            return unexpectedToken();
                        }
                    }
                    if (node_props.tagLine()) |tag_line| {
                        if (tag_line == self.token.line) {
                            return unexpectedToken();
                        }
                    }

                    break :node try self.parseBlockSequence();
                },
                .mapping_start => {
                    const mapping_start = self.token.start;
                    const mapping_indent = self.token.indent;
                    const mapping_line = self.token.line;

                    const map = try self.parseFlowMapping();

                    if (self.token.data == .mapping_value) {
                        if (mapping_line != self.token.line and !opts.explicit_mapping_key) {
                            return error.MultilineImplicitKey;
                        }

                        if (self.context.get() == .flow_key) {
                            break :node map;
                        }

                        if (opts.current_mapping_indent) |current_mapping_indent| {
                            if (current_mapping_indent == mapping_indent) {
                                break :node map;
                            }
                        }

                        const implicit_key_anchors = node_props.implicitKeyAnchors(mapping_line);

                        if (implicit_key_anchors.key_anchor) |key_anchor| {
                            try self.anchors.put(key_anchor.slice(self.input), map);
                        }

                        const parent_map = try self.parseBlockMapping(
                            map,
                            mapping_start,
                            mapping_indent,
                            mapping_line,
                        );

                        if (implicit_key_anchors.mapping_anchor) |mapping_anchor| {
                            try self.anchors.put(mapping_anchor.slice(self.input), parent_map);
                        }

                        break :node parent_map;
                    }
                    break :node map;
                },

                .mapping_key => {
                    const mapping_start = self.token.start;
                    const mapping_indent = self.token.indent;
                    const mapping_line = self.token.line;

                    // if (node_props.anchorLine()) |anchor_line| {
                    //     if (anchor_line == self.token.line) {
                    //         return unexpectedToken();
                    //     }
                    // }

                    try self.block_indents.push(mapping_indent);

                    try self.scan(.{});

                    const key = try self.parseNode(.{
                        .explicit_mapping_key = true,
                        .current_mapping_indent = opts.current_mapping_indent orelse mapping_indent,
                    });

                    self.block_indents.pop();

                    if (opts.current_mapping_indent) |current_mapping_indent| {
                        if (current_mapping_indent == mapping_indent) {
                            return key;
                        }
                    }

                    break :node try self.parseBlockMapping(
                        key,
                        mapping_start,
                        mapping_indent,
                        mapping_line,
                    );
                },
                .mapping_value => {
                    if (self.context.get() == .flow_key) {
                        break :node .init(E.Null, .{}, self.token.start.loc());
                    }
                    if (opts.current_mapping_indent) |current_mapping_indent| {
                        if (current_mapping_indent == self.token.indent) {
                            break :node .init(E.Null, .{}, self.token.start.loc());
                        }
                    }
                    const first_key: Expr = .init(E.Null, .{}, self.token.start.loc());
                    break :node try self.parseBlockMapping(
                        first_key,
                        self.token.start,
                        self.token.indent,
                        self.token.line,
                    );
                },
                .scalar => |scalar| {
                    const scalar_start = self.token.start;
                    const scalar_indent = self.token.indent;
                    const scalar_line = self.token.line;

                    try self.scan(.{ .tag = node_props.tag(), .outside_context = true });

                    if (self.token.data == .mapping_value) {
                        // this might be the start of a new object with an implicit key
                        //
                        // ```
                        // foo: bar        # yes
                        // ---
                        // {foo: bar}      # no (1)
                        // ---
                        // [foo: bar]      # yes (but can't have more than one prop) (2)
                        // ---
                        // - foo: bar      # yes
                        // ---
                        // [hi]: 123       # yes
                        // ---
                        // one: two        # first property is
                        // three: four     # no, this is another prop in the same object (3)
                        // ---
                        // one:            # yes
                        //   two: three    # and yes (nested object)
                        // ```
                        if (opts.current_mapping_indent) |current_mapping_indent| {
                            if (current_mapping_indent == scalar_indent) {
                                // 3
                                break :node scalar.data.toExpr(scalar_start, self.input);
                            }
                        }

                        switch (self.context.get()) {
                            .flow_key => {
                                // 1
                                break :node scalar.data.toExpr(scalar_start, self.input);
                            },
                            // => {
                            //     // 2
                            //     // can be multiline
                            // },
                            .flow_in,
                            .block_out,
                            .block_in,
                            => {
                                if (scalar_line != self.token.line and !opts.explicit_mapping_key) {
                                    return error.MultilineImplicitKey;
                                }
                                // if (scalar.multiline) {
                                //     // TODO: maybe get rid of multiline and just check
                                //     // `scalar_line != self.token.line`. this will depend
                                //     // on how we decide scalar_line. if that's including
                                //     // whitespace for plain scalars it might not work
                                //     return error.MultilineImplicitKey;
                                // }
                            },
                        }

                        const implicit_key = scalar.data.toExpr(scalar_start, self.input);

                        const implicit_key_anchors = node_props.implicitKeyAnchors(scalar_line);

                        if (implicit_key_anchors.key_anchor) |key_anchor| {
                            try self.anchors.put(key_anchor.slice(self.input), implicit_key);
                        }

                        const mapping = try self.parseBlockMapping(
                            implicit_key,
                            scalar_start,
                            scalar_indent,
                            scalar_line,
                        );

                        if (implicit_key_anchors.mapping_anchor) |mapping_anchor| {
                            try self.anchors.put(mapping_anchor.slice(self.input), mapping);
                        }

                        return mapping;
                    }

                    break :node scalar.data.toExpr(scalar_start, self.input);
                },
                .directive => {
                    return unexpectedToken();
                },
                .reserved => {
                    return unexpectedToken();
                },
            };

            if (node_props.has_mapping_anchor) |mapping_anchor| {
                self.token = mapping_anchor;
                return error.MultipleAnchors;
            }

            if (node_props.has_mapping_tag) |mapping_tag| {
                self.token = mapping_tag;
                return error.MultipleTags;
            }

            const resolved = switch (node.data) {
                .e_null => node_props.tag().resolveNull(node.loc),
                else => node,
            };

            if (node_props.anchor()) |anchor| {
                try self.anchors.put(anchor.slice(self.input), resolved);
            }

            return resolved;
        }

        fn next(self: *const @This()) enc.unit() {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return self.input[pos.cast()];
            }
            return 0;
        }

        fn foldLines(self: *@This()) usize {
            var total: usize = 0;
            return next: switch (self.next()) {
                '\r' => {
                    if (self.peek(1) == '\n') {
                        self.inc(1);
                    }

                    continue :next '\n';
                },
                '\n' => {
                    total += 1;
                    self.newline();
                    self.inc(1);
                    continue :next self.next();
                },
                ' ' => {
                    var indent: Indent = .from(1);
                    self.inc(1);
                    while (self.next() == ' ') {
                        self.inc(1);
                        indent.inc(1);
                    }

                    self.line_indent = indent;

                    self.skipSWhite();
                    continue :next self.next();
                },
                '\t' => {
                    // there's no indentation, but we still skip
                    // the whitespace
                    self.inc(1);
                    self.skipSWhite();
                    continue :next self.next();
                },
                else => total,
            };
        }

        const ScanPlainScalarError = OOM || error{
            UnexpectedCharacter,
            // ScalarTypeMismatch,
        };

        fn scanPlainScalar(self: *@This(), opts: ScanOptions) ScanPlainScalarError!Token(enc) {
            const ScalarResolverCtx = struct {
                str_builder: String.Builder,

                resolved: bool = false,
                scalar: ?NodeScalar,
                tag: NodeTag,

                parser: *Parser(enc),

                resolved_scalar_len: usize = 0,

                start: Pos,
                line: Line,
                line_indent: Indent,
                multiline: bool = false,

                pub fn done(ctx: *@This()) Token(enc) {
                    const scalar: Token(enc).Scalar = scalar: {
                        var scalar_str = ctx.str_builder.done();

                        if (ctx.scalar) |scalar| {
                            if (scalar_str.len() == ctx.resolved_scalar_len) {
                                scalar_str.deinit();
                                break :scalar .{
                                    .multiline = ctx.multiline,
                                    .data = scalar,
                                };
                            }
                            // the first characters resolved to something
                            // but there were more characters afterwards
                        }

                        break :scalar .{
                            .multiline = ctx.multiline,
                            .data = .{ .string = scalar_str },
                        };
                    };

                    return .scalar(.{
                        .start = ctx.start,
                        .indent = ctx.line_indent,
                        .line = ctx.line,
                        .resolved = scalar,
                    });
                }

                pub fn checkAppend(ctx: *@This()) void {
                    if (ctx.str_builder.len() == 0) {
                        ctx.line_indent = ctx.parser.line_indent;
                        ctx.line = ctx.parser.line;
                    } else if (ctx.line != ctx.parser.line) {
                        ctx.multiline = true;
                    }
                }

                pub fn appendSource(ctx: *@This(), unit: enc.unit(), pos: Pos) OOM!void {
                    ctx.checkAppend();
                    try ctx.str_builder.appendSource(unit, pos);
                }

                pub fn appendSourceWhitespace(ctx: *@This(), unit: enc.unit(), pos: Pos) OOM!void {
                    try ctx.str_builder.appendSourceWhitespace(unit, pos);
                }

                pub fn appendSourceSlice(ctx: *@This(), off: Pos, end: Pos) OOM!void {
                    ctx.checkAppend();
                    try ctx.str_builder.appendSourceSlice(off, end);
                }

                // may or may not contain whitespace
                pub fn appendUnknownSourceSlice(ctx: *@This(), off: Pos, end: Pos) OOM!void {
                    for (off.cast()..end.cast()) |_pos| {
                        const pos: Pos = .from(_pos);
                        const unit = ctx.parser.input[pos.cast()];
                        switch (unit) {
                            ' ',
                            '\t',
                            '\r',
                            '\n',
                            => {
                                try ctx.str_builder.appendSourceWhitespace(unit, pos);
                            },
                            else => {
                                ctx.checkAppend();
                                try ctx.str_builder.appendSource(unit, pos);
                            },
                        }
                    }
                }

                pub fn append(ctx: *@This(), unit: enc.unit()) OOM!void {
                    ctx.checkAppend();
                    try ctx.str_builder.append(unit);
                }

                pub fn appendWhitespace(ctx: *@This(), unit: enc.unit()) OOM!void {
                    try ctx.str_builder.appendWhitespace(unit);
                }

                pub fn appendSlice(ctx: *@This(), str: []const enc.unit()) OOM!void {
                    ctx.checkAppend();
                    try ctx.str_builder.appendSlice(str);
                }

                pub fn appendNTimes(ctx: *@This(), unit: enc.unit(), n: usize) OOM!void {
                    if (n == 0) {
                        return;
                    }
                    ctx.checkAppend();
                    try ctx.str_builder.appendNTimes(unit, n);
                }

                pub fn appendWhitespaceNTimes(ctx: *@This(), unit: enc.unit(), n: usize) OOM!void {
                    if (n == 0) {
                        return;
                    }

                    try ctx.str_builder.appendWhitespaceNTimes(unit, n);
                }

                const Keywords = enum {
                    null,
                    Null,
                    NULL,
                    @"~",

                    true,
                    True,
                    TRUE,
                    yes,
                    Yes,
                    YES,
                    on,
                    On,
                    ON,

                    false,
                    False,
                    FALSE,
                    no,
                    No,
                    NO,
                    off,
                    Off,
                    OFF,
                };

                const ResolveError = OOM || error{
                    // ScalarTypeMismatch,
                    };

                pub fn resolve(
                    ctx: *@This(),
                    scalar: NodeScalar,
                    off: Pos,
                    text: []const enc.unit(),
                ) ResolveError!void {
                    try ctx.str_builder.appendExpectedSourceSlice(off, off.add(text.len), text);

                    ctx.resolved = true;

                    switch (ctx.tag) {
                        .none => {
                            ctx.resolved_scalar_len = ctx.str_builder.len();
                            ctx.scalar = scalar;
                        },
                        .non_specific => {
                            // always becomes string
                        },
                        .bool => {
                            if (scalar == .boolean) {
                                ctx.resolved_scalar_len = ctx.str_builder.len();
                                ctx.scalar = scalar;
                            }
                            // return error.ScalarTypeMismatch;
                        },
                        .int => {
                            if (scalar == .number) {
                                ctx.resolved_scalar_len = ctx.str_builder.len();
                                ctx.scalar = scalar;
                            }
                            // return error.ScalarTypeMismatch;
                        },
                        .float => {
                            if (scalar == .number) {
                                ctx.resolved_scalar_len = ctx.str_builder.len();
                                ctx.scalar = scalar;
                            }
                            // return error.ScalarTypeMismatch;
                        },
                        .null => {
                            if (scalar == .null) {
                                ctx.resolved_scalar_len = ctx.str_builder.len();
                                ctx.scalar = scalar;
                            }
                            // return error.ScalarTypeMismatch;
                        },
                        .str => {
                            // always becomes string
                        },

                        .verbatim,
                        .unknown,
                        => {
                            // also always becomes a string
                        },
                    }
                }

                pub fn tryResolveNumber(
                    ctx: *@This(),
                    parser: *Parser(enc),
                    first_char: enum { positive, negative, dot, other },
                ) ResolveError!void {
                    const nan = std.math.nan(f64);
                    const inf = std.math.inf(f64);

                    switch (first_char) {
                        .dot => {
                            switch (parser.next()) {
                                'n' => {
                                    const n_start = parser.pos;
                                    parser.inc(1);
                                    if (parser.remainStartsWith("an")) {
                                        try ctx.resolve(.{ .number = nan }, n_start, "nan");
                                        parser.inc(2);
                                        return;
                                    }
                                    try ctx.appendSource('n', n_start);
                                    return;
                                },
                                'N' => {
                                    const n_start = parser.pos;
                                    parser.inc(1);
                                    if (parser.remainStartsWith("aN")) {
                                        try ctx.resolve(.{ .number = nan }, n_start, "NaN");
                                        parser.inc(2);
                                        return;
                                    }
                                    if (parser.remainStartsWith("AN")) {
                                        try ctx.resolve(.{ .number = nan }, n_start, "NAN");
                                        parser.inc(2);
                                        return;
                                    }
                                    try ctx.appendSource('N', n_start);
                                    return;
                                },
                                'i' => {
                                    const i_start = parser.pos;
                                    parser.inc(1);
                                    if (parser.remainStartsWith("nf")) {
                                        try ctx.resolve(.{ .number = inf }, i_start, "inf");
                                        parser.inc(2);
                                        return;
                                    }
                                    try ctx.appendSource('i', i_start);
                                    return;
                                },
                                'I' => {
                                    const i_start = parser.pos;
                                    parser.inc(1);
                                    if (parser.remainStartsWith("nf")) {
                                        try ctx.resolve(.{ .number = inf }, i_start, "Inf");
                                        parser.inc(2);
                                        return;
                                    }
                                    if (parser.remainStartsWith("NF")) {
                                        try ctx.resolve(.{ .number = inf }, i_start, "INF");
                                        parser.inc(2);
                                        return;
                                    }
                                    try ctx.appendSource('I', i_start);
                                    return;
                                },
                                else => {},
                            }
                        },
                        .negative, .positive => {
                            if (parser.next() == '.' and parser.peek(1) == 'i' or parser.peek(1) == 'I') {
                                try ctx.appendSource('.', parser.pos);
                                parser.inc(1);
                                switch (parser.next()) {
                                    'i' => {
                                        const i_start = parser.pos;
                                        parser.inc(1);
                                        if (parser.remainStartsWith("nf")) {
                                            try ctx.resolve(
                                                .{ .number = if (first_char == .negative) -inf else inf },
                                                i_start,
                                                "inf",
                                            );
                                            parser.inc(2);
                                            return;
                                        }
                                        try ctx.appendSource('i', i_start);
                                        return;
                                    },
                                    'I' => {
                                        const i_start = parser.pos;
                                        parser.inc(1);
                                        if (parser.remainStartsWith("nf")) {
                                            try ctx.resolve(
                                                .{ .number = if (first_char == .negative) -inf else inf },
                                                i_start,
                                                "Inf",
                                            );
                                            parser.inc(2);
                                            return;
                                        }
                                        if (parser.remainStartsWith("NF")) {
                                            try ctx.resolve(
                                                .{ .number = if (first_char == .negative) -inf else inf },
                                                i_start,
                                                "INF",
                                            );
                                            parser.inc(2);
                                            return;
                                        }
                                        try ctx.appendSource('I', i_start);
                                        return;
                                    },
                                    else => {
                                        return;
                                    },
                                }
                            }
                        },
                        .other => {},
                    }

                    const start = parser.pos;

                    var decimal = parser.next() == '.';
                    var x = false;
                    var o = false;
                    var e = false;
                    var @"+" = false;
                    var @"-" = false;
                    var hex = false;

                    if (first_char != .negative and first_char != .positive) {
                        parser.inc(1);
                    }

                    var first = true;

                    const end, const valid = end: switch (parser.next()) {

                        // can only be valid if it ends on:
                        // - ' '
                        // - '\t'
                        // - eof
                        // - '\n'
                        // - '\r'
                        // - ':'
                        ' ',
                        '\t',
                        0,
                        '\n',
                        '\r',
                        ':',
                        => {
                            if (first and (first_char == .positive or first_char == .negative)) {
                                break :end .{ parser.pos, false };
                            }
                            break :end .{ parser.pos, true };
                        },

                        ',',
                        ']',
                        '}',
                        => {
                            first = false;
                            switch (parser.context.get()) {
                                // it's valid for ',' ']' '}' to end the scalar
                                // in flow context
                                .flow_in,
                                .flow_key,
                                => break :end .{ parser.pos, true },

                                .block_in,
                                .block_out,
                                => break :end .{ parser.pos, false },
                            }
                        },

                        '0' => {
                            defer first = false;
                            parser.inc(1);
                            if (first) {
                                switch (parser.next()) {
                                    'b',
                                    'B',
                                    => {
                                        break :end .{ parser.pos, false };
                                    },
                                    else => |c| {
                                        continue :end c;
                                    },
                                }
                            }
                            continue :end parser.next();
                        },

                        '1'...'9',
                        => {
                            first = false;
                            parser.inc(1);
                            continue :end parser.next();
                        },

                        'e',
                        'E',
                        => {
                            first = false;
                            if (e) {
                                hex = true;
                            }
                            e = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },

                        'a'...'d',
                        'f',
                        'A'...'D',
                        'F',
                        => |c| {
                            hex = true;

                            if (first) {
                                if (c == 'b' or c == 'B') {
                                    break :end .{ parser.pos, false };
                                }
                            }
                            first = false;

                            parser.inc(1);
                            continue :end parser.next();
                        },

                        'x' => {
                            first = false;
                            if (x) {
                                break :end .{ parser.pos, false };
                            }

                            x = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },

                        'o' => {
                            first = false;
                            if (o) {
                                break :end .{ parser.pos, false };
                            }

                            o = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },

                        '.' => {
                            first = false;
                            if (decimal) {
                                break :end .{ parser.pos, false };
                            }

                            decimal = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },

                        '+' => {
                            first = false;
                            if (x) {
                                break :end .{ parser.pos, false };
                            }
                            @"+" = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },
                        '-' => {
                            first = false;
                            if (@"-") {
                                break :end .{ parser.pos, false };
                            }
                            @"-" = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },
                        else => {
                            first = false;
                            break :end .{ parser.pos, false };
                        },
                    };

                    try ctx.appendUnknownSourceSlice(start, end);

                    if (!valid) {
                        return;
                    }

                    var scalar: NodeScalar = scalar: {
                        if (x or o or hex) {
                            const unsigned = std.fmt.parseUnsigned(u64, parser.slice(start, end), 0) catch {
                                return;
                            };
                            break :scalar .{ .number = @floatFromInt(unsigned) };
                        }
                        const float = bun.jsc.wtf.parseDouble(parser.slice(start, end)) catch {
                            return;
                        };

                        break :scalar .{ .number = float };
                    };

                    ctx.resolved = true;

                    switch (ctx.tag) {
                        .none,
                        .float,
                        .int,
                        => {
                            ctx.resolved_scalar_len = ctx.str_builder.len();
                            if (first_char == .negative) {
                                scalar.number = -scalar.number;
                            }
                            ctx.scalar = scalar;
                        },
                        else => {},
                    }
                }
            };

            var ctx: ScalarResolverCtx = .{
                .str_builder = self.stringBuilder(),
                .parser = self,
                .scalar = null,
                .tag = opts.tag,
                .start = self.pos,
                .line = self.line,
                .line_indent = self.line_indent,
            };

            next: switch (self.next()) {
                0 => {
                    return ctx.done();
                },

                '-' => {
                    if (self.line_indent == .none and self.remainStartsWith("---") and self.isAnyOrEofAt(" \t\n\r", 3)) {
                        return ctx.done();
                    }

                    if (!ctx.resolved and ctx.str_builder.len() == 0) {
                        try ctx.appendSource('-', self.pos);
                        self.inc(1);
                        try ctx.tryResolveNumber(self, .negative);
                        continue :next self.next();
                    }

                    try ctx.appendSource('-', self.pos);
                    self.inc(1);
                    continue :next self.next();
                },

                '.' => {
                    if (self.line_indent == .none and self.remainStartsWith("...") and self.isAnyOrEofAt(" \t\n\r", 3)) {
                        return ctx.done();
                    }

                    if (!ctx.resolved and ctx.str_builder.len() == 0) {
                        switch (self.peek(1)) {
                            'n',
                            'N',
                            'i',
                            'I',
                            => {
                                try ctx.appendSource('.', self.pos);
                                self.inc(1);
                                try ctx.tryResolveNumber(self, .dot);
                                continue :next self.next();
                            },

                            else => {
                                try ctx.tryResolveNumber(self, .other);
                                continue :next self.next();
                            },
                        }
                    }

                    try ctx.appendSource('.', self.pos);
                    self.inc(1);
                    continue :next self.next();
                },

                ':' => {
                    if (self.isSWhiteOrBCharOrEofAt(1)) {
                        return ctx.done();
                    }

                    switch (self.context.get()) {
                        .block_out,
                        .block_in,
                        .flow_in,
                        => {},
                        .flow_key => {
                            switch (self.peek(1)) {
                                ',',
                                '[',
                                ']',
                                '{',
                                '}',
                                => {
                                    return ctx.done();
                                },
                                else => {},
                            }
                        },
                    }

                    try ctx.appendSource(':', self.pos);
                    self.inc(1);
                    continue :next self.next();
                },

                '#' => {
                    const prev = self.input[self.pos.sub(1).cast()];
                    if (self.pos == .zero or switch (prev) {
                        ' ',
                        '\t',
                        '\r',
                        '\n',
                        => true,
                        else => false,
                    }) {
                        return ctx.done();
                    }

                    try ctx.appendSource('#', self.pos);
                    self.inc(1);
                    continue :next self.next();
                },

                ',',
                '[',
                ']',
                '{',
                '}',
                => |c| {
                    switch (self.context.get()) {
                        .block_in,
                        .block_out,
                        => {},

                        .flow_in,
                        .flow_key,
                        => {
                            return ctx.done();
                        },
                    }

                    try ctx.appendSource(c, self.pos);
                    self.inc(1);
                    continue :next self.next();
                },

                ' ',
                '\t',
                => |c| {
                    try ctx.appendSourceWhitespace(c, self.pos);
                    self.inc(1);
                    continue :next self.next();
                },

                '\r' => {
                    if (self.peek(1) == '\n') {
                        self.inc(1);
                    }

                    continue :next '\n';
                },

                '\n' => {
                    self.newline();
                    self.inc(1);

                    const lines = self.foldLines();

                    if (self.block_indents.get()) |block_indent| {
                        switch (self.line_indent.cmp(block_indent)) {
                            .gt => {
                                // continue (whitespace already stripped)
                            },
                            .lt, .eq => {
                                // end here. this it the start of a new value.
                                return ctx.done();
                            },
                        }
                    }

                    // clear the leading whitespace before the newline.
                    ctx.parser.whitespace_buf.clearRetainingCapacity();

                    if (lines == 0 and !self.isEof()) {
                        try ctx.appendWhitespace(' ');
                    }

                    try ctx.appendWhitespaceNTimes('\n', lines);

                    continue :next self.next();
                },

                else => |c| {
                    if (ctx.resolved or ctx.str_builder.len() != 0) {
                        const start = self.pos;
                        self.inc(1);
                        try ctx.appendSource(c, start);
                        continue :next self.next();
                    }

                    // first non-whitespace

                    // TODO: make more better
                    switch (c) {
                        'n' => {
                            const n_start = self.pos;
                            self.inc(1);
                            if (self.remainStartsWith("ull")) {
                                try ctx.resolve(.null, n_start, "null");
                                self.inc(3);
                                continue :next self.next();
                            }
                            try ctx.appendSource(c, n_start);
                            continue :next self.next();
                        },
                        'N' => {
                            const n_start = self.pos;
                            self.inc(1);
                            if (self.remainStartsWith("ull")) {
                                try ctx.resolve(.null, n_start, "Null");
                                self.inc(3);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("ULL")) {
                                try ctx.resolve(.null, n_start, "NULL");
                                self.inc(3);
                                continue :next self.next();
                            }
                            try ctx.appendSource(c, n_start);
                            continue :next self.next();
                        },
                        '~' => {
                            const start = self.pos;
                            self.inc(1);
                            try ctx.resolve(.null, start, "~");
                            continue :next self.next();
                        },
                        't' => {
                            const t_start = self.pos;
                            self.inc(1);
                            if (self.remainStartsWith("rue")) {
                                try ctx.resolve(.{ .boolean = true }, t_start, "true");
                                self.inc(3);
                                continue :next self.next();
                            }
                            try ctx.appendSource(c, t_start);
                            continue :next self.next();
                        },
                        'T' => {
                            const t_start = self.pos;
                            self.inc(1);
                            if (self.remainStartsWith("rue")) {
                                try ctx.resolve(.{ .boolean = true }, t_start, "True");
                                self.inc(3);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("RUE")) {
                                try ctx.resolve(.{ .boolean = true }, t_start, "TRUE");
                                self.inc(3);
                                continue :next self.next();
                            }
                            try ctx.appendSource(c, t_start);
                            continue :next self.next();
                        },
                        'f' => {
                            const f_start = self.pos;
                            self.inc(1);
                            if (self.remainStartsWith("alse")) {
                                try ctx.resolve(.{ .boolean = false }, f_start, "false");
                                self.inc(4);
                                continue :next self.next();
                            }
                            try ctx.appendSource(c, f_start);
                            continue :next self.next();
                        },
                        'F' => {
                            const f_start = self.pos;
                            self.inc(1);
                            if (self.remainStartsWith("alse")) {
                                try ctx.resolve(.{ .boolean = false }, f_start, "False");
                                self.inc(4);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("ALSE")) {
                                try ctx.resolve(.{ .boolean = false }, f_start, "FALSE");
                                self.inc(4);
                                continue :next self.next();
                            }
                            try ctx.appendSource(c, f_start);
                            continue :next self.next();
                        },

                        '-' => {
                            try ctx.appendSource('-', self.pos);
                            self.inc(1);
                            try ctx.tryResolveNumber(self, .negative);
                            continue :next self.next();
                        },

                        '+' => {
                            try ctx.appendSource('+', self.pos);
                            self.inc(1);
                            try ctx.tryResolveNumber(self, .positive);
                            continue :next self.next();
                        },

                        '0'...'9' => {
                            try ctx.tryResolveNumber(self, .other);
                            continue :next self.next();
                        },

                        '.' => {
                            switch (self.peek(1)) {
                                'n',
                                'N',
                                'i',
                                'I',
                                => {
                                    try ctx.appendSource('.', self.pos);
                                    self.inc(1);
                                    try ctx.tryResolveNumber(self, .dot);
                                    continue :next self.next();
                                },

                                else => {
                                    try ctx.tryResolveNumber(self, .other);
                                    continue :next self.next();
                                },
                            }
                        },

                        else => {
                            const start = self.pos;
                            self.inc(1);
                            try ctx.appendSource(c, start);
                            continue :next self.next();
                        },
                    }
                },
            }
        }

        const ScanBlockHeaderError = error{UnexpectedCharacter};
        const ScanBlockHeaderResult = struct { Indent.Indicator, Chomp };

        // positions parser at the first line break, or eof
        fn scanBlockHeader(self: *@This()) ScanBlockHeaderError!ScanBlockHeaderResult {
            // consume c-b-block-header

            var indent_indicator: ?Indent.Indicator = null;
            var chomp: ?Chomp = null;

            next: switch (self.next()) {
                0 => {
                    return .{
                        indent_indicator orelse .default,
                        chomp orelse .default,
                    };
                },
                '1'...'9' => |digit| {
                    if (indent_indicator != null) {
                        return error.UnexpectedCharacter;
                    }

                    indent_indicator = @enumFromInt(digit - '0');
                    self.inc(1);
                    continue :next self.next();
                },
                '-' => {
                    if (chomp != null) {
                        return error.UnexpectedCharacter;
                    }

                    chomp = .strip;
                    self.inc(1);
                    continue :next self.next();
                },
                '+' => {
                    if (chomp != null) {
                        return error.UnexpectedCharacter;
                    }

                    chomp = .keep;
                    self.inc(1);
                    continue :next self.next();
                },

                ' ',
                '\t',
                => {
                    self.inc(1);

                    self.skipSWhite();

                    if (self.next() == '#') {
                        self.inc(1);
                        while (!self.isBCharOrEof()) {
                            self.inc(1);
                        }
                    }

                    continue :next self.next();
                },

                '\r' => {
                    if (self.peek(1) == '\n') {
                        self.inc(1);
                    }
                    continue :next '\n';
                },

                '\n' => {

                    // the first newline is always excluded from a literal
                    self.inc(1);

                    if (self.next() == '\t') {
                        // tab for indentation
                        return error.UnexpectedCharacter;
                    }

                    return .{
                        indent_indicator orelse .default,
                        chomp orelse .default,
                    };
                },

                else => {
                    return error.UnexpectedCharacter;
                },
            }
        }

        const ScanLiteralScalarError = OOM || error{
            UnexpectedCharacter,
            InvalidIndentation,
        };

        fn scanAutoIndentedLiteralScalar(self: *@This(), chomp: Chomp, folded: bool, start: Pos, line: Line) ScanLiteralScalarError!Token(enc) {
            const LiteralScalarCtx = struct {
                chomp: Chomp,
                leading_newlines: usize,
                text: std.array_list.Managed(enc.unit()),
                start: Pos,
                content_indent: Indent,
                previous_indent: Indent,
                max_leading_indent: Indent,
                line: Line,
                folded: bool,

                pub fn done(ctx: *@This(), was_eof: bool) OOM!Token(enc) {
                    switch (ctx.chomp) {
                        .keep => {
                            if (was_eof) {
                                try ctx.text.appendNTimes('\n', ctx.leading_newlines + 1);
                            } else if (ctx.text.items.len != 0) {
                                try ctx.text.appendNTimes('\n', ctx.leading_newlines);
                            }
                        },
                        .clip => {
                            if (was_eof or ctx.text.items.len != 0) {
                                try ctx.text.append('\n');
                            }
                        },
                        .strip => {
                            // no trailing newlines
                        },
                    }

                    return .scalar(.{
                        .start = ctx.start,
                        .indent = ctx.content_indent,
                        .line = ctx.line,
                        .resolved = .{
                            .data = .{ .string = .{ .list = ctx.text } },
                            .multiline = true,
                        },
                    });
                }

                const AppendError = OOM || error{UnexpectedCharacter};

                pub fn append(ctx: *@This(), c: enc.unit()) AppendError!void {
                    if (ctx.text.items.len == 0) {
                        if (ctx.content_indent.isLessThan(ctx.max_leading_indent)) {
                            return error.UnexpectedCharacter;
                        }
                    }
                    switch (ctx.folded) {
                        true => {
                            switch (ctx.leading_newlines) {
                                0 => {
                                    try ctx.text.append(c);
                                },
                                1 => {
                                    if (ctx.previous_indent == ctx.content_indent) {
                                        try ctx.text.appendSlice(&.{ ' ', c });
                                    } else {
                                        try ctx.text.appendSlice(&.{ '\n', c });
                                    }
                                    ctx.leading_newlines = 0;
                                },
                                else => {
                                    // leading_newlines because -1 for '\n\n' and +1 for c
                                    try ctx.text.ensureUnusedCapacity(ctx.leading_newlines);
                                    ctx.text.appendNTimesAssumeCapacity('\n', ctx.leading_newlines - 1);
                                    ctx.text.appendAssumeCapacity(c);
                                    ctx.leading_newlines = 0;
                                },
                            }
                        },
                        false => {
                            try ctx.text.ensureUnusedCapacity(ctx.leading_newlines + 1);
                            ctx.text.appendNTimesAssumeCapacity('\n', ctx.leading_newlines);
                            ctx.text.appendAssumeCapacity(c);
                            ctx.leading_newlines = 0;
                        },
                    }
                }
            };

            var ctx: LiteralScalarCtx = .{
                .chomp = chomp,
                .text = .init(self.allocator),
                .folded = folded,
                .start = start,
                .line = line,

                .leading_newlines = 0,
                .content_indent = .none,
                .previous_indent = .none,
                .max_leading_indent = .none,
            };

            ctx.content_indent, const first = next: switch (self.next()) {
                0 => {
                    return .scalar(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = line,
                        .resolved = .{
                            .data = .{ .string = .{ .list = .init(self.allocator) } },
                            .multiline = true,
                        },
                    });
                },

                '\r' => {
                    if (self.peek(1) == '\n') {
                        self.inc(1);
                    }
                    continue :next '\n';
                },
                '\n' => {
                    self.newline();
                    self.inc(1);
                    if (self.next() == '\t') {
                        // tab for indentation
                        return error.UnexpectedCharacter;
                    }
                    ctx.leading_newlines += 1;
                    continue :next self.next();
                },

                ' ' => {
                    var indent: Indent = .from(1);
                    self.inc(1);
                    while (self.next() == ' ') {
                        indent.inc(1);
                        self.inc(1);
                    }

                    if (ctx.max_leading_indent.isLessThan(indent)) {
                        ctx.max_leading_indent = indent;
                    }

                    self.line_indent = indent;

                    continue :next self.next();
                },

                else => |c| {
                    break :next .{ self.line_indent, c };
                },
            };

            ctx.previous_indent = ctx.content_indent;

            next: switch (first) {
                0 => {
                    return ctx.done(true);
                },

                '\r' => {
                    if (self.peek(1) == '\n') {
                        self.inc(1);
                    }
                    continue :next '\n';
                },
                '\n' => {
                    ctx.leading_newlines += 1;
                    self.newline();
                    self.inc(1);
                    newlines: switch (self.next()) {
                        '\r' => {
                            if (self.peek(1) == '\n') {
                                self.inc(1);
                            }
                            continue :newlines '\n';
                        },
                        '\n' => {
                            ctx.leading_newlines += 1;
                            self.newline();
                            self.inc(1);
                            if (self.next() == '\t') {
                                // tab for indentation
                                return error.UnexpectedCharacter;
                            }
                            continue :newlines self.next();
                        },
                        ' ' => {
                            var indent: Indent = .from(0);
                            while (self.next() == ' ') {
                                indent.inc(1);
                                if (ctx.content_indent.isLessThan(indent)) {
                                    switch (folded) {
                                        true => {
                                            switch (ctx.leading_newlines) {
                                                0 => {
                                                    try ctx.text.append(' ');
                                                },
                                                else => {
                                                    try ctx.text.ensureUnusedCapacity(ctx.leading_newlines + 1);
                                                    ctx.text.appendNTimesAssumeCapacity('\n', ctx.leading_newlines);
                                                    ctx.text.appendAssumeCapacity(' ');
                                                    ctx.leading_newlines = 0;
                                                },
                                            }
                                        },
                                        else => {
                                            try ctx.text.ensureUnusedCapacity(ctx.leading_newlines + 1);
                                            ctx.text.appendNTimesAssumeCapacity('\n', ctx.leading_newlines);
                                            ctx.leading_newlines = 0;
                                            ctx.text.appendAssumeCapacity(' ');
                                        },
                                    }
                                }
                                self.inc(1);
                            }

                            if (ctx.content_indent.isLessThan(indent)) {
                                ctx.previous_indent = self.line_indent;
                            }
                            self.line_indent = indent;

                            continue :next self.next();
                        },
                        else => |c| continue :next c,
                    }
                },

                '-' => {
                    if (self.line_indent == .none and self.remainStartsWith("---") and self.isAnyOrEofAt(" \t\n\r", 3)) {
                        return ctx.done(false);
                    }

                    if (self.block_indents.get()) |block_indent| {
                        if (self.line_indent.isLessThanOrEqual(block_indent)) {
                            return ctx.done(false);
                        }
                    } else if (self.line_indent.isLessThan(ctx.content_indent)) {
                        return ctx.done(false);
                    }

                    try ctx.append('-');

                    self.inc(1);
                    continue :next self.next();
                },

                '.' => {
                    if (self.line_indent == .none and self.remainStartsWith("...") and self.isAnyOrEofAt(" \t\n\r", 3)) {
                        return ctx.done(false);
                    }

                    if (self.block_indents.get()) |block_indent| {
                        if (self.line_indent.isLessThanOrEqual(block_indent)) {
                            return ctx.done(false);
                        }
                    } else if (self.line_indent.isLessThan(ctx.content_indent)) {
                        return ctx.done(false);
                    }

                    try ctx.append('.');

                    self.inc(1);
                    continue :next self.next();
                },

                else => |c| {
                    if (self.block_indents.get()) |block_indent| {
                        if (self.line_indent.isLessThanOrEqual(block_indent)) {
                            return ctx.done(false);
                        }
                    } else if (self.line_indent.isLessThan(ctx.content_indent)) {
                        return ctx.done(false);
                    }

                    try ctx.append(c);

                    self.inc(1);
                    continue :next self.next();
                },
            }
        }

        fn scanLiteralScalar(self: *@This()) ScanLiteralScalarError!Token(enc) {
            defer self.whitespace_buf.clearRetainingCapacity();

            const start = self.pos;
            const line = self.line;

            const indent_indicator, const chomp = try self.scanBlockHeader();
            _ = indent_indicator;

            return self.scanAutoIndentedLiteralScalar(chomp, false, start, line);
        }

        fn scanFoldedScalar(self: *@This()) ScanLiteralScalarError!Token(enc) {
            const start = self.pos;
            const line = self.line;

            const indent_indicator, const chomp = try self.scanBlockHeader();
            _ = indent_indicator;

            return self.scanAutoIndentedLiteralScalar(chomp, true, start, line);
        }

        const ScanSingleQuotedScalarError = OOM || error{
            UnexpectedCharacter,
            UnexpectedDocumentStart,
            UnexpectedDocumentEnd,
        };

        fn scanSingleQuotedScalar(self: *@This()) ScanSingleQuotedScalarError!Token(enc) {
            const start = self.pos;
            const scalar_line = self.line;
            const scalar_indent = self.line_indent;

            var text: std.array_list.Managed(enc.unit()) = .init(self.allocator);

            var nl = false;

            next: switch (self.next()) {
                0 => return error.UnexpectedCharacter,

                '.' => {
                    if (nl and self.line_indent == .none and self.remainStartsWith("...") and self.isSWhiteOrBCharAt(3)) {
                        return error.UnexpectedDocumentEnd;
                    }
                    nl = false;
                    try text.append('.');
                    self.inc(1);
                    continue :next self.next();
                },

                '-' => {
                    if (nl and self.line_indent == .none and self.remainStartsWith("---") and self.isSWhiteOrBCharAt(3)) {
                        return error.UnexpectedDocumentStart;
                    }
                    nl = false;
                    try text.append('-');
                    self.inc(1);
                    continue :next self.next();
                },

                '\r',
                '\n',
                => {
                    nl = true;
                    self.newline();
                    self.inc(1);
                    switch (self.foldLines()) {
                        0 => try text.append(' '),
                        else => |lines| try text.appendNTimes('\n', lines),
                    }
                    if (self.block_indents.get()) |block_indent| {
                        if (self.line_indent.isLessThanOrEqual(block_indent)) {
                            return error.UnexpectedCharacter;
                        }
                    }
                    continue :next self.next();
                },

                ' ',
                '\t',
                => {
                    nl = false;
                    const off = self.pos;
                    self.inc(1);
                    self.skipSWhite();
                    if (!self.isBChar()) {
                        try text.appendSlice(self.slice(off, self.pos));
                    }
                    continue :next self.next();
                },

                '\'' => {
                    nl = false;
                    self.inc(1);
                    if (self.next() == '\'') {
                        try text.append('\'');
                        self.inc(1);
                        continue :next self.next();
                    }

                    return .scalar(.{
                        .start = start,
                        .indent = scalar_indent,
                        .line = scalar_line,
                        .resolved = .{
                            // TODO: wrong!
                            .multiline = self.line != scalar_line,
                            .data = .{
                                .string = .{
                                    .list = text,
                                },
                            },
                        },
                    });
                },
                else => |c| {
                    nl = false;
                    try text.append(c);
                    self.inc(1);
                    continue :next self.next();
                },
            }
        }

        const ScanDoubleQuotedScalarError = OOM || error{
            UnexpectedCharacter,
            UnexpectedDocumentStart,
            UnexpectedDocumentEnd,
        };

        fn scanDoubleQuotedScalar(self: *@This()) ScanDoubleQuotedScalarError!Token(enc) {
            const start = self.pos;
            const scalar_line = self.line;
            const scalar_indent = self.line_indent;
            var text: std.array_list.Managed(enc.unit()) = .init(self.allocator);

            var nl = false;

            next: switch (self.next()) {
                0 => return error.UnexpectedCharacter,

                '.' => {
                    if (nl and self.line_indent == .none and self.remainStartsWith("...") and self.isSWhiteOrBCharAt(3)) {
                        return error.UnexpectedDocumentEnd;
                    }
                    nl = false;
                    try text.append('.');
                    self.inc(1);
                    continue :next self.next();
                },

                '-' => {
                    if (nl and self.line_indent == .none and self.remainStartsWith("---") and self.isSWhiteOrBCharAt(3)) {
                        return error.UnexpectedDocumentStart;
                    }
                    nl = false;
                    try text.append('-');
                    self.inc(1);
                    continue :next self.next();
                },

                '\r',
                '\n',
                => {
                    self.newline();
                    self.inc(1);
                    switch (self.foldLines()) {
                        0 => try text.append(' '),
                        else => |lines| try text.appendNTimes('\n', lines),
                    }

                    if (self.block_indents.get()) |block_indent| {
                        if (self.line_indent.isLessThanOrEqual(block_indent)) {
                            return error.UnexpectedCharacter;
                        }
                    }
                    nl = true;
                    continue :next self.next();
                },

                ' ',
                '\t',
                => {
                    nl = false;
                    const off = self.pos;
                    self.inc(1);
                    self.skipSWhite();
                    if (!self.isBChar()) {
                        try text.appendSlice(self.slice(off, self.pos));
                    }
                    continue :next self.next();
                },

                '"' => {
                    nl = false;
                    self.inc(1);
                    return .scalar(.{
                        .start = start,
                        .indent = scalar_indent,
                        .line = scalar_line,
                        .resolved = .{
                            // TODO: wrong!
                            .multiline = self.line != scalar_line,
                            .data = .{
                                .string = .{ .list = text },
                            },
                        },
                    });
                },

                '\\' => {
                    nl = false;
                    self.inc(1);
                    switch (self.next()) {
                        '\r',
                        '\n',
                        => {
                            self.newline();
                            self.inc(1);
                            const lines = self.foldLines();

                            if (self.block_indents.get()) |block_indent| {
                                if (self.line_indent.isLessThanOrEqual(block_indent)) {
                                    return error.UnexpectedCharacter;
                                }
                            }

                            try text.appendNTimes('\n', lines);
                            self.skipSWhite();
                            continue :next self.next();
                        },

                        // escaped whitespace
                        ' ' => try text.append(' '),
                        '\t' => try text.append('\t'),

                        '0' => try text.append(0),
                        'a' => try text.append(0x7),
                        'b' => try text.append(0x8),
                        't' => try text.append('\t'),
                        'n' => try text.append('\n'),
                        'v' => try text.append(0x0b),
                        'f' => try text.append(0xc),
                        'r' => try text.append(0xd),
                        'e' => try text.append(0x1b),
                        '"' => try text.append('"'),
                        '/' => try text.append('/'),
                        '\\' => try text.append('\\'),

                        'N' => switch (enc) {
                            .utf8 => try text.appendSlice(&.{ 0xc2, 0x85 }),
                            .utf16 => try text.append(0x0085),
                            .latin1 => return error.UnexpectedCharacter,
                        },
                        '_' => switch (enc) {
                            .utf8 => try text.appendSlice(&.{ 0xc2, 0xa0 }),
                            .utf16 => try text.append(0x00a0),
                            .latin1 => return error.UnexpectedCharacter,
                        },
                        'L' => switch (enc) {
                            .utf8 => try text.appendSlice(&.{ 0xe2, 0x80, 0xa8 }),
                            .utf16 => try text.append(0x2028),
                            .latin1 => return error.UnexpectedCharacter,
                        },
                        'P' => switch (enc) {
                            .utf8 => try text.appendSlice(&.{ 0xe2, 0x80, 0xa9 }),
                            .utf16 => try text.append(0x2029),
                            .latin1 => return error.UnexpectedCharacter,
                        },

                        'x' => try self.decodeHexCodePoint(.x, &text),
                        'u' => try self.decodeHexCodePoint(.u, &text),
                        'U' => try self.decodeHexCodePoint(.U, &text),

                        else => return error.UnexpectedCharacter,
                    }

                    self.inc(1);
                    continue :next self.next();
                },

                else => |c| {
                    nl = false;
                    try text.append(c);
                    self.inc(1);
                    continue :next self.next();
                },
            }
        }

        const Escape = enum(u8) {
            x = 2,
            u = 4,
            U = 8,

            pub fn characters(comptime escape: @This()) u8 {
                return @intFromEnum(escape);
            }

            pub fn cp(comptime escape: @This()) type {
                return switch (escape) {
                    .x => u8,
                    .u => u16,
                    .U => u32,
                };
            }
        };

        const DecodeHexCodePointError = OOM || error{UnexpectedCharacter};

        // TODO: should this append replacement characters instead of erroring?
        fn decodeHexCodePoint(
            self: *@This(),
            comptime escape: Escape,
            text: *std.array_list.Managed(enc.unit()),
        ) DecodeHexCodePointError!void {
            var value: escape.cp() = 0;
            for (0..@intFromEnum(escape)) |_| {
                self.inc(1);
                const digit = self.next();
                const num: u8 = switch (digit) {
                    '0'...'9' => @intCast(digit - '0'),
                    'a'...'f' => @intCast(digit - 'a' + 10),
                    'A'...'F' => @intCast(digit - 'A' + 10),
                    else => return error.UnexpectedCharacter,
                };

                value = value * 16 + num;
            }

            const cp = std.math.cast(u21, value) orelse {
                return error.UnexpectedCharacter;
            };

            switch (enc) {
                .utf8 => {
                    var buf: [4]u8 = undefined;
                    const len = std.unicode.utf8Encode(cp, &buf) catch {
                        return error.UnexpectedCharacter;
                    };
                    try text.appendSlice(buf[0..len]);
                },
                .utf16 => {
                    const len = std.unicode.utf16CodepointSequenceLength(cp) catch {
                        return error.UnexpectedCharacter;
                    };

                    switch (len) {
                        1 => try text.append(@intCast(cp)),
                        2 => {
                            const val = cp - 0x10000;
                            const high: u16 = 0xd800 + @as(u16, @intCast(val >> 10));
                            const low: u16 = 0xdc00 + @as(u16, @intCast(val & 0x3ff));
                            try text.appendSlice(&.{ high, low });
                        },
                        else => return error.UnexpectedCharacter,
                    }
                },
                .latin1 => {
                    if (cp > 0xff) {
                        return error.UnexpectedCharacter;
                    }
                    try text.append(@intCast(cp));
                },
            }
        }

        const ScanTagPropertyError = error{ UnresolvedTagHandle, UnexpectedCharacter };

        // c-ns-tag-property
        fn scanTagProperty(self: *@This()) ScanTagPropertyError!Token(enc) {
            const start = self.pos;

            // already at '!'
            self.inc(1);

            switch (self.next()) {
                0,
                ' ',
                '\t',
                '\n',
                '\r',
                => {
                    // c-non-specific-tag
                    // primary tag handle

                    return .tag(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                        .tag = .non_specific,
                    });
                },

                '<' => {
                    // c-verbatim-tag

                    self.inc(1);

                    const prefix = prefix: {
                        if (self.next() == '!') {
                            self.inc(1);
                            var range = self.stringRange();
                            self.skipNsUriChars();
                            break :prefix range.end();
                        }

                        if (self.isNsTagChar()) |len| {
                            var range = self.stringRange();
                            self.inc(len);
                            self.skipNsUriChars();
                            break :prefix range.end();
                        }

                        return error.UnexpectedCharacter;
                    };

                    try self.trySkipChar('>');

                    return .tag(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                        .tag = .{ .verbatim = prefix },
                    });
                },

                '!' => {
                    // c-ns-shorthand-tag
                    // secondary tag handle

                    self.inc(1);
                    var range = self.stringRange();
                    try self.trySkipNsTagChars();

                    // s-separate
                    switch (self.next()) {
                        0,
                        ' ',
                        '\t',
                        '\r',
                        '\n',
                        => {},

                        ',',
                        '[',
                        ']',
                        '{',
                        '}',
                        => {
                            switch (self.context.get()) {
                                .block_out,
                                .block_in,
                                => {
                                    return error.UnexpectedCharacter;
                                },
                                .flow_in,
                                .flow_key,
                                => {},
                            }
                        },
                        else => {
                            return error.UnexpectedCharacter;
                        },
                    }

                    const shorthand = range.end();

                    const tag: NodeTag = tag: {
                        const s = shorthand.slice(self.input);
                        if (std.mem.eql(enc.unit(), s, "bool")) {
                            break :tag .bool;
                        }
                        if (std.mem.eql(enc.unit(), s, "int")) {
                            break :tag .int;
                        }
                        if (std.mem.eql(enc.unit(), s, "float")) {
                            break :tag .float;
                        }
                        if (std.mem.eql(enc.unit(), s, "null")) {
                            break :tag .null;
                        }
                        if (std.mem.eql(enc.unit(), s, "str")) {
                            break :tag .str;
                        }

                        break :tag .{ .unknown = shorthand };
                    };

                    return .tag(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                        .tag = tag,
                    });
                },

                else => {
                    // c-ns-shorthand-tag
                    // named tag handle

                    var range = self.stringRange();
                    try self.trySkipNsWordChars();
                    var handle_or_shorthand = range.end();

                    if (self.next() == '!') {
                        self.inc(1);
                        if (!self.tag_handles.contains(handle_or_shorthand.slice(self.input))) {
                            self.pos = range.off;
                            return error.UnresolvedTagHandle;
                        }

                        range = self.stringRange();
                        try self.trySkipNsTagChars();
                        const shorthand = range.end();

                        return .tag(.{
                            .start = start,
                            .indent = self.line_indent,
                            .line = self.line,
                            .tag = .{ .unknown = shorthand },
                        });
                    }

                    // primary
                    self.skipNsTagChars();
                    handle_or_shorthand = range.end();

                    const tag: NodeTag = tag: {
                        const s = handle_or_shorthand.slice(self.input);
                        if (std.mem.eql(enc.unit(), s, "bool")) {
                            break :tag .bool;
                        }
                        if (std.mem.eql(enc.unit(), s, "int")) {
                            break :tag .int;
                        }
                        if (std.mem.eql(enc.unit(), s, "float")) {
                            break :tag .float;
                        }
                        if (std.mem.eql(enc.unit(), s, "null")) {
                            break :tag .null;
                        }
                        if (std.mem.eql(enc.unit(), s, "str")) {
                            break :tag .str;
                        }

                        break :tag .{ .unknown = handle_or_shorthand };
                    };

                    return .tag(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                        .tag = tag,
                    });
                },
            }
        }

        // fn scanIndentation(self: *@This()) void {}

        const ScanError = OOM || error{
            UnexpectedToken,
            UnexpectedCharacter,
            UnresolvedTagHandle,
            UnexpectedDocumentStart,
            UnexpectedDocumentEnd,
            InvalidIndentation,
            // ScalarTypeMismatch,
        };

        const ScanOptions = struct {
            /// Used by compact sequences. We need to add
            /// the parent indentation
            /// ```
            /// - - - - one # indent = 4 + 2
            ///       - two
            /// ```
            additional_parent_indent: ?Indent = null,

            /// If a scalar is scanned, this tag might be used.
            tag: NodeTag = .none,

            /// The scanner only counts indentation after a newline
            /// (or in compact collections). First scan needs to
            /// count indentation.
            first_scan: bool = false,

            outside_context: bool = false,
        };

        fn scan(self: *@This(), opts: ScanOptions) ScanError!void {
            const ScanCtx = struct {
                parser: *Parser(enc),

                count_indentation: bool,
                additional_parent_indent: ?Indent,

                pub fn scanWhitespace(ctx: *@This(), comptime ws: enc.unit()) ScanError!enc.unit() {
                    const parser = ctx.parser;

                    switch (ws) {
                        '\r' => {
                            if (parser.peek(1) == '\n') {
                                parser.inc(1);
                            }

                            return '\n';
                        },
                        '\n' => {
                            ctx.count_indentation = true;
                            ctx.additional_parent_indent = null;

                            parser.newline();
                            parser.inc(1);
                            return parser.next();
                        },
                        ' ' => {
                            var total: usize = 1;
                            parser.inc(1);

                            while (parser.next() == ' ') {
                                parser.inc(1);
                                total += 1;
                            }

                            if (ctx.count_indentation) {
                                const parent_indent = if (ctx.additional_parent_indent) |additional| additional.cast() else 0;
                                parser.line_indent = .from(total + parent_indent);
                            }

                            ctx.count_indentation = false;

                            return parser.next();
                        },
                        '\t' => {
                            if (ctx.count_indentation and ctx.parser.context.get() == .block_in) {
                                return error.UnexpectedCharacter;
                            }
                            ctx.count_indentation = false;
                            parser.inc(1);
                            return parser.next();
                        },
                        else => @compileError("unexpected character"),
                    }
                }
            };

            var ctx: ScanCtx = .{
                .parser = self,

                .count_indentation = opts.first_scan or opts.additional_parent_indent != null,
                .additional_parent_indent = opts.additional_parent_indent,
            };

            const previous_token_line = self.token.line;

            self.token = next: switch (self.next()) {
                0 => {
                    const start = self.pos;
                    break :next .eof(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                    });
                },
                '-' => {
                    const start = self.pos;

                    if (self.line_indent == .none and self.remainStartsWith(enc.literal("---")) and self.isSWhiteOrBCharOrEofAt(3)) {
                        self.inc(3);
                        break :next .documentStart(.{
                            .start = start,
                            .indent = self.line_indent,
                            .line = self.line,
                        });
                    }

                    switch (self.peek(1)) {

                        // eof
                        // b-char
                        // s-white
                        0,
                        '\n',
                        '\r',
                        ' ',
                        '\t',
                        => {
                            self.inc(1);

                            switch (self.context.get()) {
                                .block_out,
                                .block_in,
                                => {},
                                .flow_in,
                                .flow_key,
                                => {
                                    self.token.start = start;
                                    return unexpectedToken();
                                },
                            }

                            break :next .sequenceEntry(.{
                                .start = start,
                                .indent = self.line_indent,
                                .line = self.line,
                            });
                        },

                        // c-flow-indicator
                        ',',
                        ']',
                        '[',
                        '}',
                        '{',
                        => {
                            switch (self.context.get()) {
                                .flow_in,
                                .flow_key,
                                => {
                                    self.inc(1);

                                    self.token = .sequenceEntry(.{
                                        .start = start,
                                        .indent = self.line_indent,
                                        .line = self.line,
                                    });

                                    return unexpectedToken();
                                },
                                .block_in,
                                .block_out,
                                => {
                                    //  scanPlainScalar
                                },
                            }
                        },

                        else => {
                            //  scanPlainScalar
                        },
                    }

                    break :next try self.scanPlainScalar(opts);
                },
                '.' => {
                    const start = self.pos;

                    if (self.line_indent == .none and self.remainStartsWith(enc.literal("...")) and self.isSWhiteOrBCharOrEofAt(3)) {
                        self.inc(3);
                        break :next .documentEnd(.{
                            .start = start,
                            .indent = self.line_indent,
                            .line = self.line,
                        });
                    }

                    break :next try self.scanPlainScalar(opts);
                },
                '?' => {
                    const start = self.pos;

                    switch (self.peek(1)) {
                        // eof
                        // s-white
                        // b-char
                        0,
                        ' ',
                        '\t',
                        '\n',
                        '\r',
                        => {
                            self.inc(1);
                            break :next .mappingKey(.{
                                .start = start,
                                .indent = self.line_indent,
                                .line = self.line,
                            });
                        },

                        // c-flow-indicator
                        ',',
                        ']',
                        '[',
                        '}',
                        '{',
                        => {
                            switch (self.context.get()) {
                                .block_in,
                                .block_out,
                                => {
                                    // scanPlainScalar
                                },
                                .flow_in,
                                .flow_key,
                                => {
                                    self.inc(1);
                                    break :next .mappingKey(.{
                                        .start = start,
                                        .indent = self.line_indent,
                                        .line = self.line,
                                    });
                                },
                            }
                        },

                        else => {
                            // scanPlainScalar
                        },
                    }

                    break :next try self.scanPlainScalar(opts);
                },
                ':' => {
                    const start = self.pos;

                    switch (self.peek(1)) {
                        0,
                        ' ',
                        '\t',
                        '\n',
                        '\r',
                        => {
                            self.inc(1);
                            break :next .mappingValue(.{
                                .start = start,
                                .indent = self.line_indent,
                                .line = self.line,
                            });
                        },

                        // c-flow-indicator
                        ',',
                        ']',
                        '[',
                        '}',
                        '{',
                        => {
                            // scanPlainScalar
                            switch (self.context.get()) {
                                .block_in,
                                .block_out,
                                => {
                                    // scanPlainScalar
                                },
                                .flow_in,
                                .flow_key,
                                => {
                                    self.inc(1);
                                    break :next .mappingValue(.{
                                        .start = start,
                                        .indent = self.line_indent,
                                        .line = self.line,
                                    });
                                },
                            }
                        },

                        else => {
                            switch (self.context.get()) {
                                .block_in,
                                .block_out,
                                .flow_in,
                                => {
                                    // scanPlainScalar
                                },
                                .flow_key,
                                => {
                                    self.inc(1);
                                    break :next .mappingValue(.{
                                        .start = start,
                                        .indent = self.line_indent,
                                        .line = self.line,
                                    });
                                },
                            }
                        },
                    }

                    break :next try self.scanPlainScalar(opts);
                },
                ',' => {
                    const start = self.pos;

                    switch (self.context.get()) {
                        .flow_in,
                        .flow_key,
                        => {
                            self.inc(1);
                            break :next .collectEntry(.{
                                .start = start,
                                .indent = self.line_indent,
                                .line = self.line,
                            });
                        },
                        .block_in,
                        .block_out,
                        => {},
                    }

                    break :next try self.scanPlainScalar(opts);
                },
                '[' => {
                    const start = self.pos;

                    self.inc(1);
                    break :next .sequenceStart(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                    });
                },
                ']' => {
                    const start = self.pos;

                    self.inc(1);
                    break :next .sequenceEnd(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                    });
                },
                '{' => {
                    const start = self.pos;

                    self.inc(1);
                    break :next .mappingStart(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                    });
                },
                '}' => {
                    const start = self.pos;

                    self.inc(1);
                    break :next .mappingEnd(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                    });
                },
                '#' => {
                    const start = self.pos;

                    const prev = if (start == .zero) 0 else self.input[start.cast() - 1];
                    switch (prev) {
                        0,
                        ' ',
                        '\t',
                        '\n',
                        '\r',
                        => {},
                        else => {
                            // TODO: prove this is unreachable
                            return error.UnexpectedCharacter;
                        },
                    }

                    self.inc(1);
                    while (!self.isBCharOrEof()) {
                        self.inc(1);
                    }
                    continue :next self.next();
                },
                '&' => {
                    const start = self.pos;

                    self.inc(1);

                    var range = self.stringRange();
                    try self.trySkipNsAnchorChars();

                    const anchor: Token(enc) = .anchor(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                        .name = range.end(),
                    });

                    switch (self.next()) {
                        0,
                        ' ',
                        '\t',
                        '\n',
                        '\r',
                        => {
                            break :next anchor;
                        },

                        ',',
                        ']',
                        '[',
                        '}',
                        '{',
                        => {
                            switch (self.context.get()) {
                                .block_in,
                                .block_out,
                                => {
                                    // error.UnexpectedCharacter
                                },
                                .flow_key,
                                .flow_in,
                                => {
                                    break :next anchor;
                                },
                            }
                        },

                        else => {},
                    }

                    return error.UnexpectedCharacter;
                },
                '*' => {
                    const start = self.pos;

                    self.inc(1);

                    var range = self.stringRange();
                    try self.trySkipNsAnchorChars();

                    const alias: Token(enc) = .alias(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                        .name = range.end(),
                    });

                    switch (self.next()) {
                        0,
                        ' ',
                        '\t',
                        '\n',
                        '\r',
                        => {
                            break :next alias;
                        },

                        ',',
                        ']',
                        '[',
                        '}',
                        '{',
                        => {
                            switch (self.context.get()) {
                                .block_in,
                                .block_out,
                                => {
                                    // error.UnexpectedCharacter
                                },
                                .flow_key,
                                .flow_in,
                                => {
                                    break :next alias;
                                },
                            }
                        },

                        else => {},
                    }

                    return error.UnexpectedCharacter;
                },
                '!' => {
                    break :next try self.scanTagProperty();
                },
                '|' => {
                    const start = self.pos;

                    switch (self.context.get()) {
                        .block_out,
                        .block_in,
                        => {
                            self.inc(1);
                            break :next try self.scanLiteralScalar();
                        },
                        .flow_in,
                        .flow_key,
                        => {},
                    }
                    self.token.start = start;
                    return unexpectedToken();
                },
                '>' => {
                    const start = self.pos;

                    switch (self.context.get()) {
                        .block_out,
                        .block_in,
                        => {
                            self.inc(1);
                            break :next try self.scanFoldedScalar();
                        },
                        .flow_in,
                        .flow_key,
                        => {},
                    }
                    self.token.start = start;
                    return unexpectedToken();
                },
                '\'' => {
                    self.inc(1);
                    break :next try self.scanSingleQuotedScalar();
                },
                '"' => {
                    self.inc(1);
                    break :next try self.scanDoubleQuotedScalar();
                },
                '%' => {
                    const start = self.pos;

                    self.inc(1);
                    break :next .directive(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                    });
                },
                '@', '`' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .reserved(.{
                        .start = start,
                        .indent = self.line_indent,
                        .line = self.line,
                    });
                    return unexpectedToken();
                },

                inline '\r',
                '\n',
                ' ',
                '\t',
                => |ws| continue :next try ctx.scanWhitespace(ws),

                else => {
                    break :next try self.scanPlainScalar(opts);
                },
            };

            switch (self.context.get()) {
                .block_out,
                .block_in,
                => {},
                .flow_in,
                .flow_key,
                => {
                    if (self.block_indents.get()) |block_indent| {
                        if (!opts.outside_context and self.token.line != previous_token_line and self.token.indent.isLessThanOrEqual(block_indent)) {
                            return unexpectedToken();
                        }
                    }
                },
            }
        }

        fn isChar(self: *@This(), char: enc.unit()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return self.input[pos.cast()] == char;
            }
            return false;
        }

        fn trySkipChar(self: *@This(), char: enc.unit()) error{UnexpectedCharacter}!void {
            if (!self.isChar(char)) {
                return error.UnexpectedCharacter;
            }
            self.inc(1);
        }

        fn isNsWordChar(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return chars.isNsWordChar(self.input[pos.cast()]);
            }
            return false;
        }

        /// ns-char
        fn isNsChar(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return chars.isNsChar(self.input[pos.cast()]);
            }
            return false;
        }

        fn skipNsChars(self: *@This()) void {
            while (self.isNsChar()) {
                self.inc(1);
            }
        }

        fn trySkipNsChars(self: *@This()) error{UnexpectedCharacter}!void {
            if (!self.isNsChar()) {
                return error.UnexpectedCharacter;
            }
            self.skipNsChars();
        }

        fn isNsTagChar(self: *@This()) ?u8 {
            const r = self.remain();
            return chars.isNsTagChar(r);
        }

        fn skipNsTagChars(self: *@This()) void {
            while (self.isNsTagChar()) |len| {
                self.inc(len);
            }
        }

        fn trySkipNsTagChars(self: *@This()) error{UnexpectedCharacter}!void {
            const first_len = self.isNsTagChar() orelse {
                return error.UnexpectedCharacter;
            };
            self.inc(first_len);
            while (self.isNsTagChar()) |len| {
                self.inc(len);
            }
        }

        fn isNsAnchorChar(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return chars.isNsAnchorChar(self.input[pos.cast()]);
            }
            return false;
        }

        fn trySkipNsAnchorChars(self: *@This()) error{UnexpectedCharacter}!void {
            if (!self.isNsAnchorChar()) {
                return error.UnexpectedCharacter;
            }
            self.inc(1);
            while (self.isNsAnchorChar()) {
                self.inc(1);
            }
        }

        /// s-l-comments
        ///
        /// positions `pos` on the next newline, or eof. Errors
        fn trySkipToNewLine(self: *@This()) error{UnexpectedCharacter}!void {
            var whitespace = false;

            if (self.isSWhite()) {
                whitespace = true;
                self.skipSWhite();
            }

            if (self.isChar('#')) {
                if (!whitespace) {
                    return error.UnexpectedCharacter;
                }
                self.inc(1);
                while (!self.isChar('\n') and !self.isChar('\r')) {
                    self.inc(1);
                }
            }

            if (self.pos.isLessThan(self.input.len) and !self.isChar('\n') and !self.isChar('\r')) {
                return error.UnexpectedCharacter;
            }
        }

        fn isSWhiteOrBCharOrEofAt(self: *@This(), n: usize) bool {
            const pos = self.pos.add(n);
            if (pos.isLessThan(self.input.len)) {
                const c = self.input[pos.cast()];
                return c == ' ' or c == '\t' or c == '\n' or c == '\r';
            }
            return true;
        }

        fn isSWhiteOrBCharAt(self: *@This(), n: usize) bool {
            const pos = self.pos.add(n);
            if (pos.isLessThan(self.input.len)) {
                const c = self.input[pos.cast()];
                return c == ' ' or c == '\t' or c == '\n' or c == '\r';
            }
            return false;
        }

        fn isAnyAt(self: *const @This(), values: []const enc.unit(), n: usize) bool {
            const pos = self.pos.add(n);
            if (pos.isLessThan(self.input.len)) {
                return std.mem.indexOfScalar(enc.unit(), values, self.input[pos.cast()]) != null;
            }
            return false;
        }

        fn isAnyOrEofAt(self: *const @This(), values: []const enc.unit(), n: usize) bool {
            const pos = self.pos.add(n);
            if (pos.isLessThan(self.input.len)) {
                return std.mem.indexOfScalar(enc.unit(), values, self.input[pos.cast()]) != null;
            }
            return false;
        }

        fn isEof(self: *const @This()) bool {
            return !self.pos.isLessThan(self.input.len);
        }

        fn isEofAt(self: *const @This(), n: usize) bool {
            return !self.pos.add(n).isLessThan(self.input.len);
        }

        fn isBChar(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return chars.isBChar(self.input[pos.cast()]);
            }
            return false;
        }

        fn isBCharOrEof(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return chars.isBChar(self.input[pos.cast()]);
            }
            return true;
        }

        fn isSWhiteOrBCharOrEof(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                const c = self.input[pos.cast()];
                return chars.isSWhite(c) or chars.isBChar(c);
            }
            return true;
        }

        fn isSWhite(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return chars.isSWhite(self.input[pos.cast()]);
            }
            return false;
        }

        fn isSWhiteAt(self: *@This(), n: usize) bool {
            const pos = self.pos.add(n);
            if (pos.isLessThan(self.input.len)) {
                return chars.isSWhite(self.input[pos.cast()]);
            }
            return false;
        }

        fn skipSWhite(self: *@This()) void {
            while (self.isSWhite()) {
                self.inc(1);
            }
        }

        fn trySkipSWhite(self: *@This()) error{UnexpectedCharacter}!void {
            if (!self.isSWhite()) {
                return error.UnexpectedCharacter;
            }
            while (self.isSWhite()) {
                self.inc(1);
            }
        }

        fn isNsHexDigit(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return chars.isNsHexDigit(self.input[pos.cast()]);
            }
            return false;
        }

        fn isNsDecDigit(self: *@This()) bool {
            const pos = self.pos;
            if (pos.isLessThan(self.input.len)) {
                return chars.isNsDecDigit(self.input[pos.cast()]);
            }
            return false;
        }

        fn skipNsDecDigits(self: *@This()) void {
            while (self.isNsDecDigit()) {
                self.inc(1);
            }
        }

        fn trySkipNsDecDigits(self: *@This()) error{UnexpectedCharacter}!void {
            if (!self.isNsDecDigit()) {
                return error.UnexpectedCharacter;
            }
            self.skipNsDecDigits();
        }

        fn skipNsWordChars(self: *@This()) void {
            while (self.isNsWordChar()) {
                self.inc(1);
            }
        }

        fn trySkipNsWordChars(self: *@This()) error{UnexpectedCharacter}!void {
            if (!self.isNsWordChar()) {
                return error.UnexpectedCharacter;
            }
            self.skipNsWordChars();
        }

        fn isNsUriChar(self: *@This()) bool {
            const r = self.remain();
            return chars.isNsUriChar(r);
        }

        fn skipNsUriChars(self: *@This()) void {
            while (self.isNsUriChar()) {
                self.inc(1);
            }
        }

        fn trySkipNsUriChars(self: *@This()) error{UnexpectedCharacter}!void {
            if (!self.isNsUriChar()) {
                return error.UnexpectedCharacter;
            }
            self.skipNsUriChars();
        }

        fn stringRange(self: *const @This()) String.Range.Start {
            return .{
                .off = self.pos,
                .parser = self,
            };
        }

        fn stringBuilder(self: *@This()) String.Builder {
            return .{
                .parser = self,
                .str = .{ .range = .{ .off = .zero, .end = .zero } },
            };
        }

        pub const String = union(enum) {
            range: Range,
            list: std.array_list.Managed(enc.unit()),

            pub fn init(data: anytype) String {
                return switch (@TypeOf(data)) {
                    Range => .{ .range = data },
                    std.array_list.Managed(enc.unit()) => .{ .list = data },
                    else => @compileError("unexpected type"),
                };
            }

            pub fn deinit(self: *@This()) void {
                switch (self.*) {
                    .range => {},
                    .list => |*list| list.deinit(),
                }
            }

            pub fn slice(self: *const @This(), input: []const enc.unit()) []const enc.unit() {
                return switch (self.*) {
                    .range => |range| range.slice(input),
                    .list => |list| list.items,
                };
            }

            pub fn len(self: *const @This()) usize {
                return switch (self.*) {
                    .range => |*range| range.len(),
                    .list => |*list| list.items.len,
                };
            }

            pub fn isEmpty(self: *const @This()) bool {
                return switch (self.*) {
                    .range => |*range| range.isEmpty(),
                    .list => |*list| list.items.len == 0,
                };
            }

            pub fn eql(l: *const @This(), r: []const u8, input: []const enc.unit()) bool {
                const l_slice = l.slice(input);
                return std.mem.eql(enc.unit(), l_slice, r);
            }

            pub const Builder = struct {
                parser: *Parser(enc),
                str: String,

                pub fn appendSource(self: *@This(), unit: enc.unit(), pos: Pos) OOM!void {
                    try self.drainWhitespace();

                    if (comptime Environment.ci_assert) {
                        const actual = self.parser.input[pos.cast()];
                        bun.assert(actual == unit);
                    }
                    switch (self.str) {
                        .range => |*range| {
                            if (range.isEmpty()) {
                                range.off = pos;
                                range.end = pos;
                            }

                            bun.assert(range.end == pos);

                            range.end = pos.add(1);
                        },
                        .list => |*list| {
                            try list.append(unit);
                        },
                    }
                }

                fn drainWhitespace(self: *@This()) OOM!void {
                    const parser = self.parser;
                    defer parser.whitespace_buf.clearRetainingCapacity();

                    for (parser.whitespace_buf.items) |ws| {
                        switch (ws) {
                            .source => |source| {
                                if (comptime Environment.ci_assert) {
                                    const actual = self.parser.input[source.pos.cast()];
                                    bun.assert(actual == source.unit);
                                }

                                switch (self.str) {
                                    .range => |*range| {
                                        if (range.isEmpty()) {
                                            range.off = source.pos;
                                            range.end = source.pos;
                                        }

                                        bun.assert(range.end == source.pos);

                                        range.end = source.pos.add(1);
                                    },
                                    .list => |*list| {
                                        try list.append(source.unit);
                                    },
                                }
                            },
                            .new => |unit| {
                                switch (self.str) {
                                    .range => |range| {
                                        var list: std.array_list.Managed(enc.unit()) = try .initCapacity(parser.allocator, range.len() + 1);
                                        list.appendSliceAssumeCapacity(range.slice(parser.input));
                                        list.appendAssumeCapacity(unit);
                                        self.str = .{ .list = list };
                                    },
                                    .list => |*list| {
                                        try list.append(unit);
                                    },
                                }
                            },
                        }
                    }
                }

                pub fn appendSourceWhitespace(self: *@This(), unit: enc.unit(), pos: Pos) OOM!void {
                    try self.parser.whitespace_buf.append(.{ .source = .{ .unit = unit, .pos = pos } });
                }

                pub fn appendWhitespace(self: *@This(), unit: enc.unit()) OOM!void {
                    try self.parser.whitespace_buf.append(.{ .new = unit });
                }

                pub fn appendWhitespaceNTimes(self: *@This(), unit: enc.unit(), n: usize) OOM!void {
                    try self.parser.whitespace_buf.appendNTimes(.{ .new = unit }, n);
                }

                pub fn appendSourceSlice(self: *@This(), off: Pos, end: Pos) OOM!void {
                    try self.drainWhitespace();
                    switch (self.str) {
                        .range => |*range| {
                            if (range.isEmpty()) {
                                range.off = off;
                                range.end = off;
                            }

                            bun.assert(range.end == off);

                            range.end = end;
                        },
                        .list => |*list| {
                            try list.appendSlice(self.parser.slice(off, end));
                        },
                    }
                }

                pub fn appendExpectedSourceSlice(self: *@This(), off: Pos, end: Pos, expected: []const enc.unit()) OOM!void {
                    try self.drainWhitespace();

                    if (comptime Environment.ci_assert) {
                        const actual = self.parser.slice(off, end);
                        bun.assert(std.mem.eql(enc.unit(), actual, expected));
                    }

                    switch (self.str) {
                        .range => |*range| {
                            if (range.isEmpty()) {
                                range.off = off;
                                range.end = off;
                            }

                            bun.assert(range.end == off);

                            range.end = end;
                        },
                        .list => |*list| {
                            try list.appendSlice(self.parser.slice(off, end));
                        },
                    }
                }

                pub fn append(self: *@This(), unit: enc.unit()) OOM!void {
                    try self.drainWhitespace();

                    const parser = self.parser;

                    switch (self.str) {
                        .range => |range| {
                            var list: std.array_list.Managed(enc.unit()) = try .initCapacity(parser.allocator, range.len() + 1);
                            list.appendSliceAssumeCapacity(range.slice(parser.input));
                            list.appendAssumeCapacity(unit);
                            self.str = .{ .list = list };
                        },
                        .list => |*list| {
                            try list.append(unit);
                        },
                    }
                }

                pub fn appendSlice(self: *@This(), str: []const enc.unit()) OOM!void {
                    if (str.len == 0) {
                        return;
                    }

                    try self.drainWhitespace();

                    const parser = self.parser;

                    switch (self.str) {
                        .range => |range| {
                            var list: std.array_list.Managed(enc.unit()) = try .initCapacity(parser.allocator, range.len() + str.len);
                            list.appendSliceAssumeCapacity(self.str.range.slice(parser.input));
                            list.appendSliceAssumeCapacity(str);
                            self.str = .{ .list = list };
                        },
                        .list => |*list| {
                            try list.appendSlice(str);
                        },
                    }
                }

                pub fn appendNTimes(self: *@This(), unit: enc.unit(), n: usize) OOM!void {
                    if (n == 0) {
                        return;
                    }

                    try self.drainWhitespace();

                    const parser = self.parser;

                    switch (self.str) {
                        .range => |range| {
                            var list: std.array_list.Managed(enc.unit()) = try .initCapacity(parser.allocator, range.len() + n);
                            list.appendSliceAssumeCapacity(self.str.range.slice(parser.input));
                            list.appendNTimesAssumeCapacity(unit, n);
                            self.str = .{ .list = list };
                        },
                        .list => |*list| {
                            try list.appendNTimes(unit, n);
                        },
                    }
                }

                pub fn len(this: *const @This()) usize {
                    return this.str.len();
                }

                pub fn done(self: *@This()) String {
                    self.parser.whitespace_buf.clearRetainingCapacity();
                    return self.str;
                }
            };

            pub const Range = struct {
                off: Pos,
                end: Pos,

                pub const Start = struct {
                    off: Pos,
                    parser: *const Parser(enc),

                    pub fn end(this: *const @This()) Range {
                        return .{
                            .off = this.off,
                            .end = this.parser.pos,
                        };
                    }
                };

                pub fn isEmpty(this: *const @This()) bool {
                    return this.off == this.end;
                }

                pub fn len(this: *const @This()) usize {
                    return this.end.cast() - this.off.cast();
                }

                pub fn slice(this: *const Range, input: []const enc.unit()) []const enc.unit() {
                    return input[this.off.cast()..this.end.cast()];
                }
            };
        };

        pub const NodeTag = union(enum) {
            /// ''
            none,

            /// '!'
            non_specific,

            /// '!!bool'
            bool,
            /// '!!int'
            int,
            /// '!!float'
            float,
            /// '!!null'
            null,
            /// '!!str'
            str,

            /// '!<...>'
            verbatim: String.Range,

            /// '!!unknown'
            unknown: String.Range,

            pub fn resolveNull(this: NodeTag, loc: logger.Loc) Expr {
                return switch (this) {
                    .none,
                    .bool,
                    .int,
                    .float,
                    .null,
                    .verbatim,
                    .unknown,
                    => .init(E.Null, .{}, loc),

                    // non-specific tags become seq, map, or str
                    .non_specific,
                    .str,
                    => .init(E.String, .{}, loc),
                };
            }
        };

        pub const NodeScalar = union(enum) {
            null,
            boolean: bool,
            number: f64,
            string: String,

            pub fn toExpr(this: *const NodeScalar, pos: Pos, input: []const enc.unit()) Expr {
                return switch (this.*) {
                    .null => .init(E.Null, .{}, pos.loc()),
                    .boolean => |value| .init(E.Boolean, .{ .value = value }, pos.loc()),
                    .number => |value| .init(E.Number, .{ .value = value }, pos.loc()),
                    .string => |value| .init(E.String, .{ .data = value.slice(input) }, pos.loc()),
                };
            }
        };

        // pub const Node = struct {
        //     start: Pos,
        //     data: Data,

        //     pub const Data = union(enum) {
        //         scalar: Scalar,
        //         sequence: *Sequence,
        //         mapping: *Mapping,

        //         // TODO: we will probably need an alias
        //         // node that is resolved later. problem:
        //         // ```
        //         // &map
        //         // hi:
        //         //  hello: *map
        //         // ```
        //         // map needs to be put in the map before
        //         // we finish parsing the map node, because
        //         // 'hello' value needs to be able to find it.
        //         //
        //         // alias: Alias,
        //     };

        //     pub const Sequence = struct {
        //         list: std.array_list.Managed(Node),

        //         pub fn init(allocator: std.mem.Allocator) Sequence {
        //             return .{ .list = .init(allocator) };
        //         }

        //         pub fn count(this: *const Sequence) usize {
        //             return this.list.items.len;
        //         }

        //         pub fn slice(this: *const Sequence) []const Node {
        //             return this.list.items;
        //         }
        //     };

        //     pub const Mapping = struct {
        //         keys: std.array_list.Managed(Node),
        //         values: std.array_list.Managed(Node),

        //         pub fn init(allocator: std.mem.Allocator) Mapping {
        //             return .{ .keys = .init(allocator), .values = .init(allocator) };
        //         }

        //         pub fn append(this: *Mapping, key: Node, value: Node) OOM!void {
        //             try this.keys.append(key);
        //             try this.values.append(value);
        //         }

        //         pub fn count(this: *const Mapping) usize {
        //             return this.keys.items.len;
        //         }
        //     };

        //     // pub const Alias = struct {
        //     //     anchor_id: Anchors.Id,
        //     // };

        //     pub fn isNull(this: *const Node) bool {
        //         return switch (this.data) {
        //             .scalar => |s| s == .null,
        //             else => false,
        //         };
        //     }

        //     pub fn @"null"(start: Pos) Node {
        //         return .{
        //             .start = start,
        //             .data = .{ .scalar = .null },
        //         };
        //     }

        //     pub fn boolean(start: Pos, value: bool) Node {
        //         return .{
        //             .start = start,
        //             .data = .{ .scalar = .{ .boolean = value } },
        //         };
        //     }

        //     pub fn number(start: Pos, value: f64) Node {
        //         return .{
        //             .start = start,
        //             .data = .{ .scalar = .{ .number = value } },
        //         };
        //     }

        //     pub fn string(start: Pos, str: String) Node {
        //         return .{
        //             .start = start,
        //             .data = .{ .scalar = .{ .string = .{ .text = str } } },
        //         };
        //     }

        //     // pub fn alias(start: Pos, anchor_id: Anchors.Id) Node {
        //     //     return .{
        //     //         .start = start,
        //     //         .data = .{ .alias = .{ .anchor_id = anchor_id } },
        //     //     };
        //     // }

        //     pub fn init(allocator: std.mem.Allocator, start: Pos, data: anytype) OOM!Node {
        //         return .{
        //             .start = start,
        //             .data = switch (@TypeOf(data)) {
        //                 Scalar => .{ .scalar = data },
        //                 Sequence => sequence: {
        //                     const seq = try allocator.create(Sequence);
        //                     seq.* = data;
        //                     break :sequence .{ .sequence = seq };
        //                 },
        //                 Mapping => mapping: {
        //                     const map = try allocator.create(Mapping);
        //                     map.* = data;
        //                     break :mapping .{ .mapping = map };
        //                 },
        //                 // Alias => .{ .alias = data },
        //                 else => @compileError("unexpected data type"),
        //             },
        //         };
        //     }
        // };

        const Directive = union(enum) {
            yaml,
            tag: Directive.Tag,
            reserved: String.Range,

            /// '%TAG <handle> <prefix>'
            pub const Tag = struct {
                handle: Handle,
                prefix: Prefix,

                pub const Handle = union(enum) {
                    /// '!name!'
                    named: String.Range,
                    /// '!!'
                    secondary,
                    /// '!'
                    primary,
                };

                pub const Prefix = union(enum) {
                    /// c-ns-local-tag-prefix
                    /// '!my-prefix'
                    local: String.Range,
                    /// ns-global-tag-prefix
                    /// 'tag:example.com,2000:app/'
                    global: String.Range,
                };
            };
        };

        pub const Document = struct {
            directives: std.array_list.Managed(Directive),
            root: Expr,

            pub fn deinit(this: *Document) void {
                this.directives.deinit();
            }
        };

        pub const Stream = struct {
            docs: std.array_list.Managed(Document),
            input: []const enc.unit(),
        };

        // fn Printer(comptime Writer: type) type {
        //     return struct {
        //         input: []const enc.unit(),
        //         stream: Stream,
        //         indent: Indent,
        //         writer: Writer,

        //         allocator: std.mem.Allocator,

        //         pub fn print(this: *@This()) Writer.Error!void {
        //             if (this.stream.docs.items.len == 0) {
        //                 return;
        //             }

        //             var first = true;

        //             for (this.stream.docs.items) |doc| {
        //                 try this.printDocument(&doc, first);
        //                 try this.writer.writeByte('\n');
        //                 first = false;

        //                 if (this.stream.docs.items.len != 1) {
        //                     try this.writer.writeAll("...\n");
        //                 }
        //             }
        //         }

        //         pub fn printDocument(this: *@This(), doc: *const Document, first: bool) Writer.Error!void {
        //             for (doc.directives.items) |directive| {
        //                 switch (directive) {
        //                     .yaml => {
        //                         try this.writer.writeAll("%YAML X.X\n");
        //                     },
        //                     .tag => |tag| {
        //                         try this.writer.print("%TAG {s} {s}{s}\n", .{
        //                             switch (tag.handle) {
        //                                 .named => |name| name.slice(this.input),
        //                                 .secondary => "!!",
        //                                 .primary => "!",
        //                             },
        //                             if (tag.prefix == .local) "!" else "",
        //                             switch (tag.prefix) {
        //                                 .local => |local| local.slice(this.input),
        //                                 .global => |global| global.slice(this.input),
        //                             },
        //                         });
        //                     },
        //                     .reserved => |reserved| {
        //                         try this.writer.print("%{s}\n", .{reserved.slice(this.input)});
        //                     },
        //                 }
        //             }

        //             if (!first or doc.directives.items.len != 0) {
        //                 try this.writer.writeAll("---\n");
        //             }

        //             try this.printNode(doc.root);
        //         }

        //         pub fn printString(this: *@This(), str: []const enc.unit()) Writer.Error!void {
        //             const quote = quote: {
        //                 if (true) {
        //                     break :quote true;
        //                 }
        //                 if (str.len == 0) {
        //                     break :quote true;
        //                 }

        //                 if (str[str.len - 1] == ' ') {
        //                     break :quote true;
        //                 }

        //                 for (str, 0..) |c, i| {
        //                     if (i == 0) {
        //                         switch (c) {
        //                             '&',
        //                             '*',
        //                             '?',
        //                             '|',
        //                             '-',
        //                             '<',
        //                             '>',
        //                             '=',
        //                             '!',
        //                             '%',
        //                             '@',

        //                             ' ',
        //                             => break :quote true,
        //                             else => {},
        //                         }
        //                         continue;
        //                     }

        //                     switch (c) {
        //                         '{',
        //                         '}',
        //                         '[',
        //                         ']',
        //                         ',',
        //                         '#',
        //                         '`',
        //                         '"',
        //                         '\'',
        //                         '\\',
        //                         '\t',
        //                         '\n',
        //                         '\r',
        //                         => break :quote true,

        //                         0x00...0x06,
        //                         0x0e...0x1a,
        //                         0x1c...0x1f,
        //                         => break :quote true,

        //                         't', 'T' => {
        //                             const r = str[i + 1 ..];
        //                             if (std.mem.startsWith(enc.unit(), r, "rue")) {
        //                                 break :quote true;
        //                             }
        //                             if (std.mem.startsWith(enc.unit(), r, "RUE")) {
        //                                 break :quote true;
        //                             }
        //                         },

        //                         'f', 'F' => {
        //                             const r = str[i + 1 ..];
        //                             if (std.mem.startsWith(enc.unit(), r, "alse")) {
        //                                 break :quote true;
        //                             }
        //                             if (std.mem.startsWith(enc.unit(), r, "ALSE")) {
        //                                 break :quote true;
        //                             }
        //                         },

        //                         '~' => break :quote true,
        //                         // 'n', 'N' => break :quote true,
        //                         // 'y', 'Y' => break :quote true,

        //                         'o', 'O' => {
        //                             const r = str[i + 1 ..];
        //                             if (std.mem.startsWith(enc.unit(), r, "ff")) {
        //                                 break :quote true;
        //                             }
        //                             if (std.mem.startsWith(enc.unit(), r, "FF")) {
        //                                 break :quote true;
        //                             }
        //                         },

        //                         // TODO: is this one needed
        //                         '.' => break :quote true,

        //                         // '0'...'9' => break :quote true,

        //                         else => {},
        //                     }
        //                 }

        //                 break :quote false;
        //             };

        //             if (!quote) {
        //                 try this.writer.writeAll(str);
        //                 return;
        //             }

        //             try this.writer.writeByte('"');

        //             var i: usize = 0;
        //             while (i < str.len) : (i += 1) {
        //                 const c = str[i];

        //                 // Check for UTF-8 multi-byte sequences for line/paragraph separators
        //                 if (enc == .utf8 and c == 0xe2 and i + 2 < str.len) {
        //                     if (str[i + 1] == 0x80) {
        //                         if (str[i + 2] == 0xa8) {
        //                             // U+2028 Line separator
        //                             try this.writer.writeAll("\\L");
        //                             i += 2;
        //                             continue;
        //                         } else if (str[i + 2] == 0xa9) {
        //                             // U+2029 Paragraph separator
        //                             try this.writer.writeAll("\\P");
        //                             i += 2;
        //                             continue;
        //                         }
        //                     }
        //                 }

        //                 // Check for UTF-8 sequences for NEL (U+0085) and NBSP (U+00A0)
        //                 if (enc == .utf8 and c == 0xc2 and i + 1 < str.len) {
        //                     if (str[i + 1] == 0x85) {
        //                         // U+0085 Next line
        //                         try this.writer.writeAll("\\N");
        //                         i += 1;
        //                         continue;
        //                     } else if (str[i + 1] == 0xa0) {
        //                         // U+00A0 Non-breaking space
        //                         try this.writer.writeAll("\\_");
        //                         i += 1;
        //                         continue;
        //                     }
        //                 }

        //                 const escaped = switch (c) {
        //                     // Standard escape sequences
        //                     '\\' => "\\\\",
        //                     '"' => "\\\"",
        //                     '\n' => "\\n",

        //                     // Control characters that need hex escaping
        //                     0x00 => "\\0",
        //                     0x01 => "\\x01",
        //                     0x02 => "\\x02",
        //                     0x03 => "\\x03",
        //                     0x04 => "\\x04",
        //                     0x05 => "\\x05",
        //                     0x06 => "\\x06",
        //                     0x07 => "\\a", // Bell
        //                     0x08 => "\\b", // Backspace
        //                     0x09 => "\\t", // Tab
        //                     0x0b => "\\v", // Vertical tab
        //                     0x0c => "\\f", // Form feed
        //                     0x0d => "\\r", // Carriage return
        //                     0x0e => "\\x0e",
        //                     0x0f => "\\x0f",
        //                     0x10 => "\\x10",
        //                     0x11 => "\\x11",
        //                     0x12 => "\\x12",
        //                     0x13 => "\\x13",
        //                     0x14 => "\\x14",
        //                     0x15 => "\\x15",
        //                     0x16 => "\\x16",
        //                     0x17 => "\\x17",
        //                     0x18 => "\\x18",
        //                     0x19 => "\\x19",
        //                     0x1a => "\\x1a",
        //                     0x1b => "\\e", // Escape
        //                     0x1c => "\\x1c",
        //                     0x1d => "\\x1d",
        //                     0x1e => "\\x1e",
        //                     0x1f => "\\x1f",
        //                     0x7f => "\\x7f", // Delete

        //                     0x20...0x21,
        //                     0x23...0x5b,
        //                     0x5d...0x7e,
        //                     => &.{c},

        //                     0x80...std.math.maxInt(enc.unit()) => &.{c},
        //                 };

        //                 try this.writer.writeAll(escaped);
        //             }

        //             try this.writer.writeByte('"');
        //         }

        //         pub fn printNode(this: *@This(), node: Node) Writer.Error!void {
        //             switch (node.data) {
        //                 .scalar => |scalar| {
        //                     switch (scalar) {
        //                         .null => {
        //                             try this.writer.writeAll("null");
        //                         },
        //                         .boolean => |boolean| {
        //                             try this.writer.print("{}", .{boolean});
        //                         },
        //                         .number => |number| {
        //                             try this.writer.print("{d}", .{number});
        //                         },
        //                         .string => |string| {
        //                             try this.printString(string.slice(this.input));
        //                         },
        //                     }
        //                 },
        //                 .sequence => |sequence| {
        //                     for (sequence.list.items, 0..) |item, i| {
        //                         try this.writer.writeAll("- ");
        //                         this.indent.inc(2);
        //                         try this.printNode(item);
        //                         this.indent.dec(2);

        //                         if (i + 1 != sequence.list.items.len) {
        //                             try this.writer.writeByte('\n');
        //                             try this.printIndent();
        //                         }
        //                     }
        //                 },
        //                 .mapping => |mapping| {
        //                     for (mapping.keys.items, mapping.values.items, 0..) |key, value, i| {
        //                         try this.printNode(key);
        //                         try this.writer.writeAll(": ");

        //                         this.indent.inc(1);

        //                         if (value.data == .mapping) {
        //                             try this.writer.writeByte('\n');
        //                             try this.printIndent();
        //                         }

        //                         try this.printNode(value);

        //                         this.indent.dec(1);

        //                         if (i + 1 != mapping.keys.items.len) {
        //                             try this.writer.writeByte('\n');
        //                             try this.printIndent();
        //                         }
        //                     }
        //                 },
        //             }
        //         }

        //         pub fn printIndent(this: *@This()) Writer.Error!void {
        //             for (0..this.indent.cast()) |_| {
        //                 try this.writer.writeByte(' ');
        //             }
        //         }
        //     };
        // }
    };
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

    // fn Unit(comptime T: type) type {
    //     return enum(T) {

    //         _,
    //     };
    // }

    pub fn literal(comptime encoding: Encoding, comptime str: []const u8) []const encoding.unit() {
        return switch (encoding) {
            .latin1 => str,
            .utf8 => str,
            .utf16 => std.unicode.utf8ToUtf16LeStringLiteral(str),
        };
    }

    pub fn chars(comptime encoding: Encoding) type {
        return struct {
            pub fn isNsDecDigit(c: encoding.unit()) bool {
                return switch (c) {
                    '0'...'9' => true,
                    else => false,
                };
            }
            pub fn isNsHexDigit(c: encoding.unit()) bool {
                return switch (c) {
                    '0'...'9',
                    'a'...'f',
                    'A'...'F',
                    => true,
                    else => false,
                };
            }
            pub fn isNsWordChar(c: encoding.unit()) bool {
                return switch (c) {
                    '0'...'9',
                    'A'...'Z',
                    'a'...'z',
                    '-',
                    => true,
                    else => false,
                };
            }
            pub fn isNsChar(c: encoding.unit()) bool {
                return switch (comptime encoding) {
                    .utf8 => switch (c) {
                        ' ', '\t' => false,
                        '\n', '\r' => false,

                        // TODO: exclude BOM

                        ' ' + 1...0x7e => true,

                        0x80...0xff => true,

                        // TODO: include 0x85, [0xa0 - 0xd7ff], [0xe000 - 0xfffd], [0x010000 - 0x10ffff]
                        else => false,
                    },
                    .utf16 => switch (c) {
                        ' ', '\t' => false,
                        '\n', '\r' => false,
                        // TODO: exclude BOM

                        ' ' + 1...0x7e => true,

                        0x85 => true,

                        0xa0...0xd7ff => true,
                        0xe000...0xfffd => true,

                        // TODO: include 0x85, [0xa0 - 0xd7ff], [0xe000 - 0xfffd], [0x010000 - 0x10ffff]
                        else => false,
                    },
                    .latin1 => switch (c) {
                        ' ', '\t' => false,
                        '\n', '\r' => false,

                        // TODO: !!!!
                        else => true,
                    },
                };
            }

            // null if false
            // length if true
            pub fn isNsTagChar(cs: []const encoding.unit()) ?u8 {
                if (cs.len == 0) {
                    return null;
                }

                return switch (cs[0]) {
                    '#',
                    ';',
                    '/',
                    '?',
                    ':',
                    '@',
                    '&',
                    '=',
                    '+',
                    '$',
                    '_',
                    '.',
                    '~',
                    '*',
                    '\'',
                    '(',
                    ')',
                    => 1,

                    '!',
                    ',',
                    '[',
                    ']',
                    '{',
                    '}',
                    => null,

                    else => |c| {
                        if (c == '%') {
                            if (cs.len > 2 and isNsHexDigit(cs[1]) and isNsHexDigit(cs[2])) {
                                return 3;
                            }
                        }

                        return if (isNsWordChar(c)) 1 else null;
                    },
                };
            }
            pub fn isBChar(c: encoding.unit()) bool {
                return c == '\n' or c == '\r';
            }
            pub fn isSWhite(c: encoding.unit()) bool {
                return c == ' ' or c == '\t';
            }
            pub fn isNsPlainSafeOut(c: encoding.unit()) bool {
                return isNsChar(c);
            }
            pub fn isNsPlainSafeIn(c: encoding.unit()) bool {
                // TODO: inline isCFlowIndicator
                return isNsChar(c) and !isCFlowIndicator(c);
            }
            pub fn isCIndicator(c: encoding.unit()) bool {
                return switch (c) {
                    '-',
                    '?',
                    ':',
                    ',',
                    '[',
                    ']',
                    '{',
                    '}',
                    '#',
                    '&',
                    '*',
                    '!',
                    '|',
                    '>',
                    '\'',
                    '"',
                    '%',
                    '@',
                    '`',
                    => true,
                    else => false,
                };
            }
            pub fn isCFlowIndicator(c: encoding.unit()) bool {
                return switch (c) {
                    ',',
                    '[',
                    ']',
                    '{',
                    '}',
                    => true,
                    else => false,
                };
            }
            pub fn isNsUriChar(cs: []const encoding.unit()) bool {
                if (cs.len == 0) {
                    return false;
                }
                return switch (cs[0]) {
                    '#',
                    ';',
                    '/',
                    '?',
                    ':',
                    '@',
                    '&',
                    '=',
                    '+',
                    '$',
                    ',',
                    '_',
                    '.',
                    '!',
                    '~',
                    '*',
                    '\'',
                    '(',
                    ')',
                    '[',
                    ']',
                    => true,

                    else => |c| {
                        if (c == '%') {
                            if (cs.len > 2 and isNsHexDigit(cs[1]) and isNsHexDigit(cs[2])) {
                                return true;
                            }
                        }

                        return isNsWordChar(c);
                    },
                };
            }
            pub fn isNsAnchorChar(c: encoding.unit()) bool {
                // TODO: inline isCFlowIndicator
                return isNsChar(c) and !isCFlowIndicator(c);
            }
        };
    }
};

pub fn Token(comptime encoding: Encoding) type {
    const NodeTag = Parser(encoding).NodeTag;
    const NodeScalar = Parser(encoding).NodeScalar;
    const String = Parser(encoding).String;

    return struct {
        start: Pos,
        indent: Indent,
        line: Line,
        data: Data,

        const TokenInit = struct {
            start: Pos,
            indent: Indent,
            line: Line,
        };

        pub fn eof(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .eof,
            };
        }

        pub fn sequenceEntry(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .sequence_entry,
            };
        }

        pub fn mappingKey(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .mapping_key,
            };
        }

        pub fn mappingValue(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .mapping_value,
            };
        }

        pub fn collectEntry(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .collect_entry,
            };
        }

        pub fn sequenceStart(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .sequence_start,
            };
        }

        pub fn sequenceEnd(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .sequence_end,
            };
        }

        pub fn mappingStart(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .mapping_start,
            };
        }

        pub fn mappingEnd(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .mapping_end,
            };
        }

        const AnchorInit = struct {
            start: Pos,
            indent: Indent,
            line: Line,
            name: String.Range,
        };

        pub fn anchor(init: AnchorInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .{ .anchor = init.name },
            };
        }

        const AliasInit = struct {
            start: Pos,
            indent: Indent,
            line: Line,
            name: String.Range,
        };

        pub fn alias(init: AliasInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .{ .alias = init.name },
            };
        }

        const TagInit = struct {
            start: Pos,
            indent: Indent,
            line: Line,
            tag: NodeTag,
        };

        pub fn tag(init: TagInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .{ .tag = init.tag },
            };
        }

        pub fn directive(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .directive,
            };
        }

        pub fn reserved(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .reserved,
            };
        }

        pub fn documentStart(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .document_start,
            };
        }

        pub fn documentEnd(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .document_end,
            };
        }

        const ScalarInit = struct {
            start: Pos,
            indent: Indent,
            line: Line,

            resolved: Scalar,
        };

        pub fn scalar(init: ScalarInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .{ .scalar = init.resolved },
            };
        }

        pub const Data = union(enum) {
            eof,
            /// `-`
            sequence_entry,
            /// `?`
            mapping_key,
            /// `:`
            mapping_value,
            /// `,`
            collect_entry,
            /// `[`
            sequence_start,
            /// `]`
            sequence_end,
            /// `{`
            mapping_start,
            /// `}`
            mapping_end,
            /// `&`
            anchor: String.Range,
            /// `*`
            alias: String.Range,
            /// `!`
            tag: NodeTag,
            /// `%`
            directive,
            /// `@` or `\``
            reserved,
            /// `---`
            document_start,
            /// `...`
            document_end,

            // might be single or double quoted, or unquoted.
            // might be a literal or folded literal ('|' or '>')
            scalar: Scalar,
        };

        pub const Scalar = struct {
            data: NodeScalar,
            multiline: bool,
        };
    };
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const OOM = bun.OOM;
const logger = bun.logger;

const ast = bun.ast;
const E = ast.E;
const Expr = ast.Expr;
const G = ast.G;
