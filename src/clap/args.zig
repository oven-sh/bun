/// An example of what methods should be implemented on an arg iterator.
pub const ExampleArgIterator = struct {
    const Error = error{};

    pub fn next(_: *ExampleArgIterator) Error!?[]const u8 {
        return "2";
    }
};

/// An argument iterator which iterates over a slice of arguments.
/// This implementation does not allocate.
pub const SliceIterator = struct {
    const Error = error{};

    remain: []const []const u8,

    pub fn init(args: []const []const u8) SliceIterator {
        return .{
            .remain = args,
        };
    }

    pub fn next(iter: *SliceIterator) ?[]const u8 {
        if (iter.remain.len > 0) {
            const res = iter.remain[0];
            iter.remain = iter.remain[1..];
            return res;
        }
        return null;
    }
};

test "SliceIterator" {
    const args = &[_][]const u8{ "A", "BB", "CCC" };
    var iter = SliceIterator{ .args = args };

    for (args) |a| {
        const b = try iter.next();
        debug.assert(mem.eql(u8, a, b.?));
    }
}

/// An argument iterator which wraps the ArgIterator in ::std.
/// On windows, this iterator allocates.
pub const OsIterator = struct {
    const Error = process.ArgIterator.InitError;

    arena: bun.ArenaAllocator,
    remain: [][:0]const u8,

    /// The executable path (this is the first argument passed to the program)
    /// TODO: Is it the right choice for this to be null? Maybe `init` should
    ///       return an error when we have no exe.
    exe_arg: ?[:0]const u8,

    pub fn init(allocator: mem.Allocator) OsIterator {
        var res = OsIterator{
            .arena = bun.ArenaAllocator.init(allocator),
            .exe_arg = undefined,
            .remain = bun.argv,
        };
        res.exe_arg = res.next();
        return res;
    }

    pub fn deinit(iter: *OsIterator) void {
        iter.arena.deinit();
    }

    pub fn next(iter: *OsIterator) ?[:0]const u8 {
        if (iter.remain.len > 0) {
            const res = iter.remain[0];
            iter.remain = iter.remain[1..];
            return res;
        }

        return null;
    }
};

