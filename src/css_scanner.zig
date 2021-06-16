const Fs = @import("fs.zig");
const std = @import("std");
usingnamespace @import("global.zig");
const options = @import("./options.zig");
const import_record = @import("import_record.zig");
const logger = @import("./logger.zig");
const Options = options;

const replacementCharacter = 0xFFFD;

pub const Chunk = struct {
    // Entire chunk
    range: logger.Range,
    content: Content,

    pub const Content = union(Tag) {
        t_url: TextContent,
        t_import: Import,
        t_verbatim: Verbatim,
    };

    pub fn raw(chunk: *const Chunk, source: *const logger.Source) string {
        return source.contents[chunk.range.loc.start..][0..chunk.range.len];
    }

    // pub fn string(chunk: *const Chunk, source: *const logger.Source) string {
    //     switch (chunk.content) {
    //         .t_url => |url| {
    //             var str = url.utf8;
    //             var start: i32 = 4;
    //             var end: i32 = chunk.range.len - 1;

    //             while (start < end and isWhitespace(str[start])) {
    //                 start += 1;
    //             }

    //             while (start < end and isWhitespace(str[end - 1])) {
    //                 end -= 1;
    //             }

    //             return str;
    //         },
    //         .t_import => |import| {
    //             if (import.url) {}
    //         },
    //         else => {
    //             return chunk.raw(source);
    //         },
    //     }
    // }

    pub const TextContent = struct {
        quote: Quote = .none,
        utf8: string,
        valid: bool = true,
        needs_decode_escape: bool = false,

        pub const Quote = enum {
            none,
            double,
            single,
        };
    };
    pub const Import = struct {
        url: bool = false,
        text: TextContent,

        supports: string = "",

        // @import can contain media queries and other stuff
        media_queries_str: string = "",

        suffix: string = "",
    };
    pub const Verbatim = struct {};

    pub const Tag = enum {
        t_url,
        t_verbatim,
        t_import,
    };
};

pub const Token = enum {
    t_end_of_file,
    t_semicolon,
    t_whitespace,
    t_at_import,
    t_url,
    t_verbatim,
    t_string,
    t_bad_string,
};

