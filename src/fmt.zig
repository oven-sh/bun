const std = @import("std");
const bun = @import("root").bun;
const Output = bun.Output;
const strings = bun.strings;
const string = bun.string;
const js_lexer = bun.js_lexer;
const ComptimeStringMap = bun.ComptimeStringMap;
const fmt = std.fmt;
const Environment = bun.Environment;

pub usingnamespace std.fmt;

const SharedTempBuffer = [32 * 1024]u8;
fn getSharedBuffer() []u8 {
    return std.mem.asBytes(shared_temp_buffer_ptr orelse brk: {
        shared_temp_buffer_ptr = bun.default_allocator.create(SharedTempBuffer) catch unreachable;
        break :brk shared_temp_buffer_ptr.?;
    });
}
threadlocal var shared_temp_buffer_ptr: ?*SharedTempBuffer = null;

pub fn formatUTF16Type(comptime Slice: type, slice_: Slice, writer: anytype) !void {
    var chunk = getSharedBuffer();

    // Defensively ensure recursion doesn't cause the buffer to be overwritten in-place
    shared_temp_buffer_ptr = null;
    defer {
        if (shared_temp_buffer_ptr) |existing| {
            if (existing != chunk.ptr) {
                bun.default_allocator.destroy(@as(*SharedTempBuffer, @ptrCast(chunk.ptr)));
            }
        } else {
            shared_temp_buffer_ptr = @ptrCast(chunk.ptr);
        }
    }

    var slice = slice_;

    while (slice.len > 0) {
        const result = strings.copyUTF16IntoUTF8(chunk, Slice, slice, true);
        if (result.read == 0 or result.written == 0)
            break;
        try writer.writeAll(chunk[0..result.written]);
        slice = slice[result.read..];
    }
}

pub fn formatUTF16TypeWithPathOptions(comptime Slice: type, slice_: Slice, writer: anytype, opts: PathFormatOptions) !void {
    var chunk = getSharedBuffer();

    // Defensively ensure recursion doesn't cause the buffer to be overwritten in-place
    shared_temp_buffer_ptr = null;
    defer {
        if (shared_temp_buffer_ptr) |existing| {
            if (existing != chunk.ptr) {
                bun.default_allocator.destroy(@as(*SharedTempBuffer, @ptrCast(chunk.ptr)));
            }
        } else {
            shared_temp_buffer_ptr = @ptrCast(chunk.ptr);
        }
    }

    var slice = slice_;

    while (slice.len > 0) {
        const result = strings.copyUTF16IntoUTF8(chunk, Slice, slice, true);
        if (result.read == 0 or result.written == 0)
            break;

        const to_write = chunk[0..result.written];
        if (!opts.escape_backslashes and opts.path_sep == .any) {
            try writer.writeAll(to_write);
        } else {
            var ptr = to_write;
            while (strings.indexOfAny(ptr, "\\/")) |i| {
                const sep = switch (opts.path_sep) {
                    .windows => '\\',
                    .posix => '/',
                    .auto => std.fs.path.sep,
                    .any => ptr[i],
                };
                try writer.writeAll(ptr[0..i]);
                try writer.writeByte(sep);
                if (opts.escape_backslashes and sep == '\\') {
                    try writer.writeByte(sep);
                }

                ptr = ptr[i + 1 ..];
            }
            try writer.writeAll(ptr);
        }
        slice = slice[result.read..];
    }
}

pub inline fn utf16(slice_: []const u16) FormatUTF16 {
    return FormatUTF16{ .buf = slice_ };
}

pub const FormatUTF16 = struct {
    buf: []const u16,
    path_fmt_opts: ?PathFormatOptions = null,
    pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        if (self.path_fmt_opts) |opts| {
            try formatUTF16TypeWithPathOptions([]const u16, self.buf, writer, opts);
        } else {
            try formatUTF16Type([]const u16, self.buf, writer);
        }
    }
};

pub const FormatUTF8 = struct {
    buf: []const u8,
    path_fmt_opts: ?PathFormatOptions = null,
    pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        if (self.path_fmt_opts) |opts| {
            if (opts.path_sep == .any and opts.escape_backslashes == false) {
                try writer.writeAll(self.buf);
                return;
            }

            var ptr = self.buf;
            while (strings.indexOfAny(ptr, "\\/")) |i| {
                const sep = switch (opts.path_sep) {
                    .windows => '\\',
                    .posix => '/',
                    .auto => std.fs.path.sep,
                    .any => ptr[i],
                };
                try writer.writeAll(ptr[0..i]);
                try writer.writeByte(sep);
                if (opts.escape_backslashes and sep == '\\') {
                    try writer.writeByte(sep);
                }
                ptr = ptr[i + 1 ..];
            }

            try writer.writeAll(ptr);
            return;
        }

        try writer.writeAll(self.buf);
    }
};

