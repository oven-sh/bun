const std = @import("std");
const bun = @import("bun");
const logger = bun.logger;
const js_ast = bun.ast;
const Expr = js_ast.Expr;
const E = js_ast.E;

pub const YAML = struct {
    // Mock implementation - just returns an empty object for now
    pub fn parse(source_: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator, redact_logs: bool) !Expr {
        _ = source_;
        _ = log;
        _ = allocator;
        _ = redact_logs;

        // Return an empty object, similar to how TOML handles empty files
        return Expr{ .loc = logger.Loc{ .start = 0 }, .data = Expr.init(E.Object, E.Object{}, logger.Loc.Empty).data };
    }
};

const OOM = std.mem.Allocator.Error;

pub fn parse(comptime encoding: Encoding, allocator: std.mem.Allocator, input: []const encoding.unit()) Parser(encoding).ParseResult {
    var parser: Parser(encoding) = .init(allocator, input);

    const stream = parser.parse() catch |err| {
        return .fail(err, &parser);
    };

    return .success(stream, &parser);
}

pub fn print(comptime encoding: Encoding, allocator: std.mem.Allocator, stream: Parser(encoding).Stream, writer: anytype) @TypeOf(writer).Error!void {
    var printer: Parser(encoding).Printer(@TypeOf(writer)) = .{
        .input = stream.input,
        .stream = stream,
        .indent = .none,
        .writer = writer,
        .allocator = allocator,
    };

    try printer.print();
}

// pub fn parseDocument(allocator: std.mem.Allocator, input: []const u8) Parser(.utf8).Document {
//     const stream = parse(allocator, input);

//     if (stream.docs.items.len > 1) {
//         @panic("expected one document!!!");
//     }

//     return stream.docs.items[0];
// }

pub const Context = enum {
    block_out,
    block_in,
    // block_key,
    // flow_out,
    flow_in,
    // flow_key,

    pub const Stack = struct {
        list: std.ArrayList(Context),

        pub fn init(allocator: std.mem.Allocator) Stack {
            return .{ .list = .init(allocator) };
        }

        pub fn set(this: *@This(), context: Context) OOM!void {
            try this.list.append(context);
        }

        pub fn unset(this: *@This(), context: Context) void {
            const prev_context = this.list.pop();
            std.debug.assert(prev_context != null and prev_context.? == context);
        }

        pub fn get(this: *const @This()) Context {
            // top level context is always BLOCK-OUT
            return this.list.getLastOrNull() orelse .block_out;
        }
    };
};

pub const Chomp = enum {
    /// remove all trailing newlines
    strip,
    /// exclude the last trailing newline (default)
    clip,
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

    pub fn inc(indent: *Indent, num: usize) void {
        indent.* = @enumFromInt(@intFromEnum(indent.*) + num);
    }

    pub fn dec(indent: *Indent, num: usize) void {
        indent.* = @enumFromInt(@intFromEnum(indent.*) - num);
    }

    pub fn add(indent: Indent, num: usize) Indent {
        return @enumFromInt(@intFromEnum(indent) + num);
    }

    pub fn sub(indent: Indent, num: usize) Indent {
        return @enumFromInt(@intFromEnum(indent) - num);
    }

    pub fn cmp(l: Indent, r: Indent) std.math.Order {
        if (@intFromEnum(l) > @intFromEnum(r)) return .gt;
        if (@intFromEnum(l) < @intFromEnum(r)) return .lt;
        return .eq;
    }

    pub const Indicator = enum(u8) {
        /// trim leading indentation (spaces) (default)
        none = 0,
        @"1",
        @"2",
        @"3",
        @"4",
        @"5",
        @"6",
        @"7",
        @"8",
        @"9",

        pub fn get(indicator: Indicator) u8 {
            return @intFromEnum(indicator);
        }
    };

    pub const Stack = struct {
        list: std.ArrayList(Indent),

        pub fn init(allocator: std.mem.Allocator) Stack {
            return .{ .list = .init(allocator) };
        }

        pub fn push(this: *@This(), indent: Indent) OOM!void {
            try this.list.append(indent);
        }

        pub fn pop(this: *@This()) void {
            _ = this.list.pop();
        }

        pub fn get(this: *@This()) Indent {
            return this.list.getLastOrNull() orelse .none;
        }
    };
};

pub const Line = enum(usize) {
    _,

    pub fn from(line: usize) Line {
        return @enumFromInt(line);
    }

    pub fn cast(line: Line) usize {
        return @intFromEnum(line);
    }

    pub fn inc(line: *Line, num: usize) void {
        line.* = @enumFromInt(@intFromEnum(line.*) + num);
    }

    pub fn dec(line: *Line, num: usize) void {
        line.* = @enumFromInt(@intFromEnum(line.*) - num);
    }

    pub fn add(line: Line, num: usize) Line {
        return @enumFromInt(@intFromEnum(line) + num);
    }

    pub fn sub(line: Line, num: usize) Line {
        return @enumFromInt(@intFromEnum(line) - num);
    }
};