/// An argument iterator that takes a string and parses it into arguments, simulating
/// how shells split arguments.
pub const ShellIterator = struct {
    const Error = error{
        DanglingEscape,
        QuoteNotClosed,
    } || mem.Allocator.Error;

    arena: bun.ArenaAllocator,
    str: []const u8,

    pub fn init(allocator: mem.Allocator, str: []const u8) ShellIterator {
        return .{
            .arena = bun.ArenaAllocator.init(allocator),
            .str = str,
        };
    }

    pub fn deinit(iter: *ShellIterator) void {
        iter.arena.deinit();
    }

    pub fn next(iter: *ShellIterator) Error!?[]const u8 {
        // Whenever possible, this iterator will return slices into `str` instead of
        // allocating. Sometimes this is not possible, for example, escaped characters
        // have be be unescape, so we need to allocate in this case.
        var list = std.array_list.Managed(u8).init(&iter.arena.allocator);
        var start: usize = 0;
        var state: enum {
            skip_whitespace,
            no_quote,
            no_quote_escape,
            single_quote,
            double_quote,
            double_quote_escape,
            after_quote,
        } = .skip_whitespace;

        for (iter.str, 0..) |c, i| {
            switch (state) {
                // The state that skips the initial whitespace.
                .skip_whitespace => switch (c) {
                    ' ', '\t', '\n' => {},
                    '\'' => {
                        start = i + 1;
                        state = .single_quote;
                    },
                    '"' => {
                        start = i + 1;
                        state = .double_quote;
                    },
                    '\\' => {
                        start = i + 1;
                        state = .no_quote_escape;
                    },
                    else => {
                        start = i;
                        state = .no_quote;
                    },
                },

                // The state that parses the none quoted part of a argument.
                .no_quote => switch (c) {
                    // We're done parsing a none quoted argument when we hit a
                    // whitespace.
                    ' ', '\t', '\n' => {
                        defer iter.str = iter.str[i..];
                        return iter.result(start, i, &list);
                    },

                    // Slicing is not possible if a quote starts while parsing none
                    // quoted args.
                    // Example:
                    // ab'cd' -> abcd
                    '\'' => {
                        try list.appendSlice(iter.str[start..i]);
                        start = i + 1;
                        state = .single_quote;
                    },
                    '"' => {
                        try list.appendSlice(iter.str[start..i]);
                        start = i + 1;
                        state = .double_quote;
                    },

                    // Slicing is not possible if we need to escape a character.
                    // Example:
                    // ab\"d -> ab"d
                    '\\' => {
                        try list.appendSlice(iter.str[start..i]);
                        start = i + 1;
                        state = .no_quote_escape;
                    },
                    else => {},
                },

                // We're in this state after having parsed the quoted part of an
                // argument. This state works mostly the same as .no_quote, but
                // is aware, that the last character seen was a quote, which should
                // not be part of the argument. This is why you will see `i - 1` here
                // instead of just `i` when `iter.str` is sliced.
                .after_quote => switch (c) {
                    ' ', '\t', '\n' => {
                        defer iter.str = iter.str[i..];
                        return iter.result(start, i - 1, &list);
                    },
                    '\'' => {
                        try list.appendSlice(iter.str[start .. i - 1]);
                        start = i + 1;
                        state = .single_quote;
                    },
                    '"' => {
                        try list.appendSlice(iter.str[start .. i - 1]);
                        start = i + 1;
                        state = .double_quote;
                    },
                    '\\' => {
                        try list.appendSlice(iter.str[start .. i - 1]);
                        start = i + 1;
                        state = .no_quote_escape;
                    },
                    else => {
                        try list.appendSlice(iter.str[start .. i - 1]);
                        start = i;
                        state = .no_quote;
                    },
                },

                // The states that parse the quoted part of arguments. The only differnece
                // between single and double quoted arguments is that single quoted
                // arguments ignore escape sequences, while double quoted arguments
                // does escaping.
                .single_quote => switch (c) {
                    '\'' => state = .after_quote,
                    else => {},
                },
                .double_quote => switch (c) {
                    '"' => state = .after_quote,
                    '\\' => {
                        try list.appendSlice(iter.str[start..i]);
                        start = i + 1;
                        state = .double_quote_escape;
                    },
                    else => {},
                },

                // The state we end up when after the escape character (`\`). All these
                // states do is transition back into the previous state.
                // TODO: Are there any escape sequences that does transform the second
                //       character into something else? For example, in Zig, `\n` is
                //       transformed into the line feed ascii character.
                .no_quote_escape => switch (c) {
                    else => state = .no_quote,
                },
                .double_quote_escape => switch (c) {
                    else => state = .double_quote,
                },
            }
        }

        defer iter.str = iter.str[iter.str.len..];
        switch (state) {
            .skip_whitespace => return null,
            .no_quote => return iter.result(start, iter.str.len, &list),
            .after_quote => return iter.result(start, iter.str.len - 1, &list),
            .no_quote_escape => return Error.DanglingEscape,
            .single_quote,
            .double_quote,
            .double_quote_escape,
            => return Error.QuoteNotClosed,
        }
    }

    fn result(iter: *ShellIterator, start: usize, end: usize, list: *std.array_list.Managed(u8)) Error!?[]const u8 {
        const res = iter.str[start..end];

        // If we already have something in `list` that means that we could not
        // parse the argument without allocation. We therefor need to just append
        // the rest we have to the list and return that.
        if (list.items.len != 0) {
            try list.appendSlice(res);
            return try list.toOwnedSlice();
        }
        return res;
    }
};