const escLineFeed = 0x0C;
// This is not a CSS parser.
// All this does is scan for URLs and @import statements
// Once found, it resolves & rewrites them
// Eventually, there will be a real CSS parser in here.
// But, no time yet.
pub fn NewScanner(
    comptime WriterType: type,
) type {
    return struct {
        const Scanner = @This();
        current: usize = 0,
        start: usize = 0,
        end: usize = 0,
        log: *logger.Log,

        has_newline_before: bool = false,
        has_delimiter_before: bool = false,
        allocator: *std.mem.Allocator,

        source: *const logger.Source,
        writer: WriterType,
        codepoint: CodePoint = -1,
        approximate_newline_count: usize = 0,

        pub fn init(log: *logger.Log, allocator: *std.mem.Allocator, writer: WriterType, source: *const logger.Source) Scanner {
            return Scanner{ .writer = writer, .log = log, .source = source, .allocator = allocator };
        }

        pub fn range(scanner: *Scanner) logger.Range {
            return logger.Range{
                .loc = .{ .start = @intCast(i32, scanner.start) },
                .len = @intCast(i32, scanner.end - scanner.start),
            };
        }

        pub fn step(scanner: *Scanner) void {
            scanner.codepoint = scanner.nextCodepoint();
            scanner.approximate_newline_count += @boolToInt(scanner.codepoint == '\n');
        }
        pub fn raw(scanner: *Scanner) string {}

        pub fn isValidEscape(scanner: *Scanner) bool {
            if (scanner.codepoint != '\\') return false;
            const slice = scanner.nextCodepointSlice(false);
            return switch (slice.len) {
                0 => false,
                1 => true,
                2 => (std.unicode.utf8Decode2(slice) catch 0) > 0,
                3 => (std.unicode.utf8Decode3(slice) catch 0) > 0,
                4 => (std.unicode.utf8Decode4(slice) catch 0) > 0,
                else => false,
            };
        }

        pub fn consumeString(scanner: *Scanner, comptime quote: CodePoint) ?string {
            const start = scanner.current;
            scanner.step();

            while (true) {
                switch (scanner.codepoint) {
                    '\\' => {
                        scanner.step();
                        // Handle Windows CRLF
                        if (scanner.codepoint == '\r') {
                            scanner.step();
                            if (scanner.codepoint == '\n') {
                                scanner.step();
                            }
                            continue;
                        }

                        // Otherwise, fall through to ignore the character after the backslash
                    },
                    -1 => {
                        scanner.end = scanner.current;
                        scanner.log.addRangeError(
                            scanner.source,
                            scanner.range(),
                            "Unterminated string token",
                        ) catch unreachable;
                        return null;
                    },
                    '\n', '\r', escLineFeed => {
                        scanner.end = scanner.current;
                        scanner.log.addRangeError(
                            scanner.source,
                            scanner.range(),
                            "Unterminated string token",
                        ) catch unreachable;
                        return null;
                    },
                    quote => {
                        scanner.step();
                        return scanner.source.contents[start..scanner.current];
                    },
                    else => {},
                }
                scanner.step();
            }
            unreachable;
        }

        pub fn consumeURL(scanner: *Scanner) Chunk.TextContent {
            var text = Chunk.TextContent{ .utf8 = "" };
            const start = scanner.end;
            validURL: while (true) {
                switch (scanner.codepoint) {
                    ')' => {
                        scanner.step();
                        text.utf8 = scanner.source.contents[start..scanner.current];
                        return text;
                    },
                    -1 => {
                        const loc = logger.Loc{ .start = @intCast(i32, scanner.end) };
                        scanner.log.addError(scanner.source, loc, "Expected \")\" to end URL token") catch {};
                        return text;
                    },
                    '\t', '\n', '\r', escLineFeed => {
                        scanner.step();
                        while (isWhitespace(scanner.codepoint)) {
                            scanner.step();
                        }

                        if (scanner.codepoint != ')') {
                            const loc = logger.Loc{ .start = @intCast(i32, scanner.end) };
                            scanner.log.addError(scanner.source, loc, "Expected \")\" to end URL token") catch {};
                            break :validURL;
                        }
                        scanner.step();
                        text.utf8 = scanner.source.contents[start..scanner.current];
                        return text;
                    },
                    '"', '\'', '(' => {
                        const r = logger.Range{ .loc = logger.Loc{ .start = @intCast(i32, start) }, .len = @intCast(i32, scanner.end - start) };

                        scanner.log.addRangeError(scanner.source, r, "Expected \")\" to end URL token") catch {};
                        break :validURL;
                    },
                    '\\' => {
                        text.needs_decode_escape = true;
                        if (!scanner.isValidEscape()) {
                            var loc = logger.Loc{
                                .start = @intCast(i32, scanner.end),
                            };
                            scanner.log.addError(scanner.source, loc, "Expected \")\" to end URL token") catch {};
                            break :validURL;
                        }
                        _ = scanner.consumeEscape();
                    },
                    else => {
                        if (isNonPrintable(scanner.codepoint)) {
                            const r = logger.Range{
                                .loc = logger.Loc{
                                    .start = @intCast(i32, start),
                                },
                                .len = 1,
                            };
                            scanner.log.addRangeError(scanner.source, r, "Invalid escape") catch {};
                            break :validURL;
                        }
                        scanner.step();
                    },
                }
            }
            text.valid = false;
            // Consume the remnants of a bad url
            while (true) {
                switch (scanner.codepoint) {
                    ')', -1 => {
                        scanner.step();
                        text.utf8 = scanner.source.contents[start..scanner.end];
                        return text;
                    },
                    '\\' => {
                        text.needs_decode_escape = true;
                        if (scanner.isValidEscape()) {
                            _ = scanner.consumeEscape();
                        }
                    },
                    else => {},
                }

                scanner.step();
            }

            return text;
        }

        pub fn next(scanner: *Scanner) !void {
            scanner.has_newline_before = scanner.end == 0;
            scanner.has_delimiter_before = false;
            scanner.step();

            restart: while (true) {
                var chunk = Chunk{
                    .range = logger.Range{
                        .loc = .{ .start = @intCast(i32, scanner.end) },
                        .len = 0,
                    },
                    .content = .{
                        .t_verbatim = .{},
                    },
                };
                scanner.start = scanner.end;

                toplevel: while (true) {

                    // We only care about two things.
                    // 1. url()
                    // 2. @import
                    // To correctly parse, url(), we need to verify that the character preceding it is either whitespace, a colon, or a comma
                    // We also need to parse strings and comments, or else we risk resolving comments like this /* url(hi.jpg) */
                    switch (scanner.codepoint) {
                        -1 => {
                            chunk.range.len = @intCast(i32, scanner.end) - chunk.range.loc.start;
                            chunk.content.t_verbatim = .{};
                            try scanner.writer.writeChunk(chunk);
                            return;
                        },

                        '\t', '\n', '\r', escLineFeed => {
                            scanner.has_newline_before = true;
                            continue;
                        },
                        // Ensure whitespace doesn't affect scanner.has_delimiter_before
                        ' ' => {},

                        ':', ',' => {
                            scanner.has_delimiter_before = true;
                        },
                        // this is a little hacky, but it should work since we're not parsing scopes
                        '{', '}', ';' => {
                            scanner.has_delimiter_before = false;
                        },
                        'u', 'U' => {
                            // url() always appears on the property value side
                            // so we should ignore it if it's part of a different token
                            if (!scanner.has_delimiter_before) {
                                scanner.step();
                                continue :toplevel;
                            }

                            var url_start = scanner.current;
                            scanner.step();
                            switch (scanner.codepoint) {
                                'r', 'R' => {},
                                else => {
                                    continue;
                                },
                            }
                            scanner.step();
                            switch (scanner.codepoint) {
                                'l', 'L' => {},
                                else => {
                                    continue;
                                },
                            }
                            scanner.step();
                            if (scanner.codepoint != '(') {
                                continue;
                            }
                            const url_text = scanner.consumeURL();
                            chunk.range.len = @intCast(i32, url_start) - chunk.range.loc.start;
                            chunk.content = .{ .t_verbatim = .{} };
                            // flush the pending chunk
                            try scanner.writer.writeChunk(chunk);
                            chunk.range.loc.start = @intCast(i32, url_start);
                            chunk.range.len = @intCast(i32, scanner.end) - chunk.range.loc.start;
                            chunk.content.t_url = url_text;
                            try scanner.writer.writeChunk(chunk);
                            scanner.has_delimiter_before = false;
                            continue :restart;
                        },

                        '@' => {
                            const start = scanner.end;

                            scanner.step();
                            if (scanner.codepoint != 'i') continue :toplevel;
                            scanner.step();
                            if (scanner.codepoint != 'm') continue :toplevel;
                            scanner.step();
                            if (scanner.codepoint != 'p') continue :toplevel;
                            scanner.step();
                            if (scanner.codepoint != 'o') continue :toplevel;
                            scanner.step();
                            if (scanner.codepoint != 'r') continue :toplevel;
                            scanner.step();
                            if (scanner.codepoint != 't') continue :toplevel;
                            scanner.step();
                            if (scanner.codepoint != 't') continue :toplevel;
                            scanner.step();
                            if (scanner.codepoint != ' ') continue :toplevel;

                            // Now that we know to expect an import url, we flush the chunk
                            chunk.range.len = @intCast(i32, start) - chunk.range.loc.start;
                            chunk.content = .{ .t_verbatim = .{} };
                            // flush the pending chunk
                            try scanner.writer.writeChunk(chunk);

                            // Don't write the .start until we know it's an @import rule
                            // We want to avoid messing with other rules
                            scanner.start = start;

                            var url_token_start = scanner.current;
                            var url_token_end = scanner.current;
                            // "Imported rules must precede all other types of rule"
                            // https://developer.mozilla.org/en-US/docs/Web/CSS/@import
                            // @import url;
                            // @import url list-of-media-queries;
                            // @import url supports( supports-query );
                            // @import url supports( supports-query ) list-of-media-queries;

                            var is_url_token = false;
                            var quote: CodePoint = -1;
                            while (isWhitespace(scanner.codepoint)) {
                                scanner.step();
                            }

                            var import = Chunk.Import{
                                .text = .{
                                    .utf8 = "",
                                },
                            };

                            switch (scanner.codepoint) {
                                // spongebob-case url() are supported, I guess.
                                // uRL()
                                // uRL()
                                // URl()
                                'u', 'U' => {
                                    scanner.step();
                                    switch (scanner.codepoint) {
                                        'r', 'R' => {},
                                        else => {
                                            scanner.log.addError(
                                                scanner.source,
                                                logger.Loc{ .start = @intCast(i32, scanner.end) },
                                                "Expected @import to start with a string or url()",
                                            ) catch {};
                                            return error.SyntaxError;
                                        },
                                    }
                                    scanner.step();
                                    switch (scanner.codepoint) {
                                        'l', 'L' => {},
                                        else => {
                                            scanner.log.addError(
                                                scanner.source,
                                                logger.Loc{ .start = @intCast(i32, scanner.end) },
                                                "Expected @import to start with a \", ' or url()",
                                            ) catch {};
                                            return error.SyntaxError;
                                        },
                                    }
                                    scanner.step();
                                    if (scanner.codepoint != '(') {
                                        scanner.log.addError(
                                            scanner.source,
                                            logger.Loc{ .start = @intCast(i32, scanner.end) },
                                            "Expected \"(\" in @import url",
                                        ) catch {};
                                        return error.SyntaxError;
                                    }
                                    import.text = scanner.consumeURL();
                                },
                                '"' => {
                                    import.text.quote = .double;
                                    if (scanner.consumeString('"')) |str| {
                                        import.text.utf8 = str;
                                    } else {
                                        return error.SyntaxError;
                                    }
                                },
                                '\'' => {
                                    import.text.quote = .single;
                                    if (scanner.consumeString('\'')) |str| {
                                        import.text.utf8 = str;
                                    } else {
                                        return error.SyntaxError;
                                    }
                                },
                                else => {
                                    return error.SyntaxError;
                                },
                            }

                            var suffix_start = scanner.end;

                            get_suffix: while (true) {
                                switch (scanner.codepoint) {
                                    ';' => {
                                        scanner.step();
                                        import.suffix = scanner.source.contents[suffix_start..scanner.end];
                                        scanner.has_delimiter_before = false;
                                        break :get_suffix;
                                    },
                                    -1 => {
                                        scanner.log.addError(
                                            scanner.source,
                                            logger.Loc{ .start = @intCast(i32, scanner.end) },
                                            "Expected \";\" at end of @import",
                                        ) catch {};
                                    },
                                    else => {},
                                }
                                scanner.step();
                            }
                            chunk.range.len = @intCast(i32, scanner.end) - std.math.max(chunk.range.loc.start, 0);
                            chunk.content = .{ .t_import = import };
                            try scanner.writer.writeChunk(chunk);
                            continue :restart;
                        },

                        // We don't actually care what the values are here, we just want to avoid confusing strings for URLs.
                        '\'' => {
                            scanner.has_delimiter_before = false;
                            if (scanner.consumeString('\'') == null) {
                                return error.SyntaxError;
                            }
                        },
                        '"' => {
                            scanner.has_delimiter_before = false;
                            if (scanner.consumeString('"') == null) {
                                return error.SyntaxError;
                            }
                        },
                        // Skip comments
                        '/' => {},
                        else => {
                            scanner.has_delimiter_before = false;
                        },
                    }

                    scanner.step();
                }
            }
        }

        pub fn consumeEscape(scanner: *Scanner) CodePoint {
            scanner.step();

            var c = scanner.codepoint;

            if (isHex(c)) |__hex| {
                var hex = __hex;
                scanner.step();
                value: {
                    comptime var i: usize = 0;
                    inline while (i < 5) : (i += 1) {
                        if (isHex(scanner.codepoint)) |_hex| {
                            scanner.step();
                            hex = hex * 16 + _hex;
                        } else {
                            break :value;
                        }
                    }
                    break :value;
                }

                if (isWhitespace(scanner.codepoint)) {
                    scanner.step();
                }
                return switch (hex) {
                    0, 0xD800...0xDFFF, 0x10FFFF...std.math.maxInt(CodePoint) => replacementCharacter,
                    else => hex,
                };
            }

            if (c == -1) return replacementCharacter;

            scanner.step();
            return c;
        }

        inline fn nextCodepointSlice(it: *Scanner, comptime advance: bool) []const u8 {
            @setRuntimeSafety(false);

            const cp_len = strings.utf8ByteSequenceLength(it.source.contents[it.current]);
            if (advance) {
                it.end = it.current;
                it.current += cp_len;
            }

            return if (!(it.current > it.source.contents.len)) it.source.contents[it.current - cp_len .. it.current] else "";
        }

        pub inline fn nextCodepoint(it: *Scanner) CodePoint {
            const slice = it.nextCodepointSlice(true);
            @setRuntimeSafety(false);

            return switch (slice.len) {
                0 => -1,
                1 => @intCast(CodePoint, slice[0]),
                2 => @intCast(CodePoint, std.unicode.utf8Decode2(slice) catch unreachable),
                3 => @intCast(CodePoint, std.unicode.utf8Decode3(slice) catch unreachable),
                4 => @intCast(CodePoint, std.unicode.utf8Decode4(slice) catch unreachable),
                else => unreachable,
            };
        }
    };
}