pub const PathFormatOptions = struct {
    // The path separator used when formatting the path.
    path_sep: Sep = .any,

    /// Any backslashes are escaped, including backslashes
    /// added through `path_sep`.
    escape_backslashes: bool = false,

    pub const Sep = enum {
        /// Keep paths separators as is.
        any,
        /// Replace all path separators with the current platform path separator.
        auto,
        /// Replace all path separators with `/`.
        posix,
        /// Replace all path separators with `\`.
        windows,
    };
};

pub const FormatOSPath = if (Environment.isWindows) FormatUTF16 else FormatUTF8;

pub fn fmtOSPath(buf: bun.OSPathSlice, options: PathFormatOptions) FormatOSPath {
    return FormatOSPath{
        .buf = buf,
        .path_fmt_opts = options,
    };
}

pub fn fmtPath(
    comptime T: type,
    path: []const T,
    options: PathFormatOptions,
) if (T == u8) FormatUTF8 else FormatUTF16 {
    if (T == u8) {
        return FormatUTF8{
            .buf = path,
            .path_fmt_opts = options,
        };
    }

    return FormatUTF16{
        .buf = path,
        .path_fmt_opts = options,
    };
}

pub fn formatLatin1(slice_: []const u8, writer: anytype) !void {
    var chunk = getSharedBuffer();
    var slice = slice_;

    // Defensively ensure recursion doesn't cause the buffer to be overwritten in-place
    shared_temp_buffer_ptr = null;
    defer {
        if (shared_temp_buffer_ptr) |existing| {
            if (existing != chunk.ptr) {
                bun.default_allocator.destroy(@as(*SharedTempBuffer, @ptrCast(chunk.ptr)));
            }
        } else {
            shared_temp_buffer_ptr = @ptrCast(chunk.ptr);
        }
    }

    while (strings.firstNonASCII(slice)) |i| {
        if (i > 0) {
            try writer.writeAll(slice[0..i]);
            slice = slice[i..];
        }
        const result = strings.copyLatin1IntoUTF8(chunk, @TypeOf(slice), slice[0..@min(chunk.len, slice.len)]);
        if (result.read == 0 or result.written == 0)
            break;
        try writer.writeAll(chunk[0..result.written]);
        slice = slice[result.read..];
    }

    if (slice.len > 0)
        try writer.writeAll(slice); // write the remaining bytes
}

pub const URLFormatter = struct {
    proto: Proto = .http,
    hostname: ?string = null,
    port: ?u16 = null,

    const Proto = enum {
        http,
        https,
        unix,
        abstract,
    };

    pub fn format(this: URLFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try writer.print("{s}://", .{switch (this.proto) {
            .http => "http",
            .https => "https",
            .unix => "unix",
            .abstract => "abstract",
        }});

        if (this.hostname) |hostname| {
            const needs_brackets = hostname[0] != '[' and strings.isIPV6Address(hostname);
            if (needs_brackets) {
                try writer.print("[{s}]", .{hostname});
            } else {
                try writer.writeAll(hostname);
            }
        } else {
            try writer.writeAll("localhost");
        }

        if (this.proto == .unix) {
            return;
        }

        const is_port_optional = this.port == null or (this.proto == .https and this.port == 443) or
            (this.proto == .http and this.port == 80);
        if (is_port_optional) {
            try writer.writeAll("/");
        } else {
            try writer.print(":{d}/", .{this.port.?});
        }
    }
};

pub const HostFormatter = struct {
    host: string,
    port: ?u16 = null,
    is_https: bool = false,

    pub fn format(formatter: HostFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (strings.indexOfChar(formatter.host, ':') != null) {
            try writer.writeAll(formatter.host);
            return;
        }

        try writer.writeAll(formatter.host);

        const is_port_optional = formatter.port == null or (formatter.is_https and formatter.port == 443) or
            (!formatter.is_https and formatter.port == 80);
        if (!is_port_optional) {
            try writer.print(":{d}", .{formatter.port.?});
            return;
        }
    }
};

/// Format a string to an ECMAScript identifier.
/// Unlike the string_mutable.zig version, this always allocate/copy
pub fn fmtIdentifier(name: string) FormatValidIdentifier {
    return FormatValidIdentifier{ .name = name };
}

