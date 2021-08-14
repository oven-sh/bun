const std = @import("std");
const logger = @import("./logger.zig");
usingnamespace @import("./global.zig");
const CodepointIterator = @import("./string_immutable.zig").CodepointIterator;

const Variable = struct {
    key: string,
    value: string,
};

// i don't expect anyone to actually use the escape line feed character
const escLineFeed = 0x0C;
// arbitrary character that is invalid in a real text file
const implicitQuoteCharacter = 8;

pub const Lexer = struct {
    source: *const logger.Source,
    iter: CodepointIterator,
    _codepoint: CodePoint = 0,
    current: usize = 0,
    start: usize = 0,
    end: usize = 0,
    has_nested_values: bool = false,
    has_newline_before: bool = true,

    pub inline fn codepoint(this: *Lexer) CodePoint {
        return this._codepoint;
    }

    pub fn step(this: *Lexer) void {
        @call(.{ .modifier = .always_inline }, CodepointIterator.nextCodepointNoReturn, .{&this.iter});
        this._codepoint = this.iter.c;
        this.current += 1;
    }

    pub fn eatValue(
        lexer: *Lexer,
        comptime quote: CodePoint,
    ) string {
        const start = lexer.current - 1;
        lexer.step();

        var last_non_space: usize = 0;
        while (true) {
            switch (lexer.codepoint()) {
                '\\' => {
                    lexer.step();
                    // Handle Windows CRLF
                    last_non_space += 1;
                    if (lexer.codepoint() == '\r') {
                        lexer.step();
                        last_non_space += 1;
                        if (lexer.codepoint() == '\n') {
                            lexer.step();
                            last_non_space += 1;
                        }
                        continue;
                    }
                },
                -1 => {
                    lexer.end = lexer.current;

                    return lexer.source.contents[start..][0 .. last_non_space + 1];
                },
                '$' => {
                    lexer.has_nested_values = true;
                    last_non_space += 1;
                },

                '#' => {
                    lexer.step();
                    lexer.eatComment();

                    return lexer.source.contents[start..][0 .. last_non_space + 1];
                },

                '\n', '\r', escLineFeed => {
                    switch (comptime quote) {
                        '\'' => {
                            lexer.end = lexer.current;
                            lexer.step();
                            return lexer.source.contents[start .. lexer.end - 1];
                        },
                        implicitQuoteCharacter => {
                            lexer.end = lexer.current;
                            lexer.step();

                            return lexer.source.contents[start..][0 .. last_non_space + 1];
                        },
                        '"' => {
                            // We keep going

                        },
                        else => {},
                    }
                },
                quote => {
                    lexer.end = lexer.current;
                    lexer.step();
                    return lexer.source.contents[start..lexer.end];
                },
                ' ' => {},
                else => {
                    last_non_space += 1;
                },
            }

            lexer.step();
        }
        unreachable;
    }

    pub fn eatComment(this: *Lexer) void {
        while (true) {
            switch (this.codepoint()) {
                '\r' => {
                    this.step();
                    if (this.codepoint() == '\n') {
                        return;
                    }
                },
                '\n' => {
                    this.step();
                    return;
                },
                -1 => {
                    return;
                },
                else => {
                    this.step();
                },
            }
        }
    }

    // const NEWLINE = '\n'
    // const RE_INI_KEY_VAL = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/
    // const RE_NEWLINES = /\\n/g
    // const NEWLINES_MATCH = /\r\n|\n|\r/
    pub fn next(this: *Lexer) ?Variable {
        if (this.end == 0) this.step();

        const start = this.start;

        this.has_newline_before = this.end == 0;

        restart: while (true) {
            switch (this.codepoint()) {
                0, -1 => {
                    return null;
                },
                '#' => {
                    this.step();

                    this.eatComment();
                    continue :restart;
                },
                '\r', '\n', 0x2028, 0x2029 => {
                    this.step();
                    this.has_newline_before = true;
                    continue;
                },

                // Valid keys:
                'a'...'z', 'A'...'Z', '0'...'9', '_', '-', '.' => {
                    this.start = this.current - 1;
                    this.step();
                    var last_non_space: usize = 0;
                    while (true) {
                        switch (this.codepoint()) {

                            // to match npm's "dotenv" behavior, we ignore lines that don't have an equals
                            '\r', '\n', escLineFeed => {
                                this.end = this.current;
                                this.step();
                                continue :restart;
                            },
                            0, -1 => {
                                this.end = this.current;
                                return Variable{ .key = this.source.contents[this.start..][0 .. last_non_space + 1], .value = "" };
                            },
                            'a'...'z', 'A'...'Z', '0'...'9', '_', '-', '.' => {
                                last_non_space += 1;
                            },
                            '=' => {
                                this.end = this.current;
                                const key = this.source.contents[this.start..][0 .. last_non_space + 1];
                                if (key.len == 0) return null;
                                this.step();

                                inner: while (true) {
                                    switch (this.codepoint()) {
                                        '"' => {
                                            const value = this.eatValue('"');
                                            return Variable{ .key = key, .value = value };
                                        },
                                        '\'' => {
                                            const value = this.eatValue('\'');
                                            return Variable{ .key = key, .value = value };
                                        },
                                        0, -1 => {
                                            return Variable{ .key = key, .value = "" };
                                        },
                                        '\r', '\n', escLineFeed => {
                                            this.step();
                                            return Variable{ .key = key, .value = "" };
                                        },
                                        // consume unquoted leading spaces
                                        ' ' => {
                                            this.step();
                                            continue :inner;
                                        },
                                        // we treat everything else the same as if it were wrapped in single quotes
                                        // except we don't terminate on that character
                                        else => {
                                            const value = this.eatValue(implicitQuoteCharacter);
                                            return Variable{ .key = key, .value = value };
                                        },
                                    }
                                }
                            },
                            ' ' => {},
                            else => {
                                last_non_space += 1;
                            },
                        }
                        this.step();
                    }
                },
                else => {},
            }

            this.step();
        }
    }

    pub fn init(source: *const logger.Source) Lexer {
        return Lexer{
            .source = source,
            .iter = CodepointIterator{ .bytes = source.contents, .i = 0 },
        };
    }
};