fn isWhitespace(c: CodePoint) bool {
    return switch (c) {
        ' ', '\t', '\n', '\r', escLineFeed => true,
        else => false,
    };
}

fn isNonPrintable(c: CodePoint) bool {
    return switch (c) {
        0...0x08, 0x0B, 0x0E...0x1F, 0x7F => true,
        else => false,
    };
}

pub fn isHex(c: CodePoint) ?CodePoint {
    return switch (c) {
        '0'...'9' => c - '0',
        'a'...'f' => c + (10 - 'a'),
        'A'...'F' => c + (10 - 'A'),
        else => null,
    };
}

pub fn NewWriter(
    comptime WriterType: type,
    comptime LinkerType: type,
    comptime import_path_format: Options.BundleOptions.ImportPathFormat,
) type {
    return struct {
        const Writer = @This();
        const Scanner = NewScanner(*Writer);

        ctx: WriterType,
        linker: LinkerType,
        source: *const logger.Source,
        written: usize = 0,

        pub fn init(
            source: *const logger.Source,
            ctx: WriterType,
            linker: LinkerType,
        ) Writer {
            return Writer{
                .ctx = ctx,
                .linker = linker,
                .source = source,
                .written = 0,
            };
        }

        pub fn run(writer: *Writer, log: *logger.Log, allocator: *std.mem.Allocator) !void {
            var scanner = Scanner.init(
                log,

                allocator,
                writer,
                writer.source,
            );

            try scanner.next();
        }

        fn writeString(writer: *Writer, str: string, quote: Chunk.TextContent.Quote) !void {
            switch (quote) {
                .none => {
                    try writer.ctx.writeAll(str);
                    writer.written += str.len;
                    return;
                },
                .single => {
                    try writer.ctx.writeAll("'");
                    writer.written += 1;
                    try writer.ctx.writeAll(str);
                    writer.written += str.len;
                    try writer.ctx.writeAll("'");
                    writer.written += 1;
                },
                .double => {
                    try writer.ctx.writeAll("\"");
                    writer.written += 1;
                    try writer.ctx.writeAll(str);
                    writer.written += str.len;
                    try writer.ctx.writeAll("\"");
                    writer.written += 1;
                },
            }
        }

        fn writeURL(writer: *Writer, url_str: string, text: Chunk.TextContent) !void {
            switch (text.quote) {
                .none => {
                    try writer.ctx.writeAll("url(");
                    writer.written += "url(".len;
                },
                .single => {
                    try writer.ctx.writeAll("url('");
                    writer.written += "url('".len;
                },
                .double => {
                    try writer.ctx.writeAll("url(\"");
                    writer.written += "url(\"".len;
                },
            }
            try writer.ctx.writeAll(url_str);
            writer.written += url_str.len;
            switch (text.quote) {
                .none => {
                    try writer.ctx.writeAll(")");
                    writer.written += ")".len;
                },
                .single => {
                    try writer.ctx.writeAll("')");
                    writer.written += "')".len;
                },
                .double => {
                    try writer.ctx.writeAll("\")");
                    writer.written += "\")".len;
                },
            }
        }

        pub fn writeChunk(writer: *Writer, chunk: Chunk) !void {
            switch (chunk.content) {
                .t_url => |url| {
                    const url_str = try writer.linker.resolveCSS(
                        writer.source.path,
                        url.utf8,
                        chunk.range,
                        import_record.ImportKind.url,
                        import_path_format,
                    );
                    try writer.writeURL(url_str, url);
                },
                .t_import => |import| {
                    const url_str = try writer.linker.resolveCSS(
                        writer.source.path,
                        import.text.utf8,
                        chunk.range,
                        import_record.ImportKind.at,
                        import_path_format,
                    );

                    try writer.ctx.writeAll("@import ");
                    writer.written += "@import ".len;

                    if (import.url) {
                        try writer.writeURL(url_str, import.text);
                    } else {
                        try writer.writeString(url_str, import.text.quote);
                    }

                    try writer.ctx.writeAll(import.suffix);
                    writer.written += import.suffix.len;
                    try writer.ctx.writeAll("\n");
                    writer.written += 1;
                },
                .t_verbatim => |verbatim| {
                    defer writer.written += @intCast(usize, chunk.range.len);
                    if (comptime std.meta.trait.hasFn("copyFileRange")(WriterType)) {
                        try writer.ctx.copyFileRange(
                            @intCast(usize, chunk.range.loc.start),
                            @intCast(
                                usize,
                                @intCast(
                                    usize,
                                    chunk.range.len + chunk.range.loc.start,
                                ),
                            ),
                        );
                    } else {
                        try writer.ctx.writeAll(
                            writer.source.contents[@intCast(usize, chunk.range.loc.start)..][0..@intCast(
                                usize,
                                chunk.range.len,
                            )],
                        );
                    }
                },
            }
        }
    };
}
