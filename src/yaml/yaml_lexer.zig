const std = @import("std");
const logger = bun.logger;
const js_ast = bun.JSAst;

const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const CodePoint = bun.CodePoint;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;

const AnchorMap = bun.StringHashMap(js_ast.Expr);
const TagMap = bun.StringHashMap([]const u8);

pub const T = enum {
    t_end_of_file,

    // Basic punctuation
    t_open_bracket, // [ - Flow sequence start
    t_close_bracket, // ] - Flow sequence end
    t_open_brace, // { - Flow mapping start
    t_close_brace, // } - Flow mapping end
    t_comma, // , - Value separator in flow collections
    t_dot, // . - Key separator in dotted keys (a.b.c)
    t_colon, // : - Key/value separator
    t_dash, // - - Block sequence indicator

    // Literals
    t_string_literal, // "quoted" or 'quoted'
    t_numeric_literal, // 123, 3.14, -17
    t_true, // true
    t_false, // false
    t_null, // null

    // YAML specific
    t_indent, // Increased indentation level
    t_dedent, // Decreased indentation level
    t_newline, // Line break
    t_pipe, // | - Literal block scalar
    t_gt, // > - Folded block scalar
    t_document_start, // --- Document start marker
    t_document_end, // ... Document end marker
    t_anchor, // & - Node anchor definition
    t_alias, // * - Node alias reference
    t_tag, // ! - Type tag
    t_question_mark, // ? - Complex mapping key

    // Identifiers
    t_identifier, // Unquoted scalars

    // Merge key state
    t_merge_key, // << - Merge key indicator

    // Document state
    t_directive, // %YAML, %TAG directives
    t_document_indicator, // Document boundary indicator
};

pub const TagHandle = struct {
    handle: []const u8,
    prefix: []const u8,
};

pub const ComplexKey = struct {
    key: js_ast.Expr,
    value: js_ast.Expr,
};

pub const BlockScalarHeader = struct {
    chomping: enum { clip, strip, keep } = .clip,
    indent: ?u8 = null,
    style: enum { literal, folded },
};