pub const Parser = struct {
    pub fn parse(source: *const logger.Source, allocator: *std.mem.Allocator) Map {
        var map = Map.init(allocator);

        var lexer = Lexer.init(source);
        while (lexer.next()) |variable| {
            map.put(variable.key, variable.value) catch {};
        }

        return map;
    }
};

pub const Map = struct {
    const HashTable = std.StringArrayHashMap(string);

    map: HashTable,

    pub inline fn init(allocator: *std.mem.Allocator) Map {
        return Map{ .map = HashTable.init(allocator) };
    }

    pub inline fn iter(this: *Map) !HashTable.Iterator {
        return this.map.iterator();
    }

    pub inline fn put(this: *Map, key: string, value: string) !void {
        try this.map.put(key, value);
    }

    pub inline fn get(
        this: *const Map,
        key: string,
    ) ?string {
        return this.map.get(key);
    }

    pub inline fn putDefault(this: *Map, key: string, value: string) !void {
        _ = try this.map.getOrPutValue(key, value);
    }
};

const expectString = std.testing.expectEqualStrings;
const expect = std.testing.expect;
test "DotEnv Loader" {
    const VALID_ENV =
        \\API_KEY=verysecure
        \\process.env.WAT=ABCDEFGHIJKLMNOPQRSTUVWXYZZ10239457123
        \\DOUBLE-QUOTED_SHOULD_PRESERVE_NEWLINES="
        \\ya
        \\"
        \\DOUBLE_QUOTES_ESCAPABLE="\"yoooo\""
        \\SINGLE_QUOTED_SHOULDNT_PRESERVE_NEWLINES='yo
        \\'
        \\
        \\SINGLE_QUOTED_PRESERVES_QUOTES='yo'
        \\
        \\# Line Comment
        \\UNQUOTED_SHOULDNT_PRESERVE_NEWLINES_AND_TRIMS_TRAILING_SPACE=yo # Inline Comment
        \\
        \\      LEADING_SPACE_IS_TRIMMED=yes
        \\
        \\LEADING_SPACE_IN_UNQUOTED_VALUE_IS_TRIMMED=        yes
        \\
        \\LINES_WITHOUT_EQUAL_ARE_IGNORED
        \\
        \\NO_VALUE_IS_EMPTY_STRING=
        \\LINES_WITHOUT_EQUAL_ARE_IGNORED
        \\
        \\IGNORING_DOESNT_BREAK_OTHER_LINES='yes'
        \\
    ;
    const source = logger.Source.initPathString(".env", VALID_ENV);
    const map = Parser.parse(&source, std.heap.c_allocator);
    try expectString(map.get("API_KEY").?, "verysecure");
    try expectString(map.get("process.env.WAT").?, "ABCDEFGHIJKLMNOPQRSTUVWXYZZ10239457123");
    try expectString(map.get("DOUBLE-QUOTED_SHOULD_PRESERVE_NEWLINES").?, "\"\nya\n\"");
    try expectString(map.get("SINGLE_QUOTED_SHOULDNT_PRESERVE_NEWLINES").?, "'yo");
    try expectString(map.get("SINGLE_QUOTED_PRESERVES_QUOTES").?, "'yo'");
    try expectString(map.get("UNQUOTED_SHOULDNT_PRESERVE_NEWLINES_AND_TRIMS_TRAILING_SPACE").?, "yo");
    try expect(map.get("LINES_WITHOUT_EQUAL_ARE_IGNORED") == null);
    try expectString(map.get("LEADING_SPACE_IS_TRIMMED").?, "yes");
    try expect(map.get("NO_VALUE_IS_EMPTY_STRING").?.len == 0);
    try expectString(map.get("IGNORING_DOESNT_BREAK_OTHER_LINES").?, "'yes'");
    try expectString(map.get("LEADING_SPACE_IN_UNQUOTED_VALUE_IS_TRIMMED").?, "yes");
}