/// Format a string to an ECMAScript identifier.
/// Different implementation than string_mutable because string_mutable may avoid allocating
/// This will always allocate
pub const FormatValidIdentifier = struct {
    name: string,
    pub fn format(self: FormatValidIdentifier, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        var iterator = strings.CodepointIterator.init(self.name);
        var cursor = strings.CodepointIterator.Cursor{};

        var has_needed_gap = false;
        var needs_gap = false;
        var start_i: usize = 0;

        if (!iterator.next(&cursor)) {
            try writer.writeAll("_");
            return;
        }

        // Common case: no gap necessary. No allocation necessary.
        needs_gap = !js_lexer.isIdentifierStart(cursor.c);
        if (!needs_gap) {
            // Are there any non-alphanumeric chars at all?
            while (iterator.next(&cursor)) {
                if (!js_lexer.isIdentifierContinue(cursor.c) or cursor.width > 1) {
                    needs_gap = true;
                    start_i = cursor.i;
                    break;
                }
            }
        }

        if (needs_gap) {
            needs_gap = false;
            if (start_i > 0) try writer.writeAll(self.name[0..start_i]);
            var slice = self.name[start_i..];
            iterator = strings.CodepointIterator.init(slice);
            cursor = strings.CodepointIterator.Cursor{};

            while (iterator.next(&cursor)) {
                if (js_lexer.isIdentifierContinue(cursor.c) and cursor.width == 1) {
                    if (needs_gap) {
                        try writer.writeAll("_");
                        needs_gap = false;
                        has_needed_gap = true;
                    }
                    try writer.writeAll(slice[cursor.i .. cursor.i + @as(u32, cursor.width)]);
                } else if (!needs_gap) {
                    needs_gap = true;
                    // skip the code point, replace it with a single _
                }
            }

            // If it ends with an emoji
            if (needs_gap) {
                try writer.writeAll("_");
                needs_gap = false;
                has_needed_gap = true;
            }

            return;
        }

        try writer.writeAll(self.name);
    }
};

// Formats a string to be safe to output in a Github action.
// - Encodes "\n" as "%0A" to support multi-line strings.
//   https://github.com/actions/toolkit/issues/193#issuecomment-605394935
// - Strips ANSI output as it will appear malformed.
pub fn githubActionWriter(writer: anytype, self: string) !void {
    var offset: usize = 0;
    const end = @as(u32, @truncate(self.len));
    while (offset < end) {
        if (strings.indexOfNewlineOrNonASCIIOrANSI(self, @as(u32, @truncate(offset)))) |i| {
            const byte = self[i];
            if (byte > 0x7F) {
                offset += @max(strings.wtf8ByteSequenceLength(byte), 1);
                continue;
            }
            if (i > 0) {
                try writer.writeAll(self[offset..i]);
            }
            var n: usize = 1;
            if (byte == '\n') {
                try writer.writeAll("%0A");
            } else if (i + 1 < end) {
                const next = self[i + 1];
                if (byte == '\r' and next == '\n') {
                    n += 1;
                    try writer.writeAll("%0A");
                } else if (byte == '\x1b' and next == '[') {
                    n += 1;
                    if (i + 2 < end) {
                        const remain = self[(i + 2)..@min(i + 5, end)];
                        if (strings.indexOfChar(remain, 'm')) |j| {
                            n += j + 1;
                        }
                    }
                }
            }
            offset = i + n;
        } else {
            try writer.writeAll(self[offset..end]);
            break;
        }
    }
}

pub const GithubActionFormatter = struct {
    text: string,

    pub fn format(this: GithubActionFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try githubActionWriter(writer, this.text);
    }
};

pub fn githubAction(self: string) strings.GithubActionFormatter {
    return GithubActionFormatter{
        .text = self,
    };
}

pub fn quotedWriter(writer: anytype, self: string) !void {
    const remain = self;
    if (strings.containsNewlineOrNonASCIIOrQuote(remain)) {
        try bun.js_printer.writeJSONString(self, @TypeOf(writer), writer, strings.Encoding.utf8);
    } else {
        try writer.writeAll("\"");
        try writer.writeAll(self);
        try writer.writeAll("\"");
    }
}

pub const QuotedFormatter = struct {
    text: []const u8,

    pub fn format(this: QuotedFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        try quotedWriter(writer, this.text);
    }
};

pub fn fmtJavaScript(text: []const u8, enable_ansi_colors: bool) QuickAndDirtyJavaScriptSyntaxHighlighter {
    return QuickAndDirtyJavaScriptSyntaxHighlighter{
        .text = text,
        .enable_colors = enable_ansi_colors,
    };
}

