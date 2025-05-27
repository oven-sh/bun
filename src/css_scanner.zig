const Fs = @import("fs.zig");
const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const Environment = bun.Environment;
const strings = bun.strings;
const CodePoint = bun.CodePoint;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const FeatureFlags = bun.FeatureFlags;
const default_allocator = bun.default_allocator;

const options = @import("./options.zig");
const import_record = @import("import_record.zig");
const logger = bun.logger;
const Options = options;
const URL = @import("./url.zig").URL;
const replacementCharacter: CodePoint = 0xFFFD;

pub const Chunk = struct {
    // Entire chunk
    range: logger.Range,
    content: Content,

    pub const Content = union(Tag) {
        t_url: TextContent,
        t_verbatim: Verbatim,
        t_import: Import,
    };

    pub fn raw(chunk: *const Chunk, source: *const logger.Source) string {
        return source.contents[@as(usize, @intCast(chunk.range.loc.start))..][0..@as(usize, @intCast(chunk.range.len))];
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
pub const Scanner = struct {
    current: usize = 0,
    start: usize = 0,
    end: usize = 0,
    log: *logger.Log,

    has_newline_before: bool = false,
    has_delimiter_before: bool = false,
    allocator: std.mem.Allocator,

    source: *const logger.Source,
    codepoint: CodePoint = -1,
    approximate_newline_count: usize = 0,

    pub fn init(log: *logger.Log, allocator: std.mem.Allocator, source: *const logger.Source) Scanner {
        return Scanner{ .log = log, .source = source, .allocator = allocator };
    }

    pub fn range(scanner: *Scanner) logger.Range {
        return logger.Range{
            .loc = .{ .start = @as(i32, @intCast(scanner.start)) },
            .len = @as(i32, @intCast(scanner.end - scanner.start)),
        };
    }

    pub fn step(scanner: *Scanner) void {
        scanner.codepoint = scanner.nextCodepoint();
        scanner.approximate_newline_count += @intFromBool(scanner.codepoint == '\n');
    }
    pub fn raw(_: *Scanner) string {}

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

    pub fn consumeString(
        scanner: *Scanner,
        comptime quote: CodePoint,
    ) ?string {
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
                    const result = scanner.source.contents[start..scanner.end];
                    scanner.step();
                    return result;
                },
                else => {},
            }
            scanner.step();
        }
        unreachable;
    }

    pub fn consumeToEndOfMultiLineComment(scanner: *Scanner, start_range: logger.Range) void {
        while (true) {
            switch (scanner.codepoint) {
                '*' => {
                    scanner.step();
                    if (scanner.codepoint == '/') {
                        scanner.step();
                        return;
                    }
                },
                -1 => {
                    scanner.log.addRangeError(scanner.source, start_range, "Expected \"*/\" to terminate multi-line comment") catch {};
                    return;
                },
                else => {
                    scanner.step();
                },
            }
        }
    }
    pub fn consumeToEndOfSingleLineComment(scanner: *Scanner) void {
        while (!isNewline(scanner.codepoint) and scanner.codepoint != -1) {
            scanner.step();
        }

        // scanner.log.addRangeWarning(
        //     scanner.source,
        //     scanner.range(),
        //     "Comments in CSS use \"/* ... */\" instead of \"//\"",
        // ) catch {};
    }

    pub fn consumeURL(scanner: *Scanner) Chunk.TextContent {
        var text = Chunk.TextContent{ .utf8 = "" };
        const start = scanner.end;
        validURL: while (true) {
            switch (scanner.codepoint) {
                ')' => {
                    text.utf8 = scanner.source.contents[start..scanner.end];
                    scanner.step();
                    return text;
                },
                -1 => {
                    const loc = logger.Loc{ .start = @as(i32, @intCast(scanner.end)) };
                    scanner.log.addError(scanner.source, loc, "Expected \")\" to end URL token") catch {};
                    return text;
                },
                '\t', '\n', '\r', escLineFeed => {
                    scanner.step();
                    while (isWhitespace(scanner.codepoint)) {
                        scanner.step();
                    }

                    text.utf8 = scanner.source.contents[start..scanner.end];

                    if (scanner.codepoint != ')') {
                        const loc = logger.Loc{ .start = @as(i32, @intCast(scanner.end)) };
                        scanner.log.addError(scanner.source, loc, "Expected \")\" to end URL token") catch {};
                        break :validURL;
                    }
                    scanner.step();

                    return text;
                },
                '"', '\'', '(' => {
                    const r = logger.Range{ .loc = logger.Loc{ .start = @as(i32, @intCast(start)) }, .len = @as(i32, @intCast(scanner.end - start)) };

                    scanner.log.addRangeError(scanner.source, r, "Expected \")\" to end URL token") catch {};
                    break :validURL;
                },
                '\\' => {
                    text.needs_decode_escape = true;
                    if (!scanner.isValidEscape()) {
                        const loc = logger.Loc{
                            .start = @as(i32, @intCast(scanner.end)),
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
                                .start = @as(i32, @intCast(start)),
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
    var did_warn_tailwind = false;
    pub fn warnTailwind(scanner: *Scanner, start: usize) void {
        if (did_warn_tailwind) return;
        did_warn_tailwind = true;
        scanner.log.addWarningFmt(
            scanner.source,
            logger.usize2Loc(start),
            scanner.allocator,
            "To use Tailwind with bun, use the Tailwind CLI and import the processed .css file.\nLearn more: https://tailwindcss.com/docs/installation#watching-for-changes",
            .{},
        ) catch {};
    }

    pub fn next(
        scanner: *Scanner,
        comptime import_behavior: ImportBehavior,
        comptime WriterType: type,
        writer: WriterType,
        writeChunk: (fn (ctx: WriterType, Chunk) anyerror!void),
    ) anyerror!void {
        scanner.has_newline_before = scanner.end == 0;
        scanner.has_delimiter_before = false;
        scanner.step();

        restart: while (true) {
            var chunk = Chunk{
                .range = logger.Range{
                    .loc = .{ .start = @as(i32, @intCast(scanner.end)) },
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
                        chunk.range.len = @as(i32, @intCast(scanner.end)) - chunk.range.loc.start;
                        chunk.content.t_verbatim = .{};
                        try writeChunk(writer, chunk);
                        return;
                    },

                    '\t', '\n', '\r', escLineFeed => {
                        scanner.has_newline_before = true;
                        scanner.step();
                        continue;
                    },
                    // Ensure whitespace doesn't affect scanner.has_delimiter_before
                    ' ' => {},

                    ':', ',' => {
                        scanner.has_delimiter_before = true;
                    },
                    '{', '}' => {
                        scanner.has_delimiter_before = false;

                        // Heuristic:
                        // If we're only scanning the imports, as soon as there's a curly brace somewhere we can assume that @import is done.
                        // @import only appears at the top of the file. Only @charset is allowed to be above it.
                        if (import_behavior == .scan) {
                            return;
                        }
                    },
                    // this is a little hacky, but it should work since we're not parsing scopes
                    ';' => {
                        scanner.has_delimiter_before = false;
                    },
                    'u', 'U' => {
                        // url() always appears on the property value side
                        // so we should ignore it if it's part of a different token
                        if (!scanner.has_delimiter_before) {
                            scanner.step();
                            continue :toplevel;
                        }

                        const url_start = scanner.end;
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

                        scanner.step();

                        var url_text: Chunk.TextContent = undefined;

                        switch (scanner.codepoint) {
                            '\'' => {
                                const str = scanner.consumeString('\'') orelse return error.SyntaxError;
                                if (scanner.codepoint != ')') {
                                    continue;
                                }
                                scanner.step();
                                url_text = .{ .utf8 = str, .quote = .double };
                            },
                            '"' => {
                                const str = scanner.consumeString('"') orelse return error.SyntaxError;
                                if (scanner.codepoint != ')') {
                                    continue;
                                }
                                scanner.step();
                                url_text = .{ .utf8 = str, .quote = .single };
                            },
                            else => {
                                url_text = scanner.consumeURL();
                            },
                        }

                        chunk.range.len = @as(i32, @intCast(url_start)) - chunk.range.loc.start;
                        chunk.content = .{ .t_verbatim = .{} };
                        // flush the pending chunk
                        try writeChunk(writer, chunk);

                        chunk.range.loc.start = @as(i32, @intCast(url_start));
                        chunk.range.len = @as(i32, @intCast(scanner.end)) - chunk.range.loc.start;
                        chunk.content = .{ .t_url = url_text };
                        try writeChunk(writer, chunk);
                        scanner.has_delimiter_before = false;

                        continue :restart;
                    },

                    '@' => {
                        const start = scanner.end;

                        scanner.step();
                        switch (scanner.codepoint) {
                            'i' => {},
                            't' => {
                                scanner.step();
                                if (scanner.codepoint != 'a') continue :toplevel;
                                scanner.step();
                                if (scanner.codepoint != 'i') continue :toplevel;
                                scanner.step();
                                if (scanner.codepoint != 'l') continue :toplevel;
                                scanner.step();
                                if (scanner.codepoint != 'w') continue :toplevel;
                                scanner.step();
                                if (scanner.codepoint != 'i') continue :toplevel;
                                scanner.step();
                                if (scanner.codepoint != 'n') continue :toplevel;
                                scanner.step();
                                if (scanner.codepoint != 'd') continue :toplevel;
                                scanner.step();
                                if (scanner.codepoint != ' ') continue :toplevel;
                                scanner.step();

                                const word_start = scanner.end;

                                while (switch (scanner.codepoint) {
                                    'a'...'z', 'A'...'Z' => true,
                                    else => false,
                                }) {
                                    scanner.step();
                                }

                                const word = scanner.source.contents[word_start..scanner.end];

                                while (switch (scanner.codepoint) {
                                    ' ', '\n', '\r' => true,
                                    else => false,
                                }) {
                                    scanner.step();
                                }

                                if (scanner.codepoint != ';') continue :toplevel;

                                switch (word[0]) {
                                    'b' => {
                                        if (strings.eqlComptime(word, "base")) {
                                            scanner.warnTailwind(start);
                                        }
                                    },
                                    'c' => {
                                        if (strings.eqlComptime(word, "components")) {
                                            scanner.warnTailwind(start);
                                        }
                                    },
                                    'u' => {
                                        if (strings.eqlComptime(word, "utilities")) {
                                            scanner.warnTailwind(start);
                                        }
                                    },
                                    's' => {
                                        if (strings.eqlComptime(word, "screens")) {
                                            scanner.warnTailwind(start);
                                        }
                                    },
                                    else => continue :toplevel,
                                }

                                continue :toplevel;
                            },

                            else => continue :toplevel,
                        }
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
                        if (scanner.codepoint != ' ') continue :toplevel;

                        // Now that we know to expect an import url, we flush the chunk
                        chunk.range.len = @as(i32, @intCast(start)) - chunk.range.loc.start;
                        chunk.content = .{ .t_verbatim = .{} };
                        // flush the pending chunk
                        try writeChunk(writer, chunk);

                        // Don't write the .start until we know it's an @import rule
                        // We want to avoid messing with other rules
                        scanner.start = start;

                        // "Imported rules must precede all other types of rule"
                        // https://developer.mozilla.org/en-US/docs/Web/CSS/@import
                        // @import url;
                        // @import url list-of-media-queries;
                        // @import url supports( supports-query );
                        // @import url supports( supports-query ) list-of-media-queries;

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
                                            logger.Loc{ .start = @as(i32, @intCast(scanner.end)) },
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
                                            logger.Loc{ .start = @as(i32, @intCast(scanner.end)) },
                                            "Expected @import to start with a \", ' or url()",
                                        ) catch {};
                                        return error.SyntaxError;
                                    },
                                }
                                scanner.step();
                                if (scanner.codepoint != '(') {
                                    scanner.log.addError(
                                        scanner.source,
                                        logger.Loc{ .start = @as(i32, @intCast(scanner.end)) },
                                        "Expected \"(\" in @import url",
                                    ) catch {};
                                    return error.SyntaxError;
                                }

                                scanner.step();

                                var url_text: Chunk.TextContent = undefined;

                                switch (scanner.codepoint) {
                                    '\'' => {
                                        const str = scanner.consumeString('\'') orelse return error.SyntaxError;
                                        if (scanner.codepoint != ')') {
                                            continue;
                                        }
                                        scanner.step();

                                        url_text = .{ .utf8 = str, .quote = .single };
                                    },
                                    '"' => {
                                        const str = scanner.consumeString('"') orelse return error.SyntaxError;
                                        if (scanner.codepoint != ')') {
                                            continue;
                                        }
                                        scanner.step();
                                        url_text = .{ .utf8 = str, .quote = .double };
                                    },
                                    else => {
                                        url_text = scanner.consumeURL();
                                    },
                                }

                                import.text = url_text;
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

                        const suffix_start = scanner.end;

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
                                        logger.Loc{ .start = @as(i32, @intCast(scanner.end)) },
                                        "Expected \";\" at end of @import",
                                    ) catch {};
                                    return;
                                },
                                else => {},
                            }
                            scanner.step();
                        }
                        if (import_behavior == .scan or import_behavior == .keep) {
                            chunk.range.len = @as(i32, @intCast(scanner.end)) - @max(chunk.range.loc.start, 0);
                            chunk.content = .{ .t_import = import };
                            try writeChunk(writer, chunk);
                        }
                        scanner.step();
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
                    '/' => {
                        scanner.step();
                        switch (scanner.codepoint) {
                            '*' => {
                                scanner.step();
                                chunk.range.len = @as(i32, @intCast(scanner.end));
                                scanner.consumeToEndOfMultiLineComment(chunk.range);
                            },
                            '/' => {
                                scanner.step();
                                scanner.consumeToEndOfSingleLineComment();
                                continue;
                            },
                            else => {
                                continue;
                            },
                        }
                    },
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

        const c = scanner.codepoint;

        if (isHex(c)) |__hex| {
            var hex = __hex;
            scanner.step();
            value: {
                if (isHex(scanner.codepoint)) |_hex| {
                    scanner.step();
                    hex = hex * 16 + _hex;
                } else {
                    break :value;
                }

                if (isHex(scanner.codepoint)) |_hex| {
                    scanner.step();
                    hex = hex * 16 + _hex;
                } else {
                    break :value;
                }

                if (isHex(scanner.codepoint)) |_hex| {
                    scanner.step();
                    hex = hex * 16 + _hex;
                } else {
                    break :value;
                }

                if (isHex(scanner.codepoint)) |_hex| {
                    scanner.step();
                    hex = hex * 16 + _hex;
                } else {
                    break :value;
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
        if (comptime Environment.allow_assert) {
            bun.assert(it.source.contents.len > 0);
        }

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
            1 => @as(CodePoint, @intCast(slice[0])),
            2 => @as(CodePoint, @intCast(std.unicode.utf8Decode2(slice) catch unreachable)),
            3 => @as(CodePoint, @intCast(std.unicode.utf8Decode3(slice) catch unreachable)),
            4 => @as(CodePoint, @intCast(std.unicode.utf8Decode4(slice) catch unreachable)),
            else => unreachable,
        };
    }
};

fn isWhitespace(c: CodePoint) bool {
    return switch (c) {
        ' ', '\t', '\n', '\r', escLineFeed => true,
        else => false,
    };
}

fn isNewline(c: CodePoint) bool {
    return switch (c) {
        '\t', '\n', '\r', escLineFeed => true,
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

pub const ImportBehavior = enum { keep, omit, scan };

pub fn NewWriter(
    comptime WriterType: type,
    comptime LinkerType: type,
    comptime import_path_format: Options.BundleOptions.ImportPathFormat,
    comptime BuildContextType: type,
) type {
    return struct {
        const Writer = @This();

        ctx: WriterType,
        linker: LinkerType,
        source: *const logger.Source,
        buildCtx: BuildContextType = undefined,
        log: *logger.Log,

        pub fn init(
            source: *const logger.Source,
            ctx: WriterType,
            linker: LinkerType,
            log: *logger.Log,
        ) Writer {
            return Writer{
                .ctx = ctx,
                .linker = linker,
                .source = source,
                .log = log,
            };
        }

        /// The Source must not be empty
        pub fn scan(
            writer: *Writer,
            log: *logger.Log,
            allocator: std.mem.Allocator,
        ) anyerror!void {
            bun.assert(writer.source.contents.len > 0);

            var scanner = Scanner.init(
                log,

                allocator,
                writer.source,
            );

            try scanner.next(.scan, @TypeOf(writer), writer, scanChunk);
        }

        /// The Source must not be empty
        pub fn append(
            writer: *Writer,
            log: *logger.Log,
            allocator: std.mem.Allocator,
        ) !usize {
            bun.assert(writer.source.contents.len > 0);

            var scanner = Scanner.init(
                log,

                allocator,
                writer.source,
            );

            try scanner.next(.omit, @TypeOf(writer), writer, writeBundledChunk);

            return scanner.approximate_newline_count;
        }

        /// The Source must not be empty
        pub fn run(
            writer: *Writer,
            log: *logger.Log,
            allocator: std.mem.Allocator,
        ) anyerror!void {
            bun.assert(writer.source.contents.len > 0);

            var scanner = Scanner.init(
                log,

                allocator,
                writer.source,
            );

            try scanner.next(.keep, @TypeOf(writer), writer, commitChunk);
        }

        fn writeString(writer: *Writer, str: string, quote: Chunk.TextContent.Quote) anyerror!void {
            switch (quote) {
                .none => {
                    try writer.ctx.writeAll(str);

                    return;
                },
                .single => {
                    try writer.ctx.writeAll("'");

                    try writer.ctx.writeAll(str);

                    try writer.ctx.writeAll("'");
                },
                .double => {
                    try writer.ctx.writeAll("\"");

                    try writer.ctx.writeAll(str);

                    try writer.ctx.writeAll("\"");
                },
            }
        }

        fn writeURL(writer: *Writer, url_str: string, text: Chunk.TextContent) anyerror!void {
            switch (text.quote) {
                .none => {
                    try writer.ctx.writeAll("url(");
                },
                .single => {
                    try writer.ctx.writeAll("url('");
                },
                .double => {
                    try writer.ctx.writeAll("url(\"");
                },
            }
            try writer.ctx.writeAll(url_str);

            switch (text.quote) {
                .none => {
                    try writer.ctx.writeAll(")");
                },
                .single => {
                    try writer.ctx.writeAll("')");
                },
                .double => {
                    try writer.ctx.writeAll("\")");
                },
            }
        }

        pub fn scanChunk(writer: *Writer, chunk: Chunk) anyerror!void {
            switch (chunk.content) {
                .t_url => {},
                .t_import => |import| {
                    const resolved = writer.linker.resolveCSS(
                        writer.source.path,
                        import.text.utf8,
                        chunk.range,
                        import_record.ImportKind.at,
                        writer.buildCtx.origin,
                        Options.BundleOptions.ImportPathFormat.absolute_path,
                        true,
                    ) catch |err| {
                        switch (err) {
                            error.ModuleNotFound, error.FileNotFound => {
                                writer.log.addResolveError(
                                    writer.source,
                                    chunk.range,
                                    writer.buildCtx.allocator,
                                    "Not Found - \"{s}\"",
                                    .{import.text.utf8},
                                    import_record.ImportKind.at,
                                    err,
                                ) catch {};
                            },
                            else => {},
                        }
                        return err;
                    };

                    // TODO: just check is_external instead
                    if (strings.startsWith(import.text.utf8, "https://") or strings.startsWith(import.text.utf8, "http://")) {
                        return;
                    }

                    try writer.buildCtx.addCSSImport(resolved);
                },
                .t_verbatim => {},
            }
        }

        pub fn commitChunk(writer: *Writer, chunk: Chunk) anyerror!void {
            return try writeChunk(writer, chunk, false);
        }

        pub fn writeBundledChunk(writer: *Writer, chunk: Chunk) anyerror!void {
            return try writeChunk(writer, chunk, true);
        }

        pub fn writeChunk(writer: *Writer, chunk: Chunk, comptime omit_imports: bool) anyerror!void {
            switch (chunk.content) {
                .t_url => |url| {
                    const url_str = try writer.linker.resolveCSS(
                        writer.source.path,
                        url.utf8,
                        chunk.range,
                        import_record.ImportKind.url,
                        writer.buildCtx.origin,
                        import_path_format,
                        false,
                    );
                    try writer.writeURL(url_str, url);
                },
                .t_import => |import| {
                    if (!omit_imports) {
                        const url_str = try writer.linker.resolveCSS(
                            writer.source.path,
                            import.text.utf8,
                            chunk.range,
                            import_record.ImportKind.at,
                            writer.buildCtx.origin,
                            import_path_format,
                            false,
                        );

                        try writer.ctx.writeAll("@import ");

                        if (import.url) {
                            try writer.writeURL(url_str, import.text);
                        } else {
                            try writer.writeString(url_str, import.text.quote);
                        }

                        try writer.ctx.writeAll(import.suffix);
                        try writer.ctx.writeAll("\n");
                    }
                },
                .t_verbatim => {
                    if (comptime std.meta.hasFn(WriterType, "copyFileRange")) {
                        try writer.ctx.copyFileRange(
                            @as(usize, @intCast(chunk.range.loc.start)),
                            @as(
                                usize,
                                @intCast(@as(
                                    usize,
                                    @intCast(chunk.range.len),
                                )),
                            ),
                        );
                    } else {
                        try writer.ctx.writeAll(
                            writer.source.contents[@as(usize, @intCast(chunk.range.loc.start))..][0..@as(
                                usize,
                                @intCast(chunk.range.len),
                            )],
                        );
                    }
                },
            }
        }
    };
}

pub const CodeCount = struct {
    approximate_newline_count: usize = 0,
    written: usize = 0,
};

const ImportQueueFifo = std.fifo.LinearFifo(u32, .Dynamic);
const QueuedList = std.ArrayList(u32);
threadlocal var global_queued: QueuedList = undefined;
threadlocal var global_import_queud: ImportQueueFifo = undefined;
threadlocal var global_bundle_queud: QueuedList = undefined;
threadlocal var has_set_global_queue = false;
pub fn NewBundler(
    comptime Writer: type,
    comptime Linker: type,
    comptime FileReader: type,
    comptime Watcher: type,
    comptime FSType: type,
    comptime hot_module_reloading: bool,
    comptime import_path_format: options.BundleOptions.ImportPathFormat,
) type {
    return struct {
        const CSSBundler = @This();
        queued: *QueuedList,
        import_queue: *ImportQueueFifo,
        bundle_queue: *QueuedList,
        writer: Writer,
        watcher: *Watcher,
        fs_reader: FileReader,
        fs: FSType,
        allocator: std.mem.Allocator,
        origin: URL = URL{},

        pub fn bundle(
            absolute_path: string,
            fs: FSType,
            writer: Writer,
            watcher: *Watcher,
            fs_reader: FileReader,
            hash: u32,
            _: ?StoredFileDescriptorType,
            allocator: std.mem.Allocator,
            log: *logger.Log,
            linker: Linker,
            origin: URL,
        ) !CodeCount {
            var int_buf_print: [256]u8 = undefined;
            const start_count = writer.written;
            if (!has_set_global_queue) {
                global_queued = QueuedList.init(default_allocator);
                global_import_queud = ImportQueueFifo.init(default_allocator);
                global_bundle_queud = QueuedList.init(default_allocator);
                has_set_global_queue = true;
            } else {
                global_queued.clearRetainingCapacity();
                global_import_queud.head = 0;
                global_import_queud.count = 0;
                global_bundle_queud.clearRetainingCapacity();
            }

            var this = CSSBundler{
                .queued = &global_queued,
                .import_queue = &global_import_queud,
                .bundle_queue = &global_bundle_queud,
                .writer = writer,
                .fs_reader = fs_reader,
                .fs = fs,
                .origin = origin,
                .allocator = allocator,
                .watcher = watcher,
            };
            const CSSWriter = NewWriter(*CSSBundler, Linker, import_path_format, *CSSBundler);

            var css = CSSWriter.init(
                undefined,
                &this,
                linker,
                log,
            );
            css.buildCtx = &this;

            try this.addCSSImport(absolute_path);

            while (this.import_queue.readItem()) |item| {
                const watcher_id = this.watcher.indexOf(item) orelse unreachable;
                const watch_item = this.watcher.watchlist.get(watcher_id);
                const source = try this.getSource(watch_item.file_path, if (watch_item.fd > 0) watch_item.fd else null);
                css.source = &source;
                if (source.contents.len > 0)
                    try css.scan(log, allocator);
            }

            // This exists to identify the entry point
            // When we do HMR, ask the entire bundle to be regenerated
            // But, we receive a file change event for a file within the bundle
            // So the inner ID is used to say "does this bundle need to be reloaded?"
            // The outer ID is used to say "go ahead and reload this"
            if (hot_module_reloading and FeatureFlags.css_supports_fence and this.bundle_queue.items.len > 0) {
                try this.writeAll("\n@supports (hmr-bid:");
                const int_buf_size = std.fmt.formatIntBuf(&int_buf_print, hash, 10, .upper, .{});
                try this.writeAll(int_buf_print[0..int_buf_size]);
                try this.writeAll(") {}\n");
            }
            var lines_of_code: usize = 0;

            // We LIFO
            var i: i32 = @as(i32, @intCast(this.bundle_queue.items.len - 1));
            while (i >= 0) : (i -= 1) {
                const item = this.bundle_queue.items[@as(usize, @intCast(i))];
                const watcher_id = this.watcher.indexOf(item) orelse unreachable;
                const watch_item = this.watcher.watchlist.get(watcher_id);
                const source = try this.getSource(watch_item.file_path, if (watch_item.fd > 0) watch_item.fd else null);
                css.source = &source;
                const file_path = fs.relativeTo(watch_item.file_path);
                if (hot_module_reloading and FeatureFlags.css_supports_fence) {
                    try this.writeAll("\n@supports (hmr-wid:");
                    const int_buf_size = std.fmt.formatIntBuf(&int_buf_print, item, 10, .upper, .{});
                    try this.writeAll(int_buf_print[0..int_buf_size]);
                    try this.writeAll(") and (hmr-file:\"");
                    try this.writeAll(file_path);
                    try this.writeAll("\") {}\n");
                }
                try this.writeAll("/* ");
                try this.writeAll(file_path);
                try this.writeAll("*/\n");
                if (source.contents.len > 0)
                    lines_of_code += try css.append(
                        log,
                        allocator,
                    );
            }

            try this.writer.done();

            return CodeCount{
                .written = @as(usize, @intCast(@max(this.writer.written - start_count, 0))),
                .approximate_newline_count = lines_of_code,
            };
        }

        pub fn getSource(this: *CSSBundler, url: string, input_fd: ?StoredFileDescriptorType) !logger.Source {
            const entry = try this.fs_reader.readFile(this.fs, url, 0, true, input_fd);
            return logger.Source.initFile(
                .{
                    .path = Fs.Path.init(url),
                    .contents = entry.contents,
                },
                this.allocator,
            );
        }

        pub fn addCSSImport(this: *CSSBundler, absolute_path: string) anyerror!void {
            const hash = Watcher.getHash(absolute_path);
            if (this.queued.items.len > 0 and std.mem.indexOfScalar(u32, this.queued.items, hash) != null) {
                return;
            }

            const watcher_index = this.watcher.indexOf(hash);

            if (watcher_index == null) {
                const file = try std.fs.openFileAbsolute(absolute_path, .{ .mode = .read_only });

                try this.watcher.appendFile(file.handle, absolute_path, hash, .css, 0, null, true);
                if (this.watcher.watchloop_handle == null) {
                    try this.watcher.start();
                }
            }

            try this.import_queue.writeItem(hash);
            try this.queued.append(hash);
            try this.bundle_queue.append(hash);
        }

        pub fn writeAll(this: *CSSBundler, buf: anytype) anyerror!void {
            _ = try this.writer.writeAll(buf);
        }

        // pub fn copyFileRange(this: *CSSBundler, buf: anytype) !void {}
    };
}