fn testShellIteratorOk(str: []const u8, allocations: usize, expect: []const []const u8) void {
    var allocator = testing.FailingAllocator.init(testing.allocator, allocations);
    var it = ShellIterator.init(&allocator.allocator, str);
    defer it.deinit();

    for (expect) |e| {
        if (it.next()) |actual| {
            testing.expect(actual != null);
            testing.expectEqualStrings(e, actual.?);
        } else |err| testing.expectEqual(@as(anyerror![]const u8, e), err);
    }

    if (it.next()) |actual| {
        testing.expectEqual(@as(?[]const u8, null), actual);
        testing.expectEqual(allocations, allocator.allocations);
    } else |err| testing.expectEqual(@as(anyerror!void, {}), err);
}

fn testShellIteratorErr(str: []const u8, expect: anyerror) void {
    var it = ShellIterator.init(testing.allocator, str);
    defer it.deinit();

    while (it.next() catch |err| {
        testing.expectError(expect, @as(anyerror!void, err));
        return;
    }) |_| {}

    testing.expectError(expect, @as(anyerror!void, {}));
}

test "ShellIterator" {
    testShellIteratorOk("a", 0, &[_][]const u8{"a"});
    testShellIteratorOk("'a'", 0, &[_][]const u8{"a"});
    testShellIteratorOk("\"a\"", 0, &[_][]const u8{"a"});
    testShellIteratorOk("a b", 0, &[_][]const u8{ "a", "b" });
    testShellIteratorOk("'a' b", 0, &[_][]const u8{ "a", "b" });
    testShellIteratorOk("\"a\" b", 0, &[_][]const u8{ "a", "b" });
    testShellIteratorOk("a 'b'", 0, &[_][]const u8{ "a", "b" });
    testShellIteratorOk("a \"b\"", 0, &[_][]const u8{ "a", "b" });
    testShellIteratorOk("'a b'", 0, &[_][]const u8{"a b"});
    testShellIteratorOk("\"a b\"", 0, &[_][]const u8{"a b"});
    testShellIteratorOk("\"a\"\"b\"", 1, &[_][]const u8{"ab"});
    testShellIteratorOk("'a''b'", 1, &[_][]const u8{"ab"});
    testShellIteratorOk("'a'b", 1, &[_][]const u8{"ab"});
    testShellIteratorOk("a'b'", 1, &[_][]const u8{"ab"});
    testShellIteratorOk("a\\ b", 1, &[_][]const u8{"a b"});
    testShellIteratorOk("\"a\\ b\"", 1, &[_][]const u8{"a b"});
    testShellIteratorOk("'a\\ b'", 0, &[_][]const u8{"a\\ b"});
    testShellIteratorOk("   a     b      ", 0, &[_][]const u8{ "a", "b" });
    testShellIteratorOk("\\  \\ ", 0, &[_][]const u8{ " ", " " });

    testShellIteratorOk(
        \\printf 'run\nuninstall\n'
    , 0, &[_][]const u8{ "printf", "run\\nuninstall\\n" });
    testShellIteratorOk(
        \\setsid -f steam "steam://$action/$id"
    , 0, &[_][]const u8{ "setsid", "-f", "steam", "steam://$action/$id" });
    testShellIteratorOk(
        \\xargs -I% rg --no-heading --no-line-number --only-matching
        \\    --case-sensitive --multiline --text --byte-offset '(?-u)%' $@
        \\
    , 0, &[_][]const u8{
        "xargs",            "-I%",             "rg",               "--no-heading",
        "--no-line-number", "--only-matching", "--case-sensitive", "--multiline",
        "--text",           "--byte-offset",   "(?-u)%",           "$@",
    });

    testShellIteratorErr("'a", error.QuoteNotClosed);
    testShellIteratorErr("'a\\", error.QuoteNotClosed);
    testShellIteratorErr("\"a", error.QuoteNotClosed);
    testShellIteratorErr("\"a\\", error.QuoteNotClosed);
    testShellIteratorErr("a\\", error.DanglingEscape);
}

const bun = @import("bun");

const std = @import("std");
const debug = std.debug;
const mem = std.mem;
const process = std.process;
const testing = std.testing;