pub const QuickAndDirtyJavaScriptSyntaxHighlighter = struct {
    text: []const u8,
    enable_colors: bool = false,
    limited: bool = true,

    const ColorCode = enum {
        magenta,
        blue,
        orange,
        red,
        pink,

        pub fn color(this: ColorCode) []const u8 {
            return switch (this) {
                .magenta => "\x1b[35m",
                .blue => "\x1b[34m",
                .orange => "\x1b[33m",
                .red => "\x1b[31m",
                // light pink
                .pink => "\x1b[38;5;206m",
            };
        }
    };

    pub const Keyword = enum {
        abstract,
        as,
        @"async",
        @"await",
        case,
        @"catch",
        class,
        @"const",
        @"continue",
        debugger,
        default,
        delete,
        do,
        @"else",
        @"enum",
        @"export",
        extends,
        false,
        finally,
        @"for",
        function,
        @"if",
        implements,
        import,
        in,
        instanceof,
        interface,
        let,
        new,
        null,
        package,
        private,
        protected,
        public,
        @"return",
        static,
        super,
        @"switch",
        this,
        throw,
        @"break",
        true,
        @"try",
        type,
        typeof,
        @"var",
        void,
        @"while",
        with,
        yield,
        string,
        number,
        boolean,
        symbol,
        any,
        object,
        unknown,
        never,
        namespace,
        declare,
        readonly,
        undefined,

        pub fn colorCode(this: Keyword) ColorCode {
            return switch (this) {
                .abstract => .blue,
                .as => .blue,
                .@"async" => .magenta,
                .@"await" => .magenta,
                .case => .magenta,
                .@"catch" => .magenta,
                .class => .magenta,
                .@"const" => .magenta,
                .@"continue" => .magenta,
                .debugger => .magenta,
                .default => .magenta,
                .delete => .red,
                .do => .magenta,
                .@"else" => .magenta,
                .@"break" => .magenta,
                .undefined => .orange,
                .@"enum" => .blue,
                .@"export" => .magenta,
                .extends => .magenta,
                .false => .orange,
                .finally => .magenta,
                .@"for" => .magenta,
                .function => .magenta,
                .@"if" => .magenta,
                .implements => .blue,
                .import => .magenta,
                .in => .magenta,
                .instanceof => .magenta,
                .interface => .blue,
                .let => .magenta,
                .new => .magenta,
                .null => .orange,
                .package => .magenta,
                .private => .blue,
                .protected => .blue,
                .public => .blue,
                .@"return" => .magenta,
                .static => .magenta,
                .super => .magenta,
                .@"switch" => .magenta,
                .this => .orange,
                .throw => .magenta,
                .true => .orange,
                .@"try" => .magenta,
                .type => .blue,
                .typeof => .magenta,
                .@"var" => .magenta,
                .void => .magenta,
                .@"while" => .magenta,
                .with => .magenta,
                .yield => .magenta,
                .string => .blue,
                .number => .blue,
                .boolean => .blue,
                .symbol => .blue,
                .any => .blue,
                .object => .blue,
                .unknown => .blue,
                .never => .blue,
                .namespace => .blue,
                .declare => .blue,
                .readonly => .blue,
            };
        }
    };

    pub const Keywords = bun.ComptimeEnumMap(Keyword);

    pub fn format(this: @This(), comptime unused_fmt: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        comptime bun.assert(unused_fmt.len == 0);

        var text = this.text;
        if (this.limited) {
            if (!this.enable_colors or text.len > 2048 or text.len == 0 or !strings.isAllASCII(text)) {
                try writer.writeAll(text);
                return;
            }
        }

        var prev_keyword: ?Keyword = null;

        outer: while (text.len > 0) {
            if (js_lexer.isIdentifierStart(text[0])) {
                var i: usize = 1;

                while (i < text.len and js_lexer.isIdentifierContinue(text[i])) {
                    i += 1;
                }

                if (Keywords.get(text[0..i])) |keyword| {
                    if (keyword != .as)
                        prev_keyword = keyword;
                    const code = keyword.colorCode();
                    try writer.print(Output.prettyFmt("<r>{s}{s}<r>", true), .{ code.color(), text[0..i] });
                } else {
                    write: {
                        if (prev_keyword) |prev| {
                            switch (prev) {
                                .new => {
                                    prev_keyword = null;

                                    if (i < text.len and text[i] == '(') {
                                        try writer.print(Output.prettyFmt("<r><b>{s}<r>", true), .{text[0..i]});
                                        break :write;
                                    }
                                },
                                .abstract, .namespace, .declare, .type, .interface => {
                                    try writer.print(Output.prettyFmt("<r><b><blue>{s}<r>", true), .{text[0..i]});
                                    prev_keyword = null;
                                    break :write;
                                },
                                .import => {
                                    if (strings.eqlComptime(text[0..i], "from")) {
                                        const code = ColorCode.magenta;
                                        try writer.print(Output.prettyFmt("<r>{s}{s}<r>", true), .{ code.color(), text[0..i] });
                                        prev_keyword = null;

                                        break :write;
                                    }
                                },
                                else => {},
                            }
                        }

                        try writer.writeAll(text[0..i]);
                    }
                }
                text = text[i..];
            } else {
                switch (text[0]) {
                    '0'...'9' => {
                        prev_keyword = null;
                        var i: usize = 1;
                        if (text.len > 1 and text[0] == '0' and text[1] == 'x') {
                            i += 1;
                            while (i < text.len and switch (text[i]) {
                                '0'...'9', 'a'...'f', 'A'...'F' => true,
                                else => false,
                            }) {
                                i += 1;
                            }
                        } else {
                            while (i < text.len and switch (text[i]) {
                                '0'...'9', '.', 'e', 'E', 'x', 'X', 'b', 'B', 'o', 'O' => true,
                                else => false,
                            }) {
                                i += 1;
                            }
                        }

                        try writer.print(Output.prettyFmt("<r><yellow>{s}<r>", true), .{text[0..i]});
                        text = text[i..];
                    },
                    inline '`', '"', '\'' => |char| {
                        prev_keyword = null;

                        var i: usize = 1;
                        while (i < text.len and text[i] != char) {
                            if (char == '`') {
                                if (text[i] == '$' and i + 1 < text.len and text[i + 1] == '{') {
                                    const curly_start = i;
                                    i += 2;

                                    while (i < text.len and text[i] != '}') {
                                        if (text[i] == '\\') {
                                            i += 1;
                                        }
                                        i += 1;
                                    }

                                    try writer.print(Output.prettyFmt("<r><green>{s}<r>", true), .{text[0..curly_start]});
                                    try writer.writeAll("${");
                                    const curly_remain = QuickAndDirtyJavaScriptSyntaxHighlighter{
                                        .text = text[curly_start + 2 .. i],
                                        .enable_colors = this.enable_colors,
                                        .limited = false,
                                    };

                                    if (curly_remain.text.len > 0) {
                                        try curly_remain.format("", .{}, writer);
                                    }

                                    if (i < text.len and text[i] == '}') {
                                        i += 1;
                                    }
                                    try writer.writeAll("}");
                                    text = text[i..];
                                    i = 0;
                                    if (text.len > 0 and text[0] == char) {
                                        try writer.writeAll(Output.prettyFmt("<r><green>`<r>", true));
                                        text = text[1..];
                                        continue :outer;
                                    }
                                    continue;
                                }
                            }

                            if (i + 1 < text.len and text[i] == '\\') {
                                i += 1;
                            }

                            i += 1;
                        }

                        // Include the trailing quote, if any
                        i += @intFromBool(i < text.len);

                        try writer.print(Output.prettyFmt("<r><green>{s}<r>", true), .{text[0..i]});
                        text = text[i..];
                    },
                    '/' => {
                        prev_keyword = null;
                        var i: usize = 1;

                        // the start of a line comment
                        if (i < text.len and text[i] == '/') {
                            while (i < text.len and text[i] != '\n') {
                                i += 1;
                            }

                            const remain_to_print = text[0..i];
                            if (i < text.len and text[i] == '\n') {
                                i += 1;
                            }

                            if (i < text.len and text[i] == '\r') {
                                i += 1;
                            }

                            try writer.print(Output.prettyFmt("<r><d>{s}<r>", true), .{remain_to_print});
                            text = text[i..];
                            continue;
                        }

                        as_multiline_comment: {
                            if (i < text.len and text[i] == '*') {
                                i += 1;

                                while (i + 2 < text.len and !strings.eqlComptime(text[i..][0..2], "*/")) {
                                    i += 1;
                                }

                                if (i + 2 < text.len and strings.eqlComptime(text[i..][0..2], "*/")) {
                                    i += 2;
                                } else {
                                    i = 1;
                                    break :as_multiline_comment;
                                }

                                try writer.print(Output.prettyFmt("<r><d>{s}<r>", true), .{text[0..i]});
                                text = text[i..];
                                continue;
                            }
                        }

                        try writer.writeAll(text[0..i]);
                        text = text[i..];
                    },
                    '}', '{' => {
                        // support potentially highlighting "from" in an import statement
                        if ((prev_keyword orelse Keyword.@"continue") != .import) {
                            prev_keyword = null;
                        }

                        try writer.writeAll(text[0..1]);
                        text = text[1..];
                    },
                    '[', ']' => {
                        prev_keyword = null;
                        try writer.writeAll(text[0..1]);
                        text = text[1..];
                    },
                    ';' => {
                        prev_keyword = null;
                        try writer.print(Output.prettyFmt("<r><d>;<r>", true), .{});
                        text = text[1..];
                    },
                    '.' => {
                        prev_keyword = null;
                        var i: usize = 1;
                        if (text.len > 1 and (js_lexer.isIdentifierStart(text[1]) or text[1] == '#')) {
                            i = 2;

                            while (i < text.len and js_lexer.isIdentifierContinue(text[i])) {
                                i += 1;
                            }

                            if (i < text.len and (text[i] == '(')) {
                                try writer.print(Output.prettyFmt("<r><i><b>{s}<r>", true), .{text[0..i]});
                                text = text[i..];
                                continue;
                            }
                            i = 1;
                        }

                        try writer.writeAll(text[0..1]);
                        text = text[1..];
                    },

                    '<' => {
                        var i: usize = 1;

                        // JSX
                        jsx: {
                            if (text.len > 1 and text[0] == '/') {
                                i = 2;
                            }
                            prev_keyword = null;

                            while (i < text.len and js_lexer.isIdentifierContinue(text[i])) {
                                i += 1;
                            } else {
                                i = 1;
                                break :jsx;
                            }

                            while (i < text.len and text[i] != '>') {
                                i += 1;

                                if (i < text.len and text[i] == '<') {
                                    i = 1;
                                    break :jsx;
                                }
                            }

                            if (i < text.len and text[i] == '>') {
                                i += 1;
                                try writer.print(Output.prettyFmt("<r><cyan>{s}<r>", true), .{text[0..i]});
                                text = text[i..];
                                continue;
                            }

                            i = 1;
                        }

                        try writer.print(Output.prettyFmt("<r>{s}<r>", true), .{text[0..i]});
                        text = text[i..];
                    },

                    else => {
                        try writer.writeAll(text[0..1]);
                        text = text[1..];
                    },
                }
            }
        }
    }

    /// Function for testing in highlighter.test.ts
    pub fn jsFunctionSyntaxHighlight(globalThis: *bun.JSC.JSGlobalObject, callframe: *bun.JSC.CallFrame) callconv(bun.JSC.conv) bun.JSC.JSValue {
        const args = callframe.arguments(1);
        if (args.len < 1) {
            globalThis.throwNotEnoughArguments("code", 1, 0);
        }

        const code = args.ptr[0].toSliceOrNull(globalThis) orelse return .zero;
        defer code.deinit();
        var buffer = bun.MutableString.initEmpty(bun.default_allocator);
        defer buffer.deinit();
        var writer = buffer.bufferedWriter();
        var formatter = bun.fmt.fmtJavaScript(code.slice(), true);
        formatter.limited = false;
        std.fmt.format(writer.writer(), "{}", .{formatter}) catch |err| {
            globalThis.throwError(err, "Error formatting code");
            return .zero;
        };

        writer.flush() catch |err| {
            globalThis.throwError(err, "Error formatting code");
            return .zero;
        };

        var str = bun.String.createUTF8(buffer.list.items);
        defer str.deref();
        return str.toJS(globalThis);
    }
};