pub const Lexer = struct {
    source: logger.Source,
    log: *logger.Log,
    start: usize = 0,
    end: usize = 0,
    current: usize = 0,

    allocator: std.mem.Allocator,

    code_point: CodePoint = -1,
    identifier: []const u8 = "",
    number: f64 = 0.0,
    prev_error_loc: logger.Loc = logger.Loc.Empty,
    string_literal_slice: string = "",
    string_literal_is_ascii: bool = true,
    line_number: u32 = 0,
    token: T = T.t_end_of_file,
    allow_double_bracket: bool = true,

    has_newline_before: bool = false,
    should_redact_logs: bool,

    // Indentation tracking
    indent_stack: std.ArrayList(usize),
    current_indent: usize = 0,
    indent_width: ?usize = null, // Will be set on first indent
    at_line_start: bool = true,
    pending_dedents: usize = 0,

    // Anchor/Alias resolution
    anchors: AnchorMap,
    current_anchor: ?[]const u8 = null,

    // Tag resolution
    tag_library: TagMap,
    current_tag: ?[]const u8 = null,

    // Multi-document handling
    in_document: bool = false,
    document_count: usize = 0,
    has_directives: bool = false,
    explicit_document_start: bool = false,

    // Tag handling
    tag_handles: std.ArrayList(TagHandle),
    current_tag_handle: ?[]const u8,
    current_tag_suffix: ?[]const u8,

    // Flow style state
    flow_level: u15 = 0,
    flow_commas: std.ArrayList(FlowCommaState),

    // Complex mapping state
    complex_key_stack: std.ArrayList(ComplexKey),
    in_complex_key: bool = false,
    complex_key_indent: ?usize = null,

    // Merge key state
    merge_key_stack: std.ArrayList(js_ast.Expr),
    in_merge: bool = false,

    // Block scalar state
    block_scalar_header: ?BlockScalarHeader = null,
    block_scalar_indent: ?usize = null,

    pub const FlowCommaState = packed struct(u32) {
        level: u15,
        has_comma: bool = false,
        elements: u15 = 0,
        allow_trailing: bool = true,
    };

    pub inline fn loc(self: *const Lexer) logger.Loc {
        return logger.usize2Loc(self.start);
    }

    pub fn syntaxError(self: *Lexer) !void {
        @setCold(true);

        // Only add this if there is not already an error.
        // It is possible that there is a more descriptive error already emitted.
        if (!self.log.hasErrors())
            self.addError(self.start, "Syntax Error", .{});

        return Error.SyntaxError;
    }

    pub fn addError(self: *Lexer, _loc: usize, comptime format: []const u8, args: anytype) void {
        @setCold(true);

        var __loc = logger.usize2Loc(_loc);
        if (__loc.eql(self.prev_error_loc)) {
            return;
        }

        self.log.addErrorFmtOpts(
            self.log.msgs.allocator,
            format,
            args,
            .{
                .source = &self.source,
                .loc = __loc,
                .redact_sensitive_information = self.should_redact_logs,
            },
        ) catch unreachable;
        self.prev_error_loc = __loc;
    }

    pub fn addDefaultError(self: *Lexer, msg: []const u8) !void {
        @setCold(true);

        self.addError(self.start, "{s}", .{msg});
        return Error.SyntaxError;
    }

    pub fn addSyntaxError(self: *Lexer, _loc: usize, comptime fmt: []const u8, args: anytype) !void {
        @setCold(true);
        self.addError(_loc, fmt, args);
        return Error.SyntaxError;
    }

    pub fn addRangeError(self: *Lexer, r: logger.Range, comptime format: []const u8, args: anytype) !void {
        @setCold(true);

        if (self.prev_error_loc.eql(r.loc)) {
            return;
        }

        const errorMessage = std.fmt.allocPrint(self.log.msgs.allocator, format, args) catch unreachable;
        try self.log.addErrorOpts(errorMessage, .{
            .source = &self.source,
            .loc = r.loc,
            .len = r.len,
            .redact_sensitive_information = self.should_redact_logs,
        });
        self.prev_error_loc = r.loc;
    }

    /// Look ahead at the next n codepoints without advancing the iterator.
    /// If fewer than n codepoints are available, then return the remainder of the string.
    fn peek(it: *Lexer, n: usize) string {
        const original_i = it.current;
        defer it.current = original_i;

        var end_ix = original_i;
        var found: usize = 0;
        while (found < n) : (found += 1) {
            const next_codepoint = it.nextCodepointSlice();
            if (next_codepoint.len == 0) break;
            end_ix += next_codepoint.len;
        }

        return it.source.contents[original_i..end_ix];
    }

    inline fn nextCodepointSlice(it: *Lexer) []const u8 {
        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(it.source.contents.ptr[it.current]);
        return if (!(cp_len + it.current > it.source.contents.len)) it.source.contents[it.current .. cp_len + it.current] else "";
    }

    inline fn nextCodepoint(it: *Lexer) CodePoint {
        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(it.source.contents.ptr[it.current]);
        const slice = if (!(cp_len + it.current > it.source.contents.len)) it.source.contents[it.current .. cp_len + it.current] else "";

        const code_point = switch (slice.len) {
            0 => -1,
            1 => @as(CodePoint, slice[0]),
            else => strings.decodeWTF8RuneTMultibyte(slice.ptr[0..4], @as(u3, @intCast(slice.len)), CodePoint, strings.unicode_replacement),
        };

        it.end = it.current;

        it.current += if (code_point != strings.unicode_replacement)
            cp_len
        else
            1;

        return code_point;
    }

    inline fn step(lexer: *Lexer) void {
        lexer.code_point = lexer.nextCodepoint();

        lexer.line_number += @as(u32, @intFromBool(lexer.code_point == '\n'));
    }

    pub const Error = error{
        UTF8Fail,
        OutOfMemory,
        SyntaxError,
        UnexpectedSyntax,
        JSONStringsMustUseDoubleQuotes,
        ParserError,
    };

    pub inline fn expect(self: *Lexer, comptime token: T) !void {
        if (self.token != token) {
            try self.expected(token);
        }

        try self.next();
    }

    pub inline fn expectAssignment(self: *Lexer) !void {
        switch (self.token) {
            .t_equal, .t_colon => {},
            else => {
                try self.expected(T.t_equal);
            },
        }

        try self.next();
    }

    pub fn next(lexer: *Lexer) !void {
        lexer.has_newline_before = lexer.end == 0;

        // Handle pending dedents
        if (lexer.pending_dedents > 0) {
            lexer.pending_dedents -= 1;
            lexer.token = T.t_dedent;
            return;
        }

        while (true) {
            lexer.start = lexer.end;
            lexer.token = T.t_end_of_file;

            switch (lexer.code_point) {
                -1 => {
                    // Generate dedents for any remaining indentation levels
                    if (lexer.indent_stack.items.len > 1) {
                        lexer.pending_dedents = lexer.indent_stack.items.len - 1;
                        lexer.indent_stack.shrinkRetainingCapacity(1);
                        lexer.token = T.t_dedent;
                        return;
                    }
                    lexer.token = T.t_end_of_file;
                },

                '\r', '\n', 0x2028, 0x2029 => {
                    lexer.step();
                    lexer.has_newline_before = true;
                    lexer.at_line_start = true;
                    lexer.current_indent = 0;
                    lexer.token = T.t_newline;
                    return;
                },

                ' ' => {
                    if (lexer.at_line_start) {
                        lexer.current_indent += 1;
                    }
                    lexer.step();
                    continue;
                },

                '\t' => {
                    if (lexer.at_line_start) {
                        lexer.current_indent += 8;
                    }
                    lexer.step();
                    continue;
                },

                '[' => {
                    try lexer.parseFlowSequence();
                },
                ']' => {
                    try lexer.endFlowCollection();
                    lexer.token = .t_close_bracket;
                    lexer.step();
                },
                '{' => {
                    try lexer.parseFlowMapping();
                },
                '}' => {
                    try lexer.endFlowCollection();
                    lexer.token = .t_close_brace;
                    lexer.step();
                },
                ':' => {
                    lexer.step();
                    lexer.token = T.t_colon;
                    lexer.at_line_start = false;
                },
                ',' => {
                    lexer.step();
                    lexer.token = T.t_comma;
                    const level = lexer.flow_level;
                    if (level > 0) {
                        var state = &lexer.flow_commas.items[level - 1];
                        state.has_comma = true;
                        state.elements +|= 1;
                    }
                    lexer.at_line_start = false;
                },
                '.' => {
                    lexer.step();
                    if (lexer.code_point == '.' and lexer.peek(1)[0] == '.') {
                        lexer.step();
                        lexer.step();
                        lexer.token = T.t_document_end;
                    } else {
                        lexer.token = T.t_dot;
                    }
                    lexer.at_line_start = false;
                },
                '-' => {
                    lexer.step();
                    if (lexer.code_point == '-' and lexer.peek(1)[0] == '-') {
                        lexer.step();
                        lexer.step();
                        lexer.token = T.t_document_start;
                        lexer.in_document = true;
                        lexer.document_count += 1;
                    } else if (lexer.at_line_start) {
                        try lexer.parseBlockSequenceOrMapping();
                    } else {
                        try lexer.parsePlainScalar();
                    }
                    lexer.at_line_start = false;
                },
                '?' => {
                    if (lexer.at_line_start or lexer.flow_level > 0) {
                        try lexer.parseComplexKey();
                    } else {
                        try lexer.parsePlainScalar();
                    }
                },
                '|' => {
                    try lexer.parseBlockScalar('|');
                    lexer.at_line_start = false;
                },
                '>' => {
                    try lexer.parseBlockScalar('>');
                    lexer.at_line_start = false;
                },
                '&' => {
                    lexer.step();
                    lexer.token = T.t_anchor;
                    lexer.at_line_start = false;
                },
                '*' => {
                    lexer.step();
                    lexer.token = T.t_alias;
                    lexer.at_line_start = false;
                },
                '!' => {
                    try lexer.parseTag();
                },
                '#' => {
                    lexer.step();
                    // Skip comments
                    while (true) {
                        switch (lexer.code_point) {
                            '\r', '\n', 0x2028, 0x2029, -1 => break,
                            else => lexer.step(),
                        }
                    }
                    continue;
                },
                '"' => try lexer.parseDoubleQuotedString(),
                '\'' => try lexer.parseSingleQuotedString(),
                '@', 'a'...'z', 'A'...'Z', '$', '_' => try lexer.parsePlainScalar(),
                '0'...'9' => {
                    try lexer.parseNumericLiteral();
                    lexer.at_line_start = false;
                },
                '<' => {
                    try lexer.parseMergeKey();
                },
                else => try lexer.unexpected(),
            }

            // Handle indentation after processing the token
            if (lexer.at_line_start) {
                const last_indent = lexer.indent_stack.items[lexer.indent_stack.items.len - 1];
                if (lexer.current_indent > last_indent) {
                    // This is an indent
                    try lexer.indent_stack.append(lexer.current_indent);
                    lexer.token = T.t_indent;
                } else if (lexer.current_indent < last_indent) {
                    // This is one or more dedents
                    var dedent_count: usize = 0;
                    while (lexer.indent_stack.items.len > 0 and lexer.current_indent < lexer.indent_stack.items[lexer.indent_stack.items.len - 1]) {
                        _ = lexer.indent_stack.pop();
                        dedent_count += 1;
                    }

                    if (lexer.current_indent != lexer.indent_stack.items[lexer.indent_stack.items.len - 1]) {
                        try lexer.addDefaultError("Invalid indentation");
                    }

                    if (dedent_count > 1) {
                        lexer.pending_dedents = dedent_count - 1;
                    }
                    lexer.token = T.t_dedent;
                }
                lexer.at_line_start = false;
            }

            // Handle flow style comma tracking
            if (lexer.flow_level > 0 and lexer.token == .t_comma) {
                lexer.flow_commas.items[lexer.flow_level - 1].has_comma = true;
            }

            // Handle indentation for complex keys
            if (lexer.in_complex_key and lexer.complex_key_indent != null) {
                if (lexer.current_indent < lexer.complex_key_indent.?) {
                    lexer.in_complex_key = false;
                    lexer.complex_key_indent = null;
                }
            }

            // Handle flow collection state
            if (lexer.flow_level > 0) {
                var state = &lexer.flow_commas.items[lexer.flow_level - 1];

                // Update element count for non-separator tokens
                switch (lexer.token) {
                    .t_comma, .t_open_bracket, .t_open_brace, .t_close_bracket, .t_close_brace => {},
                    else => {
                        if (!state.has_comma and state.elements > 0) {
                            try lexer.addDefaultError("Missing comma between flow collection elements");
                        }
                        state.has_comma = false;
                    },
                }
            }

            return;
        }
    }

    pub fn expected(self: *Lexer, token: T) !void {
        try self.expectedString(@as(string, @tagName(token)));
    }

    pub fn unexpected(lexer: *Lexer) !void {
        const found = finder: {
            lexer.start = @min(lexer.start, lexer.end);

            if (lexer.start == lexer.source.contents.len) {
                break :finder "end of file";
            } else {
                break :finder lexer.raw();
            }
        };

        try lexer.addRangeError(lexer.range(), "Unexpected {s}", .{found});
    }

    pub fn expectedString(self: *Lexer, text: string) !void {
        const found = finder: {
            if (self.source.contents.len != self.start) {
                break :finder self.raw();
            } else {
                break :finder "end of file";
            }
        };

        try self.addRangeError(self.range(), "Expected {s} but found {s}", .{ text, found });
    }

    pub fn range(self: *Lexer) logger.Range {
        return logger.Range{
            .loc = logger.usize2Loc(self.start),
            .len = std.math.lossyCast(i32, self.end - self.start),
        };
    }

    pub fn init(log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator, redact_logs: bool) !Lexer {
        var lex = Lexer{
            .log = log,
            .source = source,
            .prev_error_loc = logger.Loc.Empty,
            .allocator = allocator,
            .should_redact_logs = redact_logs,
            .indent_stack = std.ArrayList(usize).init(allocator),
            .anchors = AnchorMap.init(allocator),
            .tag_library = TagMap.init(allocator),
            .tag_handles = std.ArrayList(TagHandle).init(allocator),
            .flow_commas = std.ArrayList(FlowCommaState).init(allocator),
            .current_tag_handle = null,
            .current_tag_suffix = null,
            .complex_key_stack = std.ArrayList(ComplexKey).init(allocator),
            .merge_key_stack = std.ArrayList(js_ast.Expr).init(allocator),
        };

        // Initialize with base indent level
        try lex.indent_stack.append(0);

        // Add default tag handles
        try lex.tag_handles.append(.{ .handle = "!", .prefix = "!" });
        try lex.tag_handles.append(.{ .handle = "!!", .prefix = "tag:yaml.org,2002:" });

        lex.step();
        try lex.next();

        return lex;
    }

    pub inline fn toString(lexer: *Lexer, loc_: logger.Loc) js_ast.Expr {
        if (lexer.string_literal_is_ascii) {
            return js_ast.Expr.init(js_ast.E.String, js_ast.E.String{ .data = lexer.string_literal_slice }, loc_);
        }

        return js_ast.Expr.init(
            js_ast.E.String,
            .{ .data = lexer.string_literal_slice },
            loc_,
        );
    }

    pub fn raw(self: *Lexer) []const u8 {
        return self.source.contents[self.start..self.end];
    }

    fn parseNumericLiteral(lexer: *Lexer) !void {
        lexer.token = T.t_numeric_literal;
        var has_exponent = false;
        var has_dot = false;

        // Check for leading sign
        if (lexer.code_point == '-' or lexer.code_point == '+') {
            lexer.step();
        }

        // Parse integer part
        while (true) {
            switch (lexer.code_point) {
                '0'...'9' => {
                    lexer.step();
                },
                '.' => {
                    if (has_dot) {
                        try lexer.syntaxError();
                    }
                    has_dot = true;
                    lexer.step();
                },
                'e', 'E' => {
                    if (has_exponent) {
                        try lexer.syntaxError();
                    }
                    has_exponent = true;
                    lexer.step();
                    if (lexer.code_point == '-' or lexer.code_point == '+') {
                        lexer.step();
                    }
                },
                else => break,
            }
        }

        // Convert to number
        const text = lexer.raw();
        if (std.fmt.parseFloat(f64, text)) |num| {
            lexer.number = num;
        } else |_| {
            try lexer.addSyntaxError(lexer.start, "Invalid number", .{});
        }
    }

    pub fn parseBlockScalar(lexer: *Lexer, style: u8) !void {
        // Parse block scalar header
        var header = BlockScalarHeader{
            .style = if (style == '|') .literal else .folded,
        };

        var header_done = false;
        while (!header_done) {
            switch (lexer.code_point) {
                '-' => {
                    header.chomping = .strip;
                    lexer.step();
                },
                '+' => {
                    header.chomping = .keep;
                    lexer.step();
                },
                '1'...'9' => {
                    if (header.indent != null) {
                        try lexer.addDefaultError("Multiple indent indicators in block scalar header");
                    }
                    header.indent = @intCast(lexer.code_point - '0');
                    lexer.step();
                },
                '\n', '\r' => header_done = true,
                ' ', '\t' => lexer.step(), // Skip whitespace
                else => header_done = true,
            }
        }

        // Skip whitespace and comments until content
        while (true) {
            switch (lexer.code_point) {
                ' ', '\t' => lexer.step(),
                '#' => {
                    // Skip comment
                    while (lexer.code_point != -1 and
                        lexer.code_point != '\n' and
                        lexer.code_point != '\r')
                    {
                        lexer.step();
                    }
                },
                '\n', '\r' => |char| {
                    const cr = char == '\r';
                    lexer.step();
                    if (lexer.code_point == '\n' and cr) {
                        lexer.step();
                    }
                    break;
                },
                else => break,
            }
        }

        // Determine content indentation
        const content_indent = if (header.indent) |i|
            lexer.current_indent + i
        else blk: {
            var min_indent: ?usize = null;
            var pos = lexer.current;
            var line_start = true;
            var current_indent: usize = 0;

            while (pos < lexer.source.contents.len) {
                const c = lexer.source.contents[pos];
                switch (c) {
                    '\n', '\r' => {
                        line_start = true;
                        current_indent = 0;
                    },
                    ' ' => {
                        if (line_start) current_indent += 1;
                    },
                    '\t' => {
                        if (line_start) current_indent += 8;
                    },
                    else => {
                        if (line_start and c != '\n' and c != '\r') {
                            if (min_indent == null or current_indent < min_indent.?) {
                                min_indent = current_indent;
                            }
                        }
                        line_start = false;
                    },
                }
                pos += 1;
            }
            break :blk min_indent orelse lexer.current_indent + 1;
        };

        var content = std.ArrayList(u8).init(lexer.allocator);
        errdefer content.deinit();

        var trailing_empty = false;
        var line_start = true;
        var empty_lines: usize = 0;
        var first_content = true;

        // Process content lines
        while (lexer.code_point != -1) {
            if (line_start) {
                var current_indent: usize = 0;
                // Count indentation
                while (lexer.code_point == ' ' or lexer.code_point == '\t') {
                    current_indent += if (lexer.code_point == ' ') 1 else 8;
                    lexer.step();
                }

                // Check if this line belongs to the scalar
                if (current_indent < content_indent and
                    lexer.code_point != '\n' and
                    lexer.code_point != '\r' and
                    lexer.code_point != -1)
                {
                    break;
                }

                // Handle more-indented lines
                if (current_indent > content_indent) {
                    var extra = current_indent - content_indent;
                    while (extra > 0) : (extra -= 1) {
                        try content.append(' ');
                    }
                }
            }

            // Process line content
            var line_empty = true;
            var line = std.ArrayList(u8).init(lexer.allocator);
            defer line.deinit();

            while (lexer.code_point != -1 and
                lexer.code_point != '\n' and
                lexer.code_point != '\r')
            {
                try line.append(@intCast(lexer.code_point));
                line_empty = false;
                lexer.step();
            }

            // Handle line endings
            if (lexer.code_point == '\n' or lexer.code_point == '\r') {
                trailing_empty = line_empty;

                if (line_empty) {
                    empty_lines += 1;
                } else {
                    // Add pending empty lines
                    if (empty_lines > 0) {
                        var i: usize = 0;
                        while (i < empty_lines) : (i += 1) {
                            try content.append('\n');
                        }
                    }

                    // Add line content with proper folding
                    if (header.style == .folded and !first_content) {
                        const peek_ahead = lexer.peek(1);
                        const at_boundary = peek_ahead.len == 0 or
                            peek_ahead[0] == '\n' or
                            peek_ahead[0] == '\r' or
                            (peek_ahead.len > 1 and (peek_ahead[1] == ' ' or peek_ahead[1] == '\t'));

                        if (!at_boundary) {
                            try content.append(' ');
                        } else {
                            try content.append('\n');
                        }
                    } else {
                        if (!first_content) {
                            try content.append('\n');
                        }
                    }

                    try content.appendSlice(line.items);
                    empty_lines = 0;
                    first_content = false;
                }

                // Handle line ending
                if (lexer.code_point == '\r') {
                    lexer.step();
                    if (lexer.code_point == '\n') {
                        lexer.step();
                    }
                } else {
                    lexer.step();
                }
                line_start = true;
            }
        }

        // Apply chomping rules
        var final_content = content.items;
        switch (header.chomping) {
            .strip => {
                // Remove all trailing newlines
                while (final_content.len > 0 and final_content[final_content.len - 1] == '\n') {
                    final_content.len -= 1;
                }
            },
            .clip => {
                // Keep at most one trailing newline
                while (final_content.len > 1 and
                    final_content[final_content.len - 1] == '\n' and
                    final_content[final_content.len - 2] == '\n')
                {
                    final_content.len -= 1;
                }
            },
            .keep => {
                // Keep all trailing newlines
                if (empty_lines > 0 and
                    final_content.len > 0 and
                    final_content[final_content.len - 1] != '\n')
                {
                    var i: usize = 0;
                    while (i < empty_lines) : (i += 1) {
                        content.append('\n') catch break;
                    }
                    final_content = content.items;
                }
            },
        }

        lexer.string_literal_slice = try lexer.allocator.dupe(u8, final_content);
        lexer.token = .t_string_literal;
    }

    fn foldLine(lexer: *Lexer, line: []const u8) ![]const u8 {
        var result = std.ArrayList(u8).init(lexer.allocator);
        errdefer result.deinit();

        var i: usize = 0;
        var last_was_space = false;

        while (i < line.len) {
            switch (line[i]) {
                ' ' => {
                    if (!last_was_space) {
                        try result.append(' ');
                    }
                    last_was_space = true;
                },
                '\n', '\r' => {
                    if (i > 0 and line[i - 1] == ' ') {
                        // Line break after space - convert to single space
                        if (!last_was_space) {
                            try result.append(' ');
                        }
                    } else {
                        // Preserve line break if not after space
                        try result.append('\n');
                    }
                    last_was_space = true;
                },
                else => {
                    try result.append(line[i]);
                    last_was_space = false;
                },
            }
            i += 1;
        }

        return result.items;
    }

    fn parseTag(lexer: *Lexer) !void {
        lexer.step(); // consume '!'

        // Parse tag handle
        var handle = std.ArrayList(u8).init(lexer.allocator);
        defer handle.deinit();

        if (lexer.code_point == '!') {
            try handle.append('!');
            lexer.step();

            // Parse named tag handle
            while (lexer.code_point != -1 and lexer.code_point != ' ' and lexer.code_point != '\n') {
                try handle.append(@intCast(lexer.code_point));
                lexer.step();
            }
        } else {
            try handle.append('!');
        }

        // Look up tag handle
        for (lexer.tag_handles.items) |tag_handle| {
            if (std.mem.eql(u8, tag_handle.handle, handle.items)) {
                lexer.current_tag_handle = tag_handle.handle;
                break;
            }
        }

        if (lexer.current_tag_handle == null) {
            try lexer.addDefaultError("Unknown tag handle");
            return;
        }

        // Parse tag suffix
        var suffix = std.ArrayList(u8).init(lexer.allocator);
        defer suffix.deinit();

        while (lexer.code_point != -1 and lexer.code_point != ' ' and
            lexer.code_point != '\n' and lexer.code_point != '}' and
            lexer.code_point != ']' and lexer.code_point != ',')
        {
            try suffix.append(@intCast(lexer.code_point));
            lexer.step();
        }

        if (suffix.items.len > 0) {
            lexer.current_tag_suffix = try lexer.allocator.dupe(u8, suffix.items);
        }

        lexer.token = .t_tag;
    }

    fn parseFlowSequence(lexer: *Lexer) !void {
        lexer.flow_level +|= 1;
        try lexer.flow_commas.append(.{
            .level = lexer.flow_level,
            .has_comma = false,
            .elements = 0,
            .allow_trailing = true,
        });
        lexer.token = .t_open_bracket;
        lexer.step();
    }

    fn parseFlowMapping(lexer: *Lexer) !void {
        lexer.flow_level +|= 1;
        try lexer.flow_commas.append(.{
            .level = lexer.flow_level,
            .has_comma = false,
            .elements = 0,
            .allow_trailing = true,
        });
        lexer.token = .t_open_brace;
        lexer.step();

        // Track if we're in a complex key context
        if (lexer.in_complex_key) {
            try lexer.complex_key_stack.append(.{
                .key = undefined,
                .value = undefined,
            });
        }
    }

    fn endFlowCollection(lexer: *Lexer) !void {
        if (lexer.flow_level > 0) {
            const state = lexer.flow_commas.items[lexer.flow_level - 1];

            // Check for trailing comma
            if (state.has_comma and !state.allow_trailing) {
                try lexer.addDefaultError("Unexpected trailing comma in flow collection");
            }

            // Check for empty collection
            if (state.elements == 0 and state.has_comma) {
                try lexer.addDefaultError("Empty flow collection cannot have a trailing comma");
            }

            lexer.flow_level -|= 1;
            _ = lexer.flow_commas.pop();

            // Handle complex key resolution
            if (lexer.in_complex_key and lexer.complex_key_stack.items.len > 0) {
                _ = lexer.complex_key_stack.pop();
                if (lexer.complex_key_stack.items.len == 0) {
                    lexer.in_complex_key = false;
                    lexer.complex_key_indent = null;
                }
            }
        }
    }

    pub fn resolveTag(lexer: *Lexer, value: []const u8) ![]const u8 {
        if (lexer.current_tag_handle) |handle| {
            for (lexer.tag_handles.items) |tag_handle| {
                if (std.mem.eql(u8, handle, tag_handle.handle)) {
                    var resolved = std.ArrayList(u8).init(lexer.allocator);
                    defer resolved.deinit();

                    try resolved.appendSlice(tag_handle.prefix);
                    if (lexer.current_tag_suffix) |suffix| {
                        try resolved.appendSlice(suffix);
                    }

                    // Handle predefined tags
                    const tag = resolved.items;
                    if (std.mem.eql(u8, tag, "tag:yaml.org,2002:str")) {
                        return value;
                    } else if (std.mem.eql(u8, tag, "tag:yaml.org,2002:int")) {
                        _ = std.fmt.parseInt(i64, value, 10) catch return value;
                        return value;
                    } else if (std.mem.eql(u8, tag, "tag:yaml.org,2002:float")) {
                        _ = std.fmt.parseFloat(f64, value) catch return value;
                        return value;
                    } else if (std.mem.eql(u8, tag, "tag:yaml.org,2002:null")) {
                        return "null";
                    } else if (std.mem.eql(u8, tag, "tag:yaml.org,2002:bool")) {
                        if (std.mem.eql(u8, value, "true") or std.mem.eql(u8, value, "false")) {
                            return value;
                        }
                    }

                    // Custom tag
                    return tag;
                }
            }
        }

        return value;
    }

    fn parseDoubleQuotedString(lexer: *Lexer) !void {
        lexer.step(); // consume opening quote
        lexer.string_literal_is_ascii = true;
        var result = std.ArrayList(u8).init(lexer.allocator);
        errdefer result.deinit();
        var was_carriage_return = false;

        while (true) {
            switch (lexer.code_point) {
                -1 => {
                    try lexer.addDefaultError("Unterminated double-quoted string");
                    return;
                },
                '"' => {
                    lexer.step();
                    break;
                },
                '\\' => {
                    lexer.step();
                    switch (lexer.code_point) {
                        '0' => try result.append(0),
                        'a' => try result.append(7),
                        'b' => try result.append(8),
                        't', '\t' => try result.append('\t'),
                        'n' => try result.append('\n'),
                        'v' => try result.append(11),
                        'f' => try result.append(12),
                        'r' => try result.append('\r'),
                        'e' => try result.append(27),
                        ' ' => try result.append(32),
                        '"' => try result.append('"'),
                        '/' => try result.append('/'),
                        '\\' => try result.append('\\'),
                        'N' => { // NEL (#x85)
                            try result.append(0xC2);
                            try result.append(0x85);
                            lexer.string_literal_is_ascii = false;
                        },
                        '_' => { // #xA0
                            try result.append(0xC2);
                            try result.append(0xA0);
                            lexer.string_literal_is_ascii = false;
                        },
                        'L' => { // LS (#x2028)
                            try result.append(0xE2);
                            try result.append(0x80);
                            try result.append(0xA8);
                            lexer.string_literal_is_ascii = false;
                        },
                        'P' => { // PS (#x2029)
                            try result.append(0xE2);
                            try result.append(0x80);
                            try result.append(0xA9);
                            lexer.string_literal_is_ascii = false;
                        },
                        'x' => {
                            // Parse 2-digit hex number
                            const high = try parseHexDigit(lexer);
                            lexer.step();
                            const low = try parseHexDigit(lexer);
                            try result.append((high << 4) | low);
                        },
                        'u' => {
                            // Parse 4-digit hex number
                            var value: u16 = 0;
                            var i: usize = 0;
                            while (i < 4) : (i += 1) {
                                lexer.step();
                                const digit = try parseHexDigit(lexer);
                                value = (value << 4) | digit;
                            }
                            if (value <= 0x7F) {
                                try result.append(@intCast(value));
                            } else if (value <= 0x7FF) {
                                try result.append(@intCast(0xC0 | (value >> 6)));
                                try result.append(@intCast(0x80 | (value & 0x3F)));
                                lexer.string_literal_is_ascii = false;
                            } else {
                                try result.append(@intCast(0xE0 | (value >> 12)));
                                try result.append(@intCast(0x80 | ((value >> 6) & 0x3F)));
                                try result.append(@intCast(0x80 | (value & 0x3F)));
                                lexer.string_literal_is_ascii = false;
                            }
                        },
                        'U' => {
                            // Parse 8-digit hex number
                            var value: u32 = 0;
                            var i: usize = 0;
                            while (i < 8) : (i += 1) {
                                lexer.step();
                                const digit = try parseHexDigit(lexer);
                                value = (value << 4) | digit;
                            }
                            if (value <= 0x7F) {
                                try result.append(@intCast(value));
                            } else if (value <= 0x7FF) {
                                try result.append(@intCast(0xC0 | (value >> 6)));
                                try result.append(@intCast(0x80 | (value & 0x3F)));
                                lexer.string_literal_is_ascii = false;
                            } else if (value <= 0xFFFF) {
                                try result.append(@intCast(0xE0 | (value >> 12)));
                                try result.append(@intCast(0x80 | ((value >> 6) & 0x3F)));
                                try result.append(@intCast(0x80 | (value & 0x3F)));
                                lexer.string_literal_is_ascii = false;
                            } else {
                                try result.append(@intCast(0xF0 | (value >> 18)));
                                try result.append(@intCast(0x80 | ((value >> 12) & 0x3F)));
                                try result.append(@intCast(0x80 | ((value >> 6) & 0x3F)));
                                try result.append(@intCast(0x80 | (value & 0x3F)));
                                lexer.string_literal_is_ascii = false;
                            }
                        },
                        '\r', '\n' => |t| {
                            // Line continuation
                            lexer.step();
                            if (lexer.code_point == '\n' and was_carriage_return) {
                                lexer.step();
                            }
                            was_carriage_return = t == '\r';
                            // Skip whitespace
                            while (lexer.code_point == ' ' or lexer.code_point == '\t') {
                                lexer.step();
                            }
                        },
                        else => try lexer.addDefaultError("Invalid escape sequence"),
                    }
                    lexer.step();
                },
                '\r', '\n' => {
                    try lexer.addDefaultError("Unescaped line break in double-quoted string");
                    return;
                },
                else => {
                    if (lexer.code_point > 0x7F) {
                        lexer.string_literal_is_ascii = false;
                    }
                    try result.append(@intCast(lexer.code_point));
                    lexer.step();
                },
            }
        }

        lexer.string_literal_slice = try lexer.allocator.dupe(u8, result.items);
        lexer.token = .t_string_literal;
    }

    fn parseSingleQuotedString(lexer: *Lexer) !void {
        lexer.step(); // consume opening quote
        lexer.string_literal_is_ascii = true;
        var result = std.ArrayList(u8).init(lexer.allocator);
        errdefer result.deinit();

        while (true) {
            switch (lexer.code_point) {
                -1 => {
                    try lexer.addDefaultError("Unterminated single-quoted string");
                    return;
                },
                '\'' => {
                    lexer.step();
                    // Check for escaped single quote ('') which represents a literal single quote
                    if (lexer.code_point == '\'') {
                        try result.append('\'');
                        lexer.step();
                    } else {
                        break;
                    }
                },
                '\r', '\n' => {
                    try lexer.addDefaultError("Unescaped line break in single-quoted string");
                    return;
                },
                else => {
                    if (lexer.code_point > 0x7F) {
                        lexer.string_literal_is_ascii = false;
                    }
                    try result.append(@intCast(lexer.code_point));
                    lexer.step();
                },
            }
        }

        lexer.string_literal_slice = try lexer.allocator.dupe(u8, result.items);
        lexer.token = .t_string_literal;
    }

    fn parsePlainScalar(lexer: *Lexer) !void {
        var result = std.ArrayList(u8).init(lexer.allocator);
        errdefer result.deinit();

        var first = true;
        var spaces: usize = 0;

        while (true) {
            switch (lexer.code_point) {
                -1, '\r', '\n' => break,
                ' ' => {
                    spaces += 1;
                    lexer.step();
                },
                '\t' => {
                    spaces += 8;
                    lexer.step();
                },
                ':', ',', ']', '}', '|', '>', '\'', '"', '#', '&', '*', '!', '%', '@', '`' => {
                    if (first) {
                        try lexer.addDefaultError("Invalid start of plain scalar");
                        return;
                    }
                    // These characters can only appear if followed by whitespace or line end
                    const peek_ahead = lexer.peek(1);
                    if (peek_ahead.len == 0 or peek_ahead[0] == ' ' or peek_ahead[0] == '\t' or peek_ahead[0] == '\r' or peek_ahead[0] == '\n') {
                        break;
                    }
                    try result.append(@intCast(lexer.code_point));
                    lexer.step();
                },
                else => {
                    if (spaces > 0) {
                        if (result.items.len > 0) {
                            try result.append(' ');
                        }
                        spaces = 0;
                    }
                    try result.append(@intCast(lexer.code_point));
                    lexer.step();
                    first = false;
                },
            }
        }

        // Trim trailing spaces
        while (result.items.len > 0 and result.items[result.items.len - 1] == ' ') {
            result.items.len -= 1;
        }

        if (result.items.len == 0) {
            try lexer.addDefaultError("Empty plain scalar");
            return;
        }

        const SpecialScalarMap = bun.ComptimeStringMap(T, .{
            .{ "-.inf", .t_numeric_literal },
            .{ ".NAN", .t_numeric_literal },
            .{ ".NaN", .t_numeric_literal },
            .{ ".inf", .t_numeric_literal },
            .{ ".nan", .t_numeric_literal },
            .{ "FALSE", .t_false },
            .{ "False", .t_false },
            .{ "NULL", .t_null },
            .{ "Null", .t_null },
            .{ "TRUE", .t_true },
            .{ "True", .t_true },
            .{ "false", .t_false },
            .{ "null", .t_null },
            .{ "true", .t_true },
            .{ "~", .t_null },
        });
        _ = SpecialScalarMap; // autofix

        // Check for special values
        const value = result.items;
        if (std.mem.eql(u8, value, "null") or std.mem.eql(u8, value, "Null") or std.mem.eql(u8, value, "NULL") or std.mem.eql(u8, value, "~")) {
            lexer.token = .t_null;
        } else if (std.mem.eql(u8, value, "true") or std.mem.eql(u8, value, "True") or std.mem.eql(u8, value, "TRUE")) {
            lexer.token = .t_true;
        } else if (std.mem.eql(u8, value, "false") or std.mem.eql(u8, value, "False") or std.mem.eql(u8, value, "FALSE")) {
            lexer.token = .t_false;
        } else if (std.mem.eql(u8, value, ".inf") or std.mem.eql(u8, value, ".Inf") or std.mem.eql(u8, value, ".INF")) {
            lexer.number = std.math.inf(f64);
            lexer.token = .t_numeric_literal;
        } else if (std.mem.eql(u8, value, "-.inf") or std.mem.eql(u8, value, "-.Inf") or std.mem.eql(u8, value, "-.INF")) {
            lexer.number = -std.math.inf(f64);
            lexer.token = .t_numeric_literal;
        } else if (std.mem.eql(u8, value, ".nan") or std.mem.eql(u8, value, ".NaN") or std.mem.eql(u8, value, ".NAN")) {
            lexer.number = std.math.nan(f64);
            lexer.token = .t_numeric_literal;
        } else if (try parseTimestamp(value)) |timestamp| {
            lexer.string_literal_slice = timestamp;
            lexer.token = .t_string_literal;
        } else {
            lexer.string_literal_slice = try lexer.allocator.dupe(u8, value);
            lexer.token = .t_string_literal;
        }
    }

    fn parseHexDigit(lexer: *Lexer) !u8 {
        return switch (lexer.code_point) {
            '0'...'9' => |c| @intCast(c - '0'),
            'a'...'f' => |c| @intCast(c - 'a' + 10),
            'A'...'F' => |c| @intCast(c - 'A' + 10),
            else => {
                try lexer.addDefaultError("Invalid hex digit");
                return 0;
            },
        };
    }

    fn parseComplexKey(lexer: *Lexer) !void {
        lexer.step(); // consume '?'
        lexer.token = .t_question_mark;
        lexer.in_complex_key = true;
        lexer.complex_key_indent = lexer.current_indent;
    }

    fn parseBlockSequenceOrMapping(lexer: *Lexer) !void {
        const start_indent = lexer.current_indent;
        var is_sequence = false;
        var is_mapping = false;

        // Look ahead to determine the type
        var pos = lexer.current;
        var line_start = true;
        var current_indent: usize = 0;
        const end = lexer.source.contents.len;
        const contents = lexer.source.contents;

        while (pos < end) {
            const c = contents[pos];
            switch (c) {
                '\n', '\r' => {
                    line_start = true;
                    current_indent = 0;
                },
                ' ' => {
                    if (line_start) current_indent += 1;
                },
                '\t' => {
                    if (line_start) current_indent += 8;
                },
                '-' => {
                    if (line_start and current_indent > start_indent) {
                        // Check if it's followed by a space or newline
                        if (pos + 1 < end) {
                            const peek_char = switch (contents[pos + 1]) {
                                ' ', '\n', '\r' => true,
                                else => false,
                            };
                            if (peek_char) {
                                is_sequence = true;
                                break;
                            }
                        }
                    }
                    line_start = false;
                },
                '?' => {
                    if (line_start and current_indent > start_indent) {
                        is_mapping = true;
                        break;
                    }
                    line_start = false;
                },
                ':' => {
                    if (line_start and current_indent > start_indent) {
                        is_mapping = true;
                        break;
                    }
                    line_start = false;
                },
                else => {
                    line_start = false;
                },
            }
            pos += 1;
        }

        if (is_sequence) {
            lexer.token = .t_dash;
        } else if (is_mapping) {
            // Handle complex mapping
            if (contents[lexer.current] == '?') {
                try lexer.parseComplexKey();
            } else {
                lexer.token = .t_colon;
            }
        }
    }

    fn parseTimestamp(value: []const u8) !?[]const u8 {
        _ = value; // autofix
        // ISO8601 timestamp formats:
        // YYYY-MM-DD
        // YYYY-MM-DD HH:MM:SS
        // YYYY-MM-DD HH:MM:SS.fff
        // YYYY-MM-DD HH:MM:SS.fff+HH:MM
        // YYYY-MM-DD HH:MM:SS.fff-HH:MM
        // YYYY-MM-DD HH:MM:SS.fffZ

        // const patterns = [_][]const u8{
        //     "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
        //     "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$",
        //     "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}$",
        //     "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}[+-][0-9]{2}:[0-9]{2}$",
        //     "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
        // };

        // for (patterns) |pattern| {
        //     // TODO: Implement proper regex matching
        //     // For now, just check basic format
        //     if (value.len == pattern.len) {
        //         var matches = true;
        //         for (pattern, value) |p, v| {
        //             switch (p) {
        //                 '^', '$' => continue,
        //                 '[' => continue,
        //                 ']' => continue,
        //                 '\\' => continue,
        //                 '{' => continue,
        //                 '}' => continue,
        //                 '+' => if (v != '+' and v != '-') {
        //                     matches = false;
        //                     break;
        //                 },
        //                 else => if (p != v) {
        //                     matches = false;
        //                     break;
        //                 },
        //             }
        //         }
        //         if (matches) {
        //             return value;
        //         }
        //     }
        // }
        // TODO: use JavaScriptCore V8 date parser.
        return null;
    }

    fn parseMergeKey(lexer: *Lexer) !void {
        // Check for merge key "<<"
        if (lexer.code_point == '<') {
            lexer.step();
            if (lexer.code_point == '<') {
                lexer.step();
                lexer.token = .t_merge_key;
                lexer.in_merge = true;
                return;
            }
        }
        try lexer.parsePlainScalar();
    }

    fn parseDirective(lexer: *Lexer) !void {
        lexer.step(); // skip %
        lexer.has_directives = true;

        // Parse directive name
        var name = std.ArrayList(u8).init(lexer.allocator);
        defer name.deinit();

        while (lexer.code_point != -1 and
            lexer.code_point != ' ' and
            lexer.code_point != '\t' and
            lexer.code_point != '\n' and
            lexer.code_point != '\r')
        {
            try name.append(@intCast(lexer.code_point));
            lexer.step();
        }

        // Skip whitespace
        while (lexer.code_point == ' ' or lexer.code_point == '\t') {
            lexer.step();
        }

        // Handle different directives
        if (std.mem.eql(u8, name.items, "YAML")) {
            // Parse version number
            var version = std.ArrayList(u8).init(lexer.allocator);
            defer version.deinit();

            while (lexer.code_point != -1 and
                lexer.code_point != '\n' and
                lexer.code_point != '\r')
            {
                try version.append(@intCast(lexer.code_point));
                lexer.step();
            }

            if (!std.mem.eql(u8, version.items, "1.2")) {
                try lexer.addDefaultError("Unsupported YAML version");
            }
        } else if (std.mem.eql(u8, name.items, "TAG")) {
            try lexer.parseTagDirective();
        }

        lexer.token = .t_directive;
    }
};

pub fn isIdentifierPart(code_point: CodePoint) bool {
    return switch (code_point) {
        '0'...'9',
        'a'...'z',
        'A'...'Z',
        '$',
        '_',
        '-',
        ':',
        => true,
        else => false,
    };
}

pub fn isLatin1Identifier(comptime Buffer: type, name: Buffer) bool {
    if (name.len == 0) return false;

    switch (name[0]) {
        'a'...'z',
        'A'...'Z',
        '$',
        '1'...'9',
        '_',
        '-',
        => {},
        else => return false,
    }

    if (name.len > 0) {
        for (name[1..]) |c| {
            switch (c) {
                '0'...'9',
                'a'...'z',
                'A'...'Z',
                '$',
                '_',
                '-',
                => {},
                else => return false,
            }
        }
    }

    return true;
}

inline fn float64(num: anytype) f64 {
    return @as(f64, @floatFromInt(num));
}