pub fn Parser(comptime enc: Encoding) type {
    const chars = enc.chars();

    return struct {
        input: []const enc.unit(),

        pos: usize,
        indent: Indent,
        line: Line,
        at_line_start: bool,
        token: Token(enc),

        allocator: std.mem.Allocator,

        context: Context.Stack,
        indents: Indent.Stack,

        future: ?State,

        const State = struct {
            pos: usize,
            indent: Indent,
            line: Line,
            token: Token(enc),

            pub fn apply(this: *const @This(), parser: *Parser(enc)) void {
                parser.pos = this.pos;
                parser.indent = this.indent;
                parser.line = this.line;
                parser.token = this.token;
            }
        };

        pub fn init(allocator: std.mem.Allocator, input: []const enc.unit()) @This() {
            return .{
                .input = input,
                .allocator = allocator,
                .pos = 0,
                .indent = .none,
                .line = .from(1),
                .at_line_start = true,
                .token = .eof(.{ .start = 0, .indent = .none, .line = .from(1) }),
                // .key = null,
                // .literal = null,
                .context = .init(allocator),
                .indents = .init(allocator),
                .future = null,
            };
        }

        const ParseResult = union(enum) {
            result: Result,
            err: Error,

            const Result = struct {
                stream: Stream,
                allocator: std.mem.Allocator,

                pub fn deinit(this: *@This()) void {
                    for (this.stream.docs.items) |doc| {
                        doc.deinit();
                    }
                }
            };

            const Error = union(enum) {
                oom,
                unexpected_eof: struct {
                    pos: usize,
                },
                unexpected_token: struct {
                    pos: usize,
                },
                unexpected_character: struct {
                    pos: usize,
                },
                invalid_directive: struct {
                    pos: usize,
                },
                expected_whitespace: struct {
                    pos: usize,
                },
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
                        error.UnexpectedToken => if (parser.token.data == .eof)
                            .{ .unexpected_eof = .{ .pos = parser.token.start } }
                        else
                            .{ .unexpected_token = .{ .pos = parser.token.start } },
                        error.UnexpectedEof => .{ .unexpected_eof = .{ .pos = parser.token.start } },
                        error.InvalidDirective => .{ .invalid_directive = .{ .pos = parser.token.start } },
                        error.UnexpectedCharacter => if (parser.pos >= parser.input.len)
                            .{ .unexpected_eof = .{ .pos = parser.pos } }
                        else
                            .{ .unexpected_character = .{ .pos = parser.pos } },
                    },
                };
            }
        };

        pub fn parse(self: *@This()) ParseError!Stream {
            try self.scan();

            return try self.parseStream();
        }

        const ParseError = OOM || error{
            UnexpectedToken,
            UnexpectedEof,
            InvalidDirective,
            UnexpectedCharacter,

            // InvalidSyntax,
            // UnexpectedDirective,
            // UnexpectedDocumentStart,
            // UnexpectedDocumentEnd,
        };

        pub fn parseStream(self: *@This()) ParseError!Stream {
            var docs: std.ArrayList(Document) = .init(self.allocator);

            if (self.token.data == .eof) {
                try docs.append(.{
                    .directives = .init(self.allocator),
                    .root = .{
                        .indent = .none,
                        // TODO: this doesn't make sense
                        .line = .from(0),
                        .data = .{ .scalar = .null },
                    },
                });
                return .{ .docs = docs, .input = self.input };
            }

            while (self.token.data != .eof) {
                const doc = try self.parseDocument();

                try docs.append(doc);

                try self.scan();
            }

            return .{ .docs = docs, .input = self.input };
        }

        fn peek(self: *const @This(), comptime n: usize) enc.unit() {
            const pos = self.pos + n;
            if (pos < self.input.len) {
                return self.input[pos];
            }

            return 0;
        }

        fn inc(self: *@This(), comptime n: usize) void {
            self.pos = @min(self.pos + n, self.input.len);
        }

        fn tryInc(self: *@This()) error{UnexpectedEof}!void {
            if (self.pos < self.input.len - 1) {
                self.pos += 1;
                return;
            }
            return error.UnexpectedEof;
        }

        fn newline(self: *@This()) void {
            self.indent = .none;
            self.at_line_start = true;
            self.line.inc(1);
        }

        // fn skip(self: *@This(), n: usize) void {
        //     self.pos = @min(self.pos + n, self.input.len);
        // }

        fn remain(self: *const @This()) []const enc.unit() {
            return self.input[self.pos..];
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
        fn parseDirective(self: *@This()) ParseError!Directive {
            if (self.indent != .none) {
                return error.InvalidDirective;
            }

            // yaml directive
            if (self.remainStartsWith(enc.literal("YAML"))) {
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
            if (self.remainStartsWith(enc.literal("TAG"))) {
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
                self.inc(1);
                var builder = self.stringBuilder();
                try self.trySkipNsWordChars();
                const handle = builder.end();
                try self.trySkipChar('!');
                try self.trySkipSWhite();

                const prefix = try self.parseDirectiveTagPrefix();
                try self.trySkipToNewLine();
                return .{ .tag = .{ .handle = .{ .named = handle }, .prefix = prefix } };
            }

            // reserved directive
            var builder = self.stringBuilder();
            try self.trySkipNsChars();
            const reserved = builder.end();

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
                var builder = self.stringBuilder();
                self.skipNsUriChars();
                return .{ .local = builder.end() };
            }

            // global tag prefix
            if (self.isNsTagChar()) {
                var builder = self.stringBuilder();
                self.inc(1);
                self.skipNsUriChars();
                return .{ .global = builder.end() };
            }

            return error.InvalidDirective;
        }

        pub fn parseDocument(self: *@This()) ParseError!Document {
            var directives: std.ArrayList(Directive) = .init(self.allocator);

            while (self.token.data == .directive) {
                const directive = try self.parseDirective();
                try directives.append(directive);
                try self.scan();
            }

            if (self.token.data == .document_start) {
                try self.scan();
            } else if (directives.items.len > 0) {
                // if there's directives they must end with '---'
                return error.UnexpectedToken;
            }

            const root = try self.parseNode();

            // If a document end marker follows, consume it
            if (self.token.data == .document_end) {
                try self.scan();
            } else {
                // TODO: uncomment (it's useful commented for debugging)
                // return error.UnexpectedToken;
            }

            return .{ .root = root, .directives = directives };
        }

        fn parseFlowSequence(self: *@This()) ParseError!Node {
            const sequence_indent = self.indent;
            const sequence_line = self.line;

            var seq: std.ArrayList(Node) = .init(self.allocator);

            while (self.token.data != .sequence_end) {
                const item = try self.parseNode();
                try seq.append(item);
            }

            return .sequence(sequence_indent, sequence_line, seq);
        }

        fn parseBlockSequence(self: *@This()) ParseError!Node {
            const sequence_indent = self.token.indent;
            const sequence_line = self.token.line;

            try self.context.set(.block_in);
            defer self.context.unset(.block_in);

            try self.indents.push(sequence_indent.add(1));
            defer self.indents.pop();

            var seq: std.ArrayList(Node) = .init(self.allocator);

            while (self.token.data == .sequence_entry and self.token.indent == sequence_indent) {
                try self.scan();

                if (self.token.data == .eof or (self.token.data == .sequence_entry and self.token.indent == sequence_indent and self.token.line != sequence_line)) {
                    try seq.append(.null(self.indent, self.line));
                    continue;
                }

                const item = try self.parseNode();
                try seq.append(item);
            }

            return .sequence(sequence_indent, sequence_line, seq);
        }

        fn parseImplicitMapping(self: *@This(), first_key: Node) ParseError!Node {
            const mapping_indent = self.token.indent;
            const mapping_line = self.token.line;

            try self.context.set(.block_in);
            defer self.context.unset(.block_in);

            var map: Node.Data.Mapping = .{
                .keys = .init(self.allocator),
                .values = .init(self.allocator),
            };

            if (first_key.data == .scalar and first_key.data.scalar == .string) {
                if (first_key.data.scalar.string.multiline) {
                    return error.UnexpectedToken;
                }
            }

            try map.keys.append(first_key);

            try self.indents.push(mapping_indent.add(1));

            try self.scan();

            if (self.token.data == .eof or (self.token.line != mapping_line and self.token.indent == mapping_indent)) {
                try map.values.append(.null(mapping_indent, mapping_line));
            } else {
                const value = try self.parseNode();
                try map.values.append(value);
            }

            self.indents.pop();

            try self.scan();

            while (self.token.data != .eof and self.token.indent == mapping_indent) {
                try self.indents.push(mapping_indent.add(1));

                const key = try self.parseNode();
                try map.keys.append(key);

                self.indents.pop();

                try self.scan();

                try self.indents.push(key.indent);

                if (self.token.data == .eof or (self.token.line != mapping_line and self.token.indent == mapping_indent)) {
                    try map.values.append(.null(mapping_indent, key.line));
                } else {
                    const value = try self.parseNode();
                    try map.values.append(value);
                }

                self.indents.pop();

                try self.scan();
            }

            return .mapping(mapping_indent, mapping_line, map);
        }

        pub fn parseExplicitMapping(self: *@This()) ParseError!Node {
            const mapping_indent = self.token.indent;
            const mapping_line = self.token.line;

            const map: Node.Data.Mapping = .{
                .keys = .init(self.allocator),
                .values = .init(self.allocator),
            };

            return .mapping(mapping_indent, mapping_line, map);
        }

        fn parseNode(self: *@This()) ParseError!Node {
            return switch (self.token.data) {
                .eof => .null(self.indent, self.line),
                .sequence_start => self.parseFlowSequence(),
                .sequence_end => error.UnexpectedToken,
                .sequence_entry => self.parseBlockSequence(),
                .mapping_start => error.UnexpectedToken,
                .mapping_end => error.UnexpectedToken,
                .mapping_key => self.parseExplicitMapping(),
                .mapping_value => self.parseImplicitMapping(.null(self.indent, self.line)),
                .scalar => |scalar| {
                    const scalar_indent = self.indent;
                    const scalar_line = self.line;

                    const save: State = .{
                        .pos = self.pos,
                        .indent = self.indent,
                        .line = self.line,
                        .token = self.token,
                    };

                    try self.scan();

                    // implicit key
                    if (self.token.data == .mapping_value) {
                        return self.parseImplicitMapping(.scalar(scalar_indent, scalar_line, scalar));
                    }

                    self.future = .{
                        .pos = self.pos,
                        .indent = self.token.indent,
                        .line = self.token.line,
                        .token = self.token,
                    };

                    save.apply(self);

                    return .scalar(scalar_indent, scalar_line, scalar);
                },
                else => error.UnexpectedToken,
            };
        }

        fn next(self: *const @This()) enc.unit() {
            const pos = self.pos;
            if (pos < self.input.len) {
                return self.input[pos];
            }
            return 0;
        }

        /// returns total number of folded lines. considers \r\n as one
        fn foldLines(self: *@This()) usize {
            var total: usize = 0;
            return next: switch (self.next()) {
                '\r' => {
                    total += 1;
                    self.newline();
                    self.inc(1);
                    // consume \n if it exists
                    const nc = self.next();
                    if (nc == '\n') {
                        self.inc(1);
                        continue :next self.next();
                    }
                    continue :next nc;
                },
                '\n' => {
                    total += 1;
                    self.newline();
                    self.inc(1);
                    continue :next self.next();
                },
                ' ', '\t' => {
                    self.inc(1);
                    continue :next self.next();
                },
                else => total,
            };
        }

        fn foldIndentedLines(self: *@This()) usize {
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
                    var indent: usize = 1;
                    self.inc(1);
                    while (self.next() == ' ') {
                        self.inc(1);
                        indent += 1;
                    }

                    self.indent = .from(indent);

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

        const ScanPlainScalarError = OOM || error{UnexpectedCharacter};

        fn scanPlainScalar(self: *@This()) ScanPlainScalarError!Token(enc) {
            const ScalarResolverCtx = struct {
                text: std.ArrayList(enc.unit()),
                scalar: ?Token(enc).Scalar,

                resolved_scalar_len: usize = 0,

                start: usize,
                scalar_line: Line,
                scalar_indent: Indent,

                base_indent: Indent,

                pub fn done(ctx: *const @This(), parser: *const Parser(enc)) Token(enc) {
                    if (ctx.scalar) |scalar| {
                        if (ctx.text.items.len == ctx.resolved_scalar_len) {
                            ctx.text.deinit();

                            return .scalar(.{
                                .start = ctx.start,
                                .indent = ctx.scalar_indent,
                                .line = ctx.scalar_line,
                                .resolved = scalar,
                            });
                        }

                        // the first characters resolved to something
                        // but there were more characters afterwards
                    }

                    return .scalar(.{
                        .start = ctx.start,
                        .indent = ctx.scalar_indent,
                        .line = ctx.scalar_line,
                        .resolved = .{
                            .string = .{ .text = .{ .list = ctx.text }, .multiline = ctx.scalar_line != parser.line },
                        },
                    });
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

                pub fn resolve(
                    ctx: *@This(),
                    scalar: Token(enc).Scalar,
                    text: []const enc.unit(),
                ) OOM!void {
                    try ctx.text.appendSlice(text);
                    ctx.resolved_scalar_len = ctx.text.items.len;
                    ctx.scalar = scalar;
                }

                pub fn tryResolveNumber(
                    ctx: *@This(),
                    parser: *Parser(enc),
                    first: enum { positive, negative, dot, none },
                ) OOM!void {
                    const start = parser.pos;

                    const nan = std.math.nan(f64);
                    const inf = std.math.inf(f64);

                    switch (first) {
                        .dot => {
                            switch (parser.next()) {
                                'n' => {
                                    parser.inc(1);
                                    if (parser.remainStartsWith("an")) {
                                        try ctx.resolve(.{ .number = nan }, "nan");
                                        parser.inc(2);
                                        return;
                                    }
                                    try ctx.text.append('n');
                                    return;
                                },
                                'N' => {
                                    parser.inc(1);
                                    if (parser.remainStartsWith("aN")) {
                                        try ctx.resolve(.{ .number = nan }, "NaN");
                                        parser.inc(2);
                                        return;
                                    }
                                    if (parser.remainStartsWith("AN")) {
                                        try ctx.resolve(.{ .number = nan }, "NAN");
                                        parser.inc(2);
                                        return;
                                    }
                                    try ctx.text.append('N');
                                    return;
                                },
                                'i' => {
                                    parser.inc(1);
                                    if (parser.remainStartsWith("nf")) {
                                        try ctx.resolve(.{ .number = inf }, "inf");
                                        parser.inc(2);
                                        return;
                                    }
                                    try ctx.text.append('i');
                                    return;
                                },
                                'I' => {
                                    parser.inc(1);
                                    if (parser.remainStartsWith("nf")) {
                                        try ctx.resolve(.{ .number = inf }, "Inf");
                                        parser.inc(2);
                                        return;
                                    }
                                    if (parser.remainStartsWith("NF")) {
                                        try ctx.resolve(.{ .number = inf }, "INF");
                                        parser.inc(2);
                                        return;
                                    }
                                    try ctx.text.append('I');
                                    return;
                                },
                                else => {},
                            }
                        },
                        .negative, .positive => {
                            if (parser.next() == '.' and parser.peek(1) == 'i' or parser.peek(1) == 'I') {
                                parser.inc(1);
                                try ctx.text.append('.');
                                switch (parser.next()) {
                                    'i' => {
                                        parser.inc(1);
                                        if (parser.remainStartsWith("nf")) {
                                            try ctx.resolve(.{ .number = if (first == .negative) -inf else inf }, "inf");
                                            parser.inc(2);
                                            return;
                                        }
                                        try ctx.text.append('i');
                                        return;
                                    },
                                    'I' => {
                                        parser.inc(1);
                                        if (parser.remainStartsWith("nf")) {
                                            try ctx.resolve(.{ .number = if (first == .negative) -inf else inf }, "Inf");
                                            parser.inc(2);
                                            return;
                                        }
                                        if (parser.remainStartsWith("NF")) {
                                            try ctx.resolve(.{ .number = if (first == .negative) -inf else inf }, "INF");
                                            parser.inc(2);
                                            return;
                                        }
                                        try ctx.text.append('I');
                                        return;
                                    },
                                    else => {
                                        return;
                                    },
                                }
                            }
                        },
                        .none => {},
                    }

                    var decimal = parser.next() == '.';
                    var x = false;
                    var o = false;

                    parser.inc(1);

                    const end, const valid = end: switch (parser.next()) {

                        // can only be valid if it ends on:
                        // - ' '
                        // - '\t'
                        // - eof
                        // - '\n'
                        // - '\r'
                        ' ',
                        '\t',
                        0,
                        '\n',
                        '\r',
                        => break :end .{ parser.pos, true },

                        '0'...'9',
                        'a'...'f',
                        'A'...'F',
                        => {
                            parser.inc(1);
                            continue :end parser.next();
                        },

                        'x' => {
                            if (x) {
                                break :end .{ parser.pos, false };
                            }

                            x = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },

                        'o' => {
                            if (o) {
                                break :end .{ parser.pos, false };
                            }

                            o = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },

                        '.' => {
                            if (decimal) {
                                break :end .{ parser.pos, false };
                            }

                            decimal = true;
                            parser.inc(1);
                            continue :end parser.next();
                        },
                        else => {
                            break :end .{ parser.pos, false };
                        },
                    };

                    try ctx.text.appendSlice(parser.input[start..end]);

                    if (!valid) {
                        return;
                    }

                    var scalar: Token(enc).Scalar = scalar: {
                        // TODO: don't parse twice
                        const float = std.fmt.parseFloat(f64, parser.input[start..end]) catch {
                            const int = std.fmt.parseUnsigned(u64, parser.input[start..end], 0) catch {
                                return;
                            };
                            break :scalar .{ .number = @floatFromInt(int) };
                        };
                        break :scalar .{ .number = float };
                    };

                    ctx.resolved_scalar_len = ctx.text.items.len;
                    if (first == .negative) {
                        scalar.number = -scalar.number;
                    }
                    ctx.scalar = scalar;
                }
            };

            var ctx: ScalarResolverCtx = .{
                .text = .init(self.allocator),
                .scalar = null,
                .start = self.pos,
                .scalar_line = self.line,
                .scalar_indent = self.indent,
                .base_indent = self.indents.get(),
            };

            next: switch (self.next()) {
                0 => {
                    return ctx.done(self);
                },

                ':' => {
                    if (self.isWhiteSpaceOrNewLineOrEofAt(1)) {
                        return ctx.done(self);
                    }

                    try ctx.text.append(':');
                    self.inc(1);
                    continue :next self.next();
                },

                '#' => {
                    if (self.pos == 0 or self.input[self.pos - 1] == ' ') {
                        return ctx.done(self);
                    }

                    try ctx.text.append('#');
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

                        .flow_in => {
                            return ctx.done(self);
                        },
                    }

                    try ctx.text.append(c);
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

                    const lines = self.foldIndentedLines();

                    if (ctx.base_indent != .none) {
                        switch (self.indent.cmp(ctx.base_indent)) {
                            .gt, .eq => {
                                // continue (whitespace already stripped)
                            },
                            .lt => {
                                // end here. this is the start of a new value.
                                return ctx.done(self);
                            },
                        }
                    }

                    if (lines == 0 and !self.isEof()) {
                        try ctx.text.append(' ');
                    }

                    try ctx.text.appendNTimes('\n', lines);

                    continue :next self.next();
                },

                else => |c| {
                    if (ctx.text.items.len != 0 or ctx.scalar != null) {
                        self.inc(1);
                        try ctx.text.append(c);
                        continue :next self.next();
                    }

                    // first non-whitespace

                    // TODO: make more better
                    switch (c) {
                        'n' => {
                            self.inc(1);
                            if (self.remainStartsWith("ull")) {
                                try ctx.resolve(.null, "null");
                                self.inc(3);
                                continue :next self.next();
                            }
                            if (self.remainStartsWithChar('o')) {
                                try ctx.resolve(.{ .boolean = false }, "no");
                                self.inc(1);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        'N' => {
                            self.inc(1);
                            if (self.remainStartsWith("ull")) {
                                try ctx.resolve(.null, "Null");
                                self.inc(3);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("ULL")) {
                                try ctx.resolve(.null, "NULL");
                                self.inc(3);
                                continue :next self.next();
                            }
                            if (self.remainStartsWithChar('o')) {
                                try ctx.resolve(.{ .boolean = false }, "No");
                                self.inc(1);
                                continue :next self.next();
                            }
                            if (self.remainStartsWithChar('O')) {
                                try ctx.resolve(.{ .boolean = false }, "NO");
                                self.inc(1);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        '~' => {
                            self.inc(1);
                            try ctx.resolve(.null, "~");
                            continue :next self.next();
                        },
                        't' => {
                            self.inc(1);
                            if (self.remainStartsWith("rue")) {
                                try ctx.resolve(.{ .boolean = true }, "true");
                                self.inc(3);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        'T' => {
                            self.inc(1);
                            if (self.remainStartsWith("rue")) {
                                try ctx.resolve(.{ .boolean = true }, "True");
                                self.inc(3);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("RUE")) {
                                try ctx.resolve(.{ .boolean = true }, "TRUE");
                                self.inc(3);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        'y' => {
                            self.inc(1);
                            if (self.remainStartsWith("es")) {
                                try ctx.resolve(.{ .boolean = true }, "yes");
                                self.inc(2);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        'Y' => {
                            self.inc(1);
                            if (self.remainStartsWith("es")) {
                                try ctx.resolve(.{ .boolean = true }, "Yes");
                                self.inc(2);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("ES")) {
                                try ctx.resolve(.{ .boolean = true }, "YES");
                                self.inc(2);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        'o' => {
                            self.inc(1);
                            if (self.remainStartsWithChar('n')) {
                                try ctx.resolve(.{ .boolean = true }, "on");
                                self.inc(1);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("ff")) {
                                try ctx.resolve(.{ .boolean = false }, "off");
                                self.inc(2);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        'O' => {
                            self.inc(1);
                            if (self.remainStartsWithChar('n')) {
                                try ctx.resolve(.{ .boolean = true }, "On");
                                self.inc(1);
                                continue :next self.next();
                            }
                            if (self.remainStartsWithChar('N')) {
                                try ctx.resolve(.{ .boolean = true }, "ON");
                                self.inc(1);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("ff")) {
                                try ctx.resolve(.{ .boolean = false }, "Off");
                                self.inc(2);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("FF")) {
                                try ctx.resolve(.{ .boolean = false }, "OFF");
                                self.inc(2);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        'f' => {
                            self.inc(1);
                            if (self.remainStartsWith("alse")) {
                                try ctx.resolve(.{ .boolean = false }, "false");
                                self.inc(4);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                        'F' => {
                            self.inc(1);
                            if (self.remainStartsWith("alse")) {
                                try ctx.resolve(.{ .boolean = false }, "False");
                                self.inc(4);
                                continue :next self.next();
                            }
                            if (self.remainStartsWith("ALSE")) {
                                try ctx.resolve(.{ .boolean = false }, "FALSE");
                                self.inc(4);
                                continue :next self.next();
                            }
                            try ctx.text.append(c);
                            continue :next self.next();
                        },

                        '-' => {
                            try ctx.text.append('-');
                            self.inc(1);
                            try ctx.tryResolveNumber(self, .negative);
                            continue :next self.next();
                        },

                        '+' => {
                            try ctx.text.append('+');
                            self.inc(1);
                            try ctx.tryResolveNumber(self, .positive);
                            continue :next self.next();
                        },

                        '0'...'9' => {
                            try ctx.tryResolveNumber(self, .none);
                            continue :next self.next();
                        },

                        '.' => {
                            switch (self.peek(1)) {
                                'n',
                                'N',
                                'i',
                                'I',
                                => {
                                    try ctx.text.append('.');
                                    self.inc(1);
                                    try ctx.tryResolveNumber(self, .dot);
                                    continue :next self.next();
                                },

                                else => {
                                    try ctx.tryResolveNumber(self, .none);
                                    continue :next self.next();
                                },
                            }
                        },

                        else => {
                            self.inc(1);
                            try ctx.text.append(c);
                            continue :next self.next();
                        },
                    }
                },
            }
        }

        const ScanSingleQuotedScalarError = OOM || error{UnexpectedCharacter};

        fn scanSingleQuotedScalar(self: *@This()) ScanSingleQuotedScalarError!Token(enc) {
            const start = self.pos;
            const scalar_line = self.line;
            const scalar_indent = self.indent;

            var text: std.ArrayList(enc.unit()) = .init(self.allocator);

            next: switch (self.next()) {
                0 => return error.UnexpectedCharacter,

                '\r',
                '\n',
                => {
                    self.newline();
                    self.inc(1);
                    switch (self.foldLines()) {
                        0 => try text.append(' '),
                        else => |lines| try text.appendNTimes('\n', lines),
                    }
                    continue :next self.next();
                },

                ' ',
                '\t',
                => {
                    const off = self.pos;
                    self.inc(1);
                    self.skipSWhite();
                    if (!self.isBChar()) {
                        try text.appendSlice(self.input[off..self.pos]);
                    }
                    continue :next self.next();
                },

                '\'' => {
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
                            .string = .{
                                .text = .{ .list = text },
                                .multiline = self.line != scalar_line,
                            },
                        },
                    });
                },
                else => |c| {
                    try text.append(c);
                    self.inc(1);
                    continue :next self.next();
                },
            }
        }

        const ScanDoubleQuotedScalarError = OOM || error{UnexpectedCharacter};

        fn scanDoubleQuotedScalar(self: *@This()) ScanDoubleQuotedScalarError!Token(enc) {
            const start = self.pos;
            const scalar_line = self.line;
            const scalar_indent = self.indent;
            var text: std.ArrayList(enc.unit()) = .init(self.allocator);

            next: switch (self.next()) {
                0 => return error.UnexpectedCharacter,

                '\r',
                '\n',
                => {
                    self.newline();
                    self.inc(1);
                    switch (self.foldLines()) {
                        0 => try text.append(' '),
                        else => |lines| try text.appendNTimes('\n', lines),
                    }
                    continue :next self.next();
                },

                ' ',
                '\t',
                => {
                    const off = self.pos;
                    self.inc(1);
                    self.skipSWhite();
                    if (!self.isBChar()) {
                        try text.appendSlice(self.input[off..self.pos]);
                    }
                    continue :next self.next();
                },

                '"' => {
                    self.inc(1);
                    return .scalar(.{
                        .start = start,
                        .indent = scalar_indent,
                        .line = scalar_line,
                        .resolved = .{
                            .string = .{
                                .text = .{ .list = text },
                                .multiline = self.line != scalar_line,
                            },
                        },
                    });
                },

                '\\' => {
                    self.inc(1);
                    switch (self.next()) {
                        '\r',
                        '\n',
                        => {
                            self.newline();
                            self.inc(1);
                            const lines = self.foldLines();
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
            text: *std.ArrayList(enc.unit()),
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

        const ScanError = OOM || error{ UnexpectedToken, UnexpectedCharacter };

        fn scan(self: *@This()) ScanError!void {
            if (self.future) |future| {
                self.future = null;
                future.apply(self);
                return;
            }

            defer {
                self.at_line_start = false;
            }

            next: switch (self.next()) {
                0 => {
                    const start = self.pos;
                    self.token = .eof(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                '-' => {
                    const start = self.pos;

                    if (self.indent == .none and self.remainStartsWith(enc.literal("---")) and self.isWhiteSpaceOrNewLineOrEofAt(3)) {
                        self.inc(3);
                        self.token = .documentStart(.{
                            .start = start,
                            .indent = self.indent,
                            .line = self.line,
                        });
                        return;
                    }

                    if (self.isWhiteSpaceOrNewLineOrEofAt(1)) {
                        const indent: Indent = if (start == 0) self.indent else indent: {
                            var pos: usize = start - 1;
                            var found = false;

                            // detect compact nested sequence indentation
                            prev: switch (self.input[pos]) {
                                '-' => {
                                    found = true;
                                    pos = std.math.sub(usize, pos, 1) catch break :prev;
                                    continue :prev self.input[pos];
                                },

                                ' ', '\t' => {
                                    pos = std.math.sub(usize, pos, 1) catch break :prev;
                                    continue :prev self.input[pos];
                                },

                                '\r', '\n' => {
                                    // +1 because we want line start (last position of ' ' or '\t')
                                    pos += 1;
                                    break :prev;
                                },

                                else => break :indent self.indent,
                            }

                            if (!found) {
                                break :indent self.indent;
                            }

                            break :indent .from(start - pos);
                        };

                        self.inc(1);
                        self.token = .sequenceEntry(.{
                            .start = start,
                            .indent = indent,
                            .line = self.line,
                        });

                        switch (self.context.get()) {
                            .block_out,
                            .block_in,
                            => {},
                            .flow_in => {
                                return error.UnexpectedToken;
                            },
                        }
                        return;
                    }

                    self.token = try self.scanPlainScalar();
                    return;
                },
                '.' => {
                    const start = self.pos;

                    if (self.indent == .none and self.remainStartsWith(enc.literal("...")) and self.isWhiteSpaceOrNewLineOrEofAt(3)) {
                        self.inc(3);
                        self.token = .documentEnd(.{
                            .start = start,
                            .indent = self.indent,
                            .line = self.line,
                        });
                        return;
                    }

                    self.token = try self.scanPlainScalar();
                    return;
                },
                '?' => {
                    const start = self.pos;

                    if (self.isWhiteSpaceOrNewLineOrEofAt(1)) {
                        self.inc(1);
                        self.token = .mappingKey(.{
                            .start = start,
                            .indent = self.indent,
                            .line = self.line,
                        });
                        return;
                    }

                    self.token = try self.scanPlainScalar();
                    return;
                },
                ':' => {
                    const start = self.pos;

                    switch (self.context.get()) {
                        .flow_in => {
                            // inside flow context ':' does not need to be followed by whitespace.
                            self.inc(1);
                            self.token = .mappingValue(.{
                                .start = start,
                                .indent = self.indent,
                                .line = self.line,
                            });
                            return;
                        },
                        .block_out,
                        .block_in,
                        => {
                            if (self.isWhiteSpaceOrNewLineOrEofAt(1)) {
                                self.inc(1);
                                self.token = .mappingValue(.{
                                    .start = start,
                                    .indent = self.indent,
                                    .line = self.line,
                                });
                                return;
                            }
                        },
                    }

                    self.token = try self.scanPlainScalar();
                    return;
                },
                ',' => {
                    const start = self.pos;

                    switch (self.context.get()) {
                        .flow_in => {
                            self.inc(1);
                            self.token = .collectEntry(.{
                                .start = start,
                                .indent = self.indent,
                                .line = self.line,
                            });
                            return;
                        },
                        .block_in,
                        .block_out,
                        => {
                            self.token = try self.scanPlainScalar();
                            return;
                        },
                    }
                },
                '[' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .sequenceStart(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                ']' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .sequenceEnd(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                '{' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .mappingStart(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                '}' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .mappingEnd(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                '#' => {
                    const start = self.pos;

                    const prev = if (start == 0) 0 else self.input[start - 1];
                    switch (prev) {
                        0,
                        ' ',
                        '\t',
                        '\n',
                        '\r',
                        => {},
                        else => {
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
                    self.token = .anchor(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                '*' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .alias(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                '!' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .ttag(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                '|' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .literal(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                        .indent_indicator = .none,
                        .chomp = .default,
                    });

                    switch (self.context.get()) {
                        .block_out,
                        .block_in,
                        => {},
                        .flow_in => {
                            return error.UnexpectedToken;
                        },
                    }
                    return;
                },
                '>' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .folded(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                        .indent_indicator = .none,
                        .chomp = .default,
                    });
                    switch (self.context.get()) {
                        .block_out,
                        .block_in,
                        => {},
                        .flow_in => {
                            return error.UnexpectedToken;
                        },
                    }
                    return;
                },
                '\'' => {
                    self.inc(1);
                    self.token = try self.scanSingleQuotedScalar();
                    return;
                },
                '"' => {
                    self.inc(1);
                    self.token = try self.scanDoubleQuotedScalar();
                    return;
                },
                '%' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .directive(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return;
                },
                '@', '`' => {
                    const start = self.pos;

                    self.inc(1);
                    self.token = .reserved(.{
                        .start = start,
                        .indent = self.indent,
                        .line = self.line,
                    });
                    return error.UnexpectedToken;
                },
                '\n' => {
                    const start = self.pos;
                    _ = start;

                    self.newline();

                    self.inc(1);

                    continue :next self.next();
                },
                '\r' => {
                    const start = self.pos;
                    _ = start;

                    self.newline();

                    self.inc(1);
                    // consume `\r\n` as one newline
                    if (self.isChar('\n')) {
                        self.inc(1);
                    }

                    continue :next self.next();
                },
                ' ' => {
                    const start = self.pos;
                    _ = start;

                    var total: usize = 1;
                    self.inc(1);

                    while (self.isChar(' ')) {
                        self.inc(1);
                        total += 1;
                    }

                    if (self.at_line_start) {
                        self.indent = .from(total);
                    }

                    continue :next self.next();
                },
                '\t' => {
                    self.inc(1);
                    continue :next self.next();
                },

                else => {
                    self.token = try self.scanPlainScalar();
                    return;
                },
            }
        }

        fn isChar(self: *@This(), char: enc.unit()) bool {
            const pos = self.pos;
            if (pos < self.input.len) {
                return self.input[pos] == char;
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
            if (pos < self.input.len) {
                return chars.isNsWordChar(self.input[pos]);
            }
            return false;
        }

        /// ns-char
        fn isNsChar(self: *@This()) bool {
            const pos = self.pos;
            if (pos < self.input.len) {
                return chars.isNsChar(self.input[pos]);
            }
            return false;
        }

        fn skipNsChars(self: *@This()) void {
            while (self.isNsChar()) {
                self.inc(1);
            }
        }

        fn trySkipNsChars(self: *@This()) ParseError!void {
            if (!self.isNsChar()) {
                return error.UnexpectedCharacter;
            }
            self.skipNsChars();
        }

        fn isNsTagChar(self: *@This()) bool {
            const r = self.remain();
            return chars.isNsTagChar(r);
        }

        /// s-l-comments
        ///
        /// positions `pos` on the next newline, or eof. Errors
        fn trySkipToNewLine(self: *@This()) ParseError!void {
            self.skipSWhite();

            if (self.isChar('#')) {
                self.inc(1);
                while (!self.isChar('\n') and !self.isChar('\r')) {
                    self.inc(1);
                }
            }

            if (self.pos != self.input.len and !self.isChar('\n') and !self.isChar('\r')) {
                return error.UnexpectedCharacter;
            }
        }

        fn isWhiteSpaceOrNewLineAt(self: *@This(), n: usize) bool {
            const pos = self.pos + n;
            if (pos < self.input.len) {
                const c = self.input[pos];
                return c == ' ' or c == '\t' or c == '\n' or c == '\r';
            }
            return false;
        }

        fn isWhiteSpaceOrNewLineOrEofAt(self: *@This(), n: usize) bool {
            const pos = self.pos + n;
            if (pos < self.input.len) {
                const c = self.input[pos];
                return c == ' ' or c == '\t' or c == '\n' or c == '\r';
            }
            return true;
        }

        fn isAnyAt(self: *const @This(), values: []const enc.unit(), n: usize) bool {
            const pos = self.pos + n;
            if (pos < self.input.len) {
                return std.mem.indexOfScalar(enc.unit(), values, self.input[pos]) != null;
            }
            return false;
        }

        fn isAnyOrEofAt(self: *const @This(), values: []const enc.unit(), n: usize) bool {
            const pos = self.pos + n;
            if (pos < self.input.len) {
                return std.mem.indexOfScalar(enc.unit(), values, self.input[pos]) != null;
            }
            return false;
        }

        fn isEof(self: *const @This()) bool {
            return self.pos >= self.input.len;
        }

        fn isEofAt(self: *const @This(), n: usize) bool {
            return self.pos + n >= self.input.len;
        }

        fn isBChar(self: *@This()) bool {
            const pos = self.pos;
            if (pos < self.input.len) {
                return chars.isBChar(self.input[pos]);
            }
            return false;
        }

        fn isBCharOrEof(self: *@This()) bool {
            const pos = self.pos;
            if (pos < self.input.len) {
                return chars.isBChar(self.input[pos]);
            }
            return true;
        }

        fn isSWhite(self: *@This()) bool {
            const pos = self.pos;
            if (pos < self.input.len) {
                return chars.isSWhite(self.input[pos]);
            }
            return false;
        }

        fn skipSWhite(self: *@This()) void {
            while (self.isSWhite()) {
                self.inc(1);
            }
        }

        fn trySkipSWhite(self: *@This()) ParseError!void {
            if (!self.isSWhite()) {
                return error.UnexpectedCharacter;
            }
            while (self.isSWhite()) {
                self.inc(1);
            }
        }

        fn isNsHexDigit(self: *@This()) bool {
            const pos = self.pos;
            if (pos < self.input.len) {
                return chars.isNsHexDigit(self.input[pos]);
            }
            return false;
        }

        fn isNsDecDigit(self: *@This()) bool {
            const pos = self.pos;
            if (pos < self.input.len) {
                return chars.isNsDecDigit(self.input[pos]);
            }
            return false;
        }

        fn skipNsDecDigits(self: *@This()) void {
            while (self.isNsDecDigit()) {
                self.inc(1);
            }
        }

        fn trySkipNsDecDigits(self: *@This()) ParseError!void {
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

        fn trySkipNsWordChars(self: *@This()) ParseError!void {
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

        fn trySkipNsUriChars(self: *@This()) ParseError!void {
            if (!self.isNsUriChar()) {
                return error.UnexpectedCharacter;
            }
            self.skipNsUriChars();
        }

        fn stringBuilder(self: *@This()) String.Builder {
            return .{
                .start = self.pos,
                .parser = self,
            };
        }

        pub const String = union(enum) {
            literal: struct {
                off: usize,
                len: usize,
            },
            list: std.ArrayList(enc.unit()),

            pub fn slice(self: *const @This(), input: []const enc.unit()) []const enc.unit() {
                return switch (self.*) {
                    .literal => |literal| input[literal.off..][0..literal.len],
                    .list => |list| list.items,
                };
            }

            pub fn eql(l: *const @This(), r: []const u8, input: []const enc.unit()) bool {
                const l_slice = l.slice(input);
                return std.mem.eql(enc.unit(), l_slice, r);
            }

            pub const Builder = struct {
                start: usize,
                parser: *Parser(enc),

                pub fn end(this: *const @This()) String {
                    return .{
                        .literal = .{
                            .off = this.start,
                            .len = this.parser.pos - this.start,
                        },
                    };
                }
            };
        };

        pub const Node = struct {
            indent: Indent,
            line: Line,
            data: Data,

            pub const Data = union(enum) {
                scalar: Token(enc).Scalar,
                sequence: std.ArrayList(Node),
                mapping: Mapping,

                pub const Mapping = struct {
                    keys: std.ArrayList(Node),
                    values: std.ArrayList(Node),
                };
            };

            pub fn isNull(this: *const Node) bool {
                return switch (this.data) {
                    .scalar => |s| s == .null,
                    else => false,
                };
            }

            pub fn scalar(indent: Indent, line: Line, s: Token(enc).Scalar) Node {
                return .{
                    .indent = indent,
                    .line = line,
                    .data = .{ .scalar = s },
                };
            }

            pub fn @"null"(indent: Indent, line: Line) Node {
                return .{
                    .indent = indent,
                    .line = line,
                    .data = .{ .scalar = .null },
                };
            }

            pub fn boolean(indent: Indent, line: Line, value: bool) Node {
                return .{
                    .indent = indent,
                    .line = line,
                    .data = .{ .scalar = .{ .boolean = value } },
                };
            }

            pub fn number(indent: Indent, line: Line, value: f64) Node {
                return .{
                    .indent = indent,
                    .line = line,
                    .data = .{ .scalar = .{ .number = value } },
                };
            }

            pub fn string(indent: Indent, line: Line, str: String, multiline: bool) Node {
                return .{
                    .indent = indent,
                    .line = line,
                    .data = .{ .scalar = .{ .string = .{ .text = str, .multiline = multiline } } },
                };
            }

            pub fn mapping(indent: Indent, line: Line, map: Data.Mapping) Node {
                return .{
                    .indent = indent,
                    .line = line,
                    .data = .{ .mapping = map },
                };
            }

            pub fn sequence(indent: Indent, line: Line, seq: std.ArrayList(Node)) Node {
                return .{
                    .indent = indent,
                    .line = line,
                    .data = .{ .sequence = seq },
                };
            }
        };

        const Directive = union(enum) {
            yaml,
            tag: Tag,
            reserved: String,

            pub const Tag = struct {
                handle: Handle,
                prefix: Prefix,

                pub const Handle = union(enum) {
                    named: String,
                    secondary,
                    primary,
                };

                pub const Prefix = union(enum) {
                    local: String,
                    global: String,
                };
            };
        };

        pub const Document = struct {
            directives: std.ArrayList(Directive),
            root: Node,

            pub fn deinit(this: *Document) void {
                this.directives.deinit();
            }
        };

        pub const Stream = struct {
            docs: std.ArrayList(Document),
            input: []const enc.unit(),
        };

        fn Printer(comptime Writer: type) type {
            return struct {
                input: []const enc.unit(),
                stream: Stream,
                indent: Indent,
                writer: Writer,

                allocator: std.mem.Allocator,

                pub fn print(this: *@This()) Writer.Error!void {
                    if (this.stream.docs.items.len == 0) {
                        return;
                    }

                    var first = true;

                    for (this.stream.docs.items) |doc| {
                        try this.printDocument(&doc, first);
                        try this.writer.writeByte('\n');
                        first = false;

                        if (this.stream.docs.items.len != 1) {
                            try this.writer.writeAll("...\n");
                        }
                    }
                }

                pub fn printDocument(this: *@This(), doc: *const Document, first: bool) Writer.Error!void {
                    for (doc.directives.items) |directive| {
                        switch (directive) {
                            .yaml => {
                                try this.writer.writeAll("%YAML X.X\n");
                            },
                            .tag => |tag| {
                                try this.writer.print("%TAG {s} {s}{s}\n", .{
                                    switch (tag.handle) {
                                        .named => |name| name.slice(this.input),
                                        .secondary => "!!",
                                        .primary => "!",
                                    },
                                    if (tag.prefix == .local) "!" else "",
                                    switch (tag.prefix) {
                                        .local => |local| local.slice(this.input),
                                        .global => |global| global.slice(this.input),
                                    },
                                });
                            },
                            .reserved => |reserved| {
                                try this.writer.print("%{s}\n", .{reserved.slice(this.input)});
                            },
                        }
                    }

                    if (!first or doc.directives.items.len != 0) {
                        try this.writer.writeAll("---\n");
                    }

                    try this.printNode(&doc.root);
                }

                pub fn printString(this: *@This(), str: []const enc.unit()) Writer.Error!void {
                    const quote = quote: {
                        if (str.len == 0) {
                            break :quote true;
                        }

                        if (str[str.len - 1] == ' ') {
                            break :quote true;
                        }

                        for (str, 0..) |c, i| {
                            if (i == 0) {
                                switch (c) {
                                    '&',
                                    '*',
                                    '?',
                                    '|',
                                    '-',
                                    '<',
                                    '>',
                                    '=',
                                    '!',
                                    '%',
                                    '@',

                                    ' ',
                                    => break :quote true,
                                    else => {},
                                }
                                continue;
                            }

                            switch (c) {
                                '{',
                                '}',
                                '[',
                                ']',
                                ',',
                                '#',
                                '`',
                                '"',
                                '\'',
                                '\\',
                                '\t',
                                '\n',
                                '\r',
                                => break :quote true,

                                0x00...0x06,
                                0x0e...0x1a,
                                0x1c...0x1f,
                                => break :quote true,

                                't', 'T' => {
                                    const r = str[i + 1 ..];
                                    if (std.mem.startsWith(enc.unit(), r, "rue")) {
                                        break :quote true;
                                    }
                                    if (std.mem.startsWith(enc.unit(), r, "RUE")) {
                                        break :quote true;
                                    }
                                },

                                'f', 'F' => {
                                    const r = str[i + 1 ..];
                                    if (std.mem.startsWith(enc.unit(), r, "alse")) {
                                        break :quote true;
                                    }
                                    if (std.mem.startsWith(enc.unit(), r, "ALSE")) {
                                        break :quote true;
                                    }
                                },

                                '~' => break :quote true,
                                'n', 'N' => break :quote true,
                                'y', 'Y' => break :quote true,

                                'o', 'O' => {
                                    const r = str[i + 1 ..];
                                    if (std.mem.startsWith(enc.unit(), r, "ff")) {
                                        break :quote true;
                                    }
                                    if (std.mem.startsWith(enc.unit(), r, "FF")) {
                                        break :quote true;
                                    }
                                },

                                // TODO: is this one needed
                                '.' => break :quote true,

                                '0'...'9' => break :quote true,

                                else => {},
                            }
                        }

                        break :quote false;
                    };

                    if (!quote) {
                        try this.writer.writeAll(str);
                        return;
                    }

                    try this.writer.writeByte('"');

                    var i: usize = 0;
                    while (i < str.len) : (i += 1) {
                        const c = str[i];

                        // Check for UTF-8 multi-byte sequences for line/paragraph separators
                        if (enc == .utf8 and c == 0xe2 and i + 2 < str.len) {
                            if (str[i + 1] == 0x80) {
                                if (str[i + 2] == 0xa8) {
                                    // U+2028 Line separator
                                    try this.writer.writeAll("\\L");
                                    i += 2;
                                    continue;
                                } else if (str[i + 2] == 0xa9) {
                                    // U+2029 Paragraph separator
                                    try this.writer.writeAll("\\P");
                                    i += 2;
                                    continue;
                                }
                            }
                        }

                        // Check for UTF-8 sequences for NEL (U+0085) and NBSP (U+00A0)
                        if (enc == .utf8 and c == 0xc2 and i + 1 < str.len) {
                            if (str[i + 1] == 0x85) {
                                // U+0085 Next line
                                try this.writer.writeAll("\\N");
                                i += 1;
                                continue;
                            } else if (str[i + 1] == 0xa0) {
                                // U+00A0 Non-breaking space
                                try this.writer.writeAll("\\_");
                                i += 1;
                                continue;
                            }
                        }

                        const escaped = switch (c) {
                            // Standard escape sequences
                            '\\' => "\\\\",
                            '"' => "\\\"",
                            '\n' => "\\n",

                            // Control characters that need hex escaping
                            0x00 => "\\0",
                            0x01 => "\\x01",
                            0x02 => "\\x02",
                            0x03 => "\\x03",
                            0x04 => "\\x04",
                            0x05 => "\\x05",
                            0x06 => "\\x06",
                            0x07 => "\\a", // Bell
                            0x08 => "\\b", // Backspace
                            0x09 => "\\t", // Tab
                            0x0b => "\\v", // Vertical tab
                            0x0c => "\\f", // Form feed
                            0x0d => "\\r", // Carriage return
                            0x0e => "\\x0e",
                            0x0f => "\\x0f",
                            0x10 => "\\x10",
                            0x11 => "\\x11",
                            0x12 => "\\x12",
                            0x13 => "\\x13",
                            0x14 => "\\x14",
                            0x15 => "\\x15",
                            0x16 => "\\x16",
                            0x17 => "\\x17",
                            0x18 => "\\x18",
                            0x19 => "\\x19",
                            0x1a => "\\x1a",
                            0x1b => "\\e", // Escape
                            0x1c => "\\x1c",
                            0x1d => "\\x1d",
                            0x1e => "\\x1e",
                            0x1f => "\\x1f",
                            0x7f => "\\x7f", // Delete

                            0x20...0x21,
                            0x23...0x5b,
                            0x5d...0x7e,
                            => &.{c},

                            0x80...std.math.maxInt(enc.unit()) => &.{c},
                        };

                        try this.writer.writeAll(escaped);
                    }

                    try this.writer.writeByte('"');
                }

                pub fn printNode(this: *@This(), node: *const Node) Writer.Error!void {
                    switch (node.data) {
                        .scalar => |scalar| {
                            switch (scalar) {
                                .null => {
                                    try this.writer.writeAll("null");
                                },
                                .boolean => |boolean| {
                                    try this.writer.print("{}", .{boolean});
                                },
                                .number => |number| {
                                    try this.writer.print("{d}", .{number});
                                },
                                .string => |string| {
                                    try this.printString(string.text.slice(this.input));
                                },
                            }
                        },
                        .sequence => |sequence| {
                            for (sequence.items, 0..) |item, i| {
                                try this.writer.writeAll("- ");
                                this.indent.inc(2);
                                try this.printNode(&item);
                                this.indent.dec(2);

                                if (i + 1 != sequence.items.len) {
                                    try this.writer.writeByte('\n');
                                    try this.printIndent();
                                }
                            }
                        },
                        .mapping => |mapping| {
                            for (mapping.keys.items, mapping.values.items, 0..) |*key, *value, i| {
                                try this.printNode(key);
                                try this.writer.writeAll(": ");

                                this.indent.inc(1);

                                if (value.data == .mapping) {
                                    try this.writer.writeByte('\n');
                                    try this.printIndent();
                                }

                                try this.printNode(value);

                                this.indent.dec(1);

                                if (i + 1 != mapping.keys.items.len) {
                                    try this.writer.writeByte('\n');
                                    try this.printIndent();
                                }
                            }
                        },
                    }
                }

                pub fn printIndent(this: *@This()) Writer.Error!void {
                    for (0..this.indent.cast()) |_| {
                        try this.writer.writeByte(' ');
                    }
                }
            };
        }
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

                        // TODO: include 0x85, [0xa0 - 0xd7ff], [0xe000 - 0xfffd], [0x010000 - 0x10ffff]
                        else => false,
                    },
                    .utf16 => switch (c) {
                        ' ', '\t' => false,
                        '\n', '\r' => false,
                        // TODO: exclude BOM

                        ' ' + 1...0x7e => true,

                        // TODO: include 0x85, [0xa0 - 0xd7ff], [0xe000 - 0xfffd], [0x010000 - 0x10ffff]
                        else => false,
                    },
                    .latin1 => switch (c) {
                        // TODO: !!!!
                        else => false,
                    },
                };
            }
            pub fn isNsTagChar(cs: []const encoding.unit()) bool {
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
                    '_',
                    '.',
                    '~',
                    '*',
                    '\'',
                    '(',
                    ')',
                    => true,

                    '!',
                    ',',
                    '[',
                    ']',
                    '{',
                    '}',
                    => false,

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
            pub fn isBChar(c: encoding.unit()) bool {
                return c == '\n' or c == '\r';
            }
            pub fn isSWhite(c: encoding.unit()) bool {
                return c == ' ' or c == '\t';
            }
            pub fn isSWhiteOrNewLine(c: encoding.unit()) bool {
                return c == ' ' or c == '\t' or c == '\n' or c == '\r';
            }
            // pub fn isNsPlainFirst(cs: encoding.unit(), context: ParseContext) bool {
            //     if (cs.len == 0) {
            //         return false;
            //     }

            //     const c1 = cs[0];

            //     if (isNsChar(c1) and !isCIndicator(c1)) {
            //         return false;
            //     }

            //     switch (c1) {
            //         '?',
            //         ':',
            //         '-',
            //         => {
            //             if (cs.len == 1) {
            //                 return false;
            //             }

            //             const c2 = cs[1];
            //             return isNsPlainSafe(c2, context);
            //         },
            //         else => return false,
            //     }
            // }
            // pub fn isNsPlainSafe(c: encoding.unit(), context: ParseContext) bool {
            //     return switch (context) {
            //         .block_out,
            //         .flow_out,
            //         .block_key,
            //         => isNsPlainSafeOut(c),
            //         .block_in,
            //         .flow_in,
            //         .flow_key,
            //         => isNsPlainSafeIn(c),
            //     };
            // }
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
    return struct {
        start: usize,
        indent: Indent,
        line: Line,
        // tag: Tag,
        data: Data,

        const TokenInit = struct {
            start: usize,
            indent: Indent,
            line: Line,
        };

        pub fn eof(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .eof,
                .data = .eof,
            };
        }

        pub fn sequenceEntry(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .sequence_entry,
                .data = .sequence_entry,
            };
        }

        pub fn mappingKey(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .mapping_key,
                .data = .mapping_key,
            };
        }

        pub fn mappingValue(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .mapping_value,
                .data = .mapping_value,
            };
        }

        pub fn collectEntry(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .collect_entry,
                .data = .collect_entry,
            };
        }

        pub fn sequenceStart(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .sequence_start,
                .data = .sequence_start,
            };
        }

        pub fn sequenceEnd(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .sequence_end,
                .data = .sequence_end,
            };
        }

        pub fn mappingStart(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .mapping_start,
                .data = .mapping_start,
            };
        }

        pub fn mappingEnd(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .mapping_end,
                .data = .mapping_end,
            };
        }

        // pub fn comment(init: TokenInit) @This() {
        //     return .{
        //         .start = init.start,
        //         .indent = init.indent,
        //         .line = init.line,
        //         // .tag = .comment,
        //         .data = .comment,
        //     };
        // }

        pub fn anchor(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .anchor,
                .data = .anchor,
            };
        }

        pub fn alias(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .alias,
                .data = .alias,
            };
        }

        pub fn ttag(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .ttag,
                .data = .ttag,
            };
        }

        const LiteralInit = struct {
            start: usize,
            indent: Indent,
            line: Line,
            indent_indicator: Indent.Indicator,
            chomp: Chomp,
        };

        pub fn literal(init: LiteralInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .literal,
                .data = .{ .literal = .{ .kind = .normal, .indent_indicator = init.indent_indicator, .chomp = init.chomp } },
            };
        }

        pub fn folded(init: LiteralInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .folded,
                .data = .{ .folded = .{ .kind = .folded, .indent_indicator = init.indent_indicator, .chomp = init.chomp } },
            };
        }

        // pub fn singleQuote(init: TokenInit) @This() {
        //     return .{
        //         .start = init.start,
        //         .indent = init.indent,
        //         .line = init.line,
        //         // .tag = .single_quote,
        //         .data = .single_quote,
        //     };
        // }

        // pub fn doubleQuote(init: TokenInit) @This() {
        //     return .{
        //         .start = init.start,
        //         .indent = init.indent,
        //         .line = init.line,
        //         // .tag = .double_quote,
        //         .data = .double_quote,
        //     };
        // }

        pub fn directive(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .directive,
                .data = .directive,
            };
        }

        pub fn reserved(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .reserved,
                .data = .reserved,
            };
        }

        pub fn documentStart(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .document_start,
                .data = .document_start,
            };
        }

        pub fn documentEnd(init: TokenInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                // .tag = .document_end,
                .data = .document_end,
            };
        }

        // pub fn whitespace(init: TokenInit) @This() {
        //     return .{
        //         .start = init.start,
        //         .indent = init.indent,
        //         .line = init.line,
        //         // .tag = .whitespace,
        //         .data = .whitespace,
        //     };
        // }

        // const PlainScalarInit = struct {
        //     start: usize,
        //     indent: Indent,
        //     line: Line,
        //     end: usize,

        //     text: Parser.String,
        // };

        // pub fn plainScalar(init: PlainScalarInit) @This() {
        //     return .{
        //         .start = init.start,
        //         .indent = init.indent,
        //         .line = init.line,

        //         // .tag = .plain_scalar,
        //         .data = .plain_scalar,
        //     };
        // }

        const ScalarInit = struct {
            start: usize,
            indent: Indent,
            line: Line,

            resolved: Scalar,

            // text: std.ArrayList(encoding.unit()),
        };

        pub fn scalar(init: ScalarInit) @This() {
            return .{
                .start = init.start,
                .indent = init.indent,
                .line = init.line,
                .data = .{ .scalar = init.resolved },
            };
        }

        const Tag = enum {
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
            // /// `#`
            // comment,
            /// `&`
            anchor,
            /// `*`
            alias,
            /// `!`
            ttag,
            /// `|`
            literal,
            /// `>`
            folded,
            // /// `'`
            // single_quote,
            // /// `"`
            // double_quote,
            /// `%`
            directive,
            /// `@` or `\``
            reserved,

            /// `---`
            document_start,
            /// `...`
            document_end,

            // /// space or tab only
            // whitespace,

            // /// unquoted value
            // plain_scalar,

            scalar,
        };

        pub const Data = union(Tag) {
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
            // /// `#`
            // comment,
            /// `&`
            anchor,
            /// `*`
            alias,
            /// `!`
            ttag,
            /// `|`
            literal: Literal,
            /// `>`
            folded: Literal,
            // /// `'`
            // single_quote,
            // /// `"`
            // double_quote,
            /// `%`
            directive,
            /// `@` or `\``
            reserved,
            /// `---`
            document_start,
            /// `...`
            document_end,
            // /// space or tab only
            // whitespace,
            // /// unquoted value
            // plain_scalar,

            scalar: Scalar,
        };

        pub const Literal = struct {
            kind: Kind,
            indent_indicator: Indent.Indicator,
            chomp: Chomp,

            pub const Kind = enum {
                normal,
                folded,
            };
        };

        pub const Scalar = union(enum) {
            null,
            boolean: bool,
            number: f64,
            string: struct {
                text: Parser(encoding).String,
                multiline: bool,
            },
        };
    };
}