pub fn quote(self: string) bun.fmt.QuotedFormatter {
    return bun.fmt.QuotedFormatter{
        .text = self,
    };
}

pub fn EnumTagListFormatter(comptime Enum: type, comptime Separator: @Type(.EnumLiteral)) type {
    return struct {
        pretty: bool = true,
        const output = brk: {
            var text: []const u8 = "";
            const names = std.meta.fieldNames(Enum);
            for (names, 0..) |name, i| {
                if (Separator == .list) {
                    if (i > 0) {
                        if (i + 1 == names.len) {
                            text = text ++ ", or ";
                        } else {
                            text = text ++ ", ";
                        }
                    }

                    text = text ++ "\"" ++ name ++ "\"";
                } else if (Separator == .dash) {
                    text = text ++ "\n-  " ++ name;
                } else {
                    @compileError("Unknown separator type: must be .dash or .list");
                }
            }
            break :brk text;
        };
        pub fn format(_: @This(), comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
            try writer.writeAll(output);
        }
    };
}

pub fn enumTagList(comptime Enum: type, comptime separator: @Type(.EnumLiteral)) EnumTagListFormatter(Enum, separator) {
    return EnumTagListFormatter(Enum, separator){};
}

pub fn formatIp(address: std.net.Address, into: []u8) ![]u8 {
    // std.net.Address.format includes `:<port>` and square brackets (IPv6)
    //  while Node does neither.  This uses format then strips these to bring
    //  the result into conformance with Node.
    var result = try std.fmt.bufPrint(into, "{}", .{address});

    // Strip `:<port>`
    if (std.mem.lastIndexOfScalar(u8, result, ':')) |colon| {
        result = result[0..colon];
    }
    // Strip brackets
    if (result[0] == '[' and result[result.len - 1] == ']') {
        result = result[1 .. result.len - 1];
    }
    return result;
}

// https://lemire.me/blog/2021/06/03/computing-the-number-of-digits-of-an-integer-even-faster/
pub fn fastDigitCount(x: u64) u64 {
    if (x == 0) {
        return 1;
    }

    const table = [_]u64{
        4294967296,
        8589934582,
        8589934582,
        8589934582,
        12884901788,
        12884901788,
        12884901788,
        17179868184,
        17179868184,
        17179868184,
        21474826480,
        21474826480,
        21474826480,
        21474826480,
        25769703776,
        25769703776,
        25769703776,
        30063771072,
        30063771072,
        30063771072,
        34349738368,
        34349738368,
        34349738368,
        34349738368,
        38554705664,
        38554705664,
        38554705664,
        41949672960,
        41949672960,
        41949672960,
        42949672960,
        42949672960,
    };
    return x + table[std.math.log2(x)] >> 32;
}

pub const SizeFormatter = struct {
    value: usize = 0,

    pub fn format(self: SizeFormatter, comptime _: []const u8, opts: fmt.FormatOptions, writer: anytype) !void {
        const math = std.math;
        const value = self.value;
        if (value == 0) {
            return writer.writeAll("0 KB");
        }

        if (value < 512) {
            try fmt.formatInt(self.value, 10, .lower, opts, writer);
            return writer.writeAll(" bytes");
        }

        const mags_si = " KMGTPEZY";
        const log2 = math.log2(value);
        const magnitude = @min(log2 / comptime math.log2(1000), mags_si.len - 1);
        const new_value = math.lossyCast(f64, value) / math.pow(f64, 1000, math.lossyCast(f64, magnitude));
        const suffix = mags_si[magnitude];

        if (suffix == ' ') {
            try writer.print("{d:.2} KB", .{new_value / 1000.0});
            return;
        }
        const precision: usize = if (std.math.approxEqAbs(f64, new_value, @trunc(new_value), 0.100)) 1 else 2;
        try fmt.formatType(new_value, "d", .{ .precision = precision }, writer, 0);
        try writer.writeAll(&.{ ' ', suffix, 'B' });
    }
};

pub fn size(value: anytype) SizeFormatter {
    return switch (@TypeOf(value)) {
        f64, f32, f128 => SizeFormatter{
            .value = @as(u64, @intFromFloat(value)),
        },
        else => SizeFormatter{ .value = value },
    };
}

const lower_hex_table = [_]u8{
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
};
const upper_hex_table = [_]u8{
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
    '7',
    '8',
    '9',
    'A',
    'B',
    'C',
    'D',
    'E',
    'F',
};
pub fn HexIntFormatter(comptime Int: type, comptime lower: bool) type {
    return struct {
        value: Int,

        const table = if (lower) lower_hex_table else upper_hex_table;

        const BufType = [@bitSizeOf(Int) / 4]u8;

        fn getOutBuf(value: Int) BufType {
            var buf: BufType = undefined;
            inline for (&buf, 0..) |*c, i| {
                // value relative to the current nibble
                c.* = table[@as(u8, @as(u4, @truncate(value >> comptime ((buf.len - i - 1) * 4)))) & 0xF];
            }
            return buf;
        }

        pub fn format(self: @This(), comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
            const value = self.value;
            try writer.writeAll(&getOutBuf(value));
        }
    };
}

pub fn HexInt(comptime Int: type, comptime lower: std.fmt.Case, value: Int) HexIntFormatter(Int, lower == .lower) {
    const Formatter = HexIntFormatter(Int, lower == .lower);
    return Formatter{ .value = value };
}

pub fn hexIntLower(value: anytype) HexIntFormatter(@TypeOf(value), true) {
    const Formatter = HexIntFormatter(@TypeOf(value), true);
    return Formatter{ .value = value };
}

pub fn hexIntUpper(value: anytype) HexIntFormatter(@TypeOf(value), false) {
    const Formatter = HexIntFormatter(@TypeOf(value), false);
    return Formatter{ .value = value };
}

const FormatDurationData = struct {
    ns: u64,
    negative: bool = false,
};

/// This is copied from std.fmt.formatDuration, except it will only print one decimal instead of three
fn formatDurationOneDecimal(data: FormatDurationData, comptime _: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
    // worst case: "-XXXyXXwXXdXXhXXmXX.XXXs".len = 24
    var buf: [24]u8 = undefined;
    var fbs = std.io.fixedBufferStream(&buf);
    var buf_writer = fbs.writer();
    if (data.negative) {
        buf_writer.writeByte('-') catch unreachable;
    }

    var ns_remaining = data.ns;
    inline for (.{
        .{ .ns = 365 * std.time.ns_per_day, .sep = 'y' },
        .{ .ns = std.time.ns_per_week, .sep = 'w' },
        .{ .ns = std.time.ns_per_day, .sep = 'd' },
        .{ .ns = std.time.ns_per_hour, .sep = 'h' },
        .{ .ns = std.time.ns_per_min, .sep = 'm' },
    }) |unit| {
        if (ns_remaining >= unit.ns) {
            const units = ns_remaining / unit.ns;
            std.fmt.formatInt(units, 10, .lower, .{}, buf_writer) catch unreachable;
            buf_writer.writeByte(unit.sep) catch unreachable;
            ns_remaining -= units * unit.ns;
            if (ns_remaining == 0)
                return std.fmt.formatBuf(fbs.getWritten(), opts, writer);
        }
    }

    inline for (.{
        .{ .ns = std.time.ns_per_s, .sep = "s" },
        .{ .ns = std.time.ns_per_ms, .sep = "ms" },
        .{ .ns = std.time.ns_per_us, .sep = "us" },
    }) |unit| {
        const kunits = ns_remaining * 1000 / unit.ns;
        if (kunits >= 1000) {
            std.fmt.formatInt(kunits / 1000, 10, .lower, .{}, buf_writer) catch unreachable;
            const frac = @divFloor(kunits % 1000, 100);
            if (frac > 0) {
                var decimal_buf = [_]u8{ '.', 0 };
                _ = std.fmt.formatIntBuf(decimal_buf[1..], frac, 10, .lower, .{ .fill = '0', .width = 1 });
                buf_writer.writeAll(&decimal_buf) catch unreachable;
            }
            buf_writer.writeAll(unit.sep) catch unreachable;
            return std.fmt.formatBuf(fbs.getWritten(), opts, writer);
        }
    }

    std.fmt.formatInt(ns_remaining, 10, .lower, .{}, buf_writer) catch unreachable;
    buf_writer.writeAll("ns") catch unreachable;
    return std.fmt.formatBuf(fbs.getWritten(), opts, writer);
}

/// Return a Formatter for number of nanoseconds according to its magnitude:
/// [#y][#w][#d][#h][#m]#[.###][n|u|m]s
pub fn fmtDurationOneDecimal(ns: u64) std.fmt.Formatter(formatDurationOneDecimal) {
    return .{ .data = FormatDurationData{ .ns = ns } };
}

pub fn fmtSlice(data: anytype, comptime delim: []const u8) FormatSlice(@TypeOf(data), delim) {
    return .{ .slice = data };
}

fn FormatSlice(comptime T: type, comptime delim: []const u8) type {
    return struct {
        slice: T,

        pub fn format(self: @This(), comptime format_str: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
            if (self.slice.len == 0) return;
            const f = "{" ++ format_str ++ "}";
            try writer.print(f, .{self.slice[0]});
            for (self.slice[1..]) |item| {
                if (delim.len > 0) try writer.writeAll(delim);
                try writer.print(f, .{item});
            }
        }
    };
}

/// Uses WebKit's double formatter
pub fn fmtDouble(number: f64) FormatDouble {
    return .{ .number = number };
}

pub const FormatDouble = struct {
    number: f64,

    extern fn WTF__dtoa(buf_124_bytes: *[124]u8, number: f64) void;

    pub fn dtoa(buf: *[124]u8, number: f64) []const u8 {
        WTF__dtoa(buf, number);
        return bun.sliceTo(buf, 0);
    }

    pub fn dtoaWithNegativeZero(buf: *[124]u8, number: f64) []const u8 {
        if (std.math.isNegativeZero(number)) {
            return "-0";
        }

        WTF__dtoa(buf, number);
        return bun.sliceTo(buf, 0);
    }

    pub fn format(self: @This(), comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        var buf: [124]u8 = undefined;
        const slice = dtoa(&buf, self.number);
        try writer.writeAll(slice);
    }
};

pub fn nullableFallback(value: anytype, null_fallback: []const u8) NullableFallback(@TypeOf(value)) {
    return .{ .value = value, .null_fallback = null_fallback };
}

pub fn NullableFallback(comptime T: type) type {
    return struct {
        value: T,
        null_fallback: []const u8,

        pub fn format(self: @This(), comptime template: []const u8, opts: fmt.FormatOptions, writer: anytype) !void {
            if (self.value) |value| {
                try std.fmt.formatType(value, template, opts, writer, 4);
            } else {
                try writer.writeAll(self.null_fallback);
            }
        }
    };
}
