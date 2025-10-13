/// https://github.com/pnpm/pnpm/blob/3abd3946237aa6ba7831552310ec371ddd3616c2/config/matcher/src/index.ts
const PnpmMatcher = @This();

matchers: []const Matcher,
behavior: Behavior,

const Matcher = struct {
    pattern: union(enum) {
        match_all,
        regex: *jsc.RegularExpression,
    },
    is_exclude: bool,
};

const Behavior = enum {
    all_matchers_include,
    all_matchers_exclude,
    has_exclude_and_include_matchers,
};

pub fn fromExpr(expr: ast.Expr) OOM!?PnpmMatcher {
    var buf: collections.ArrayListDefault(u8) = .init();
    defer buf.deinit();

    bun.jsc.initialize(false);

    var matchers: collections.ArrayListDefault(Matcher) = .init();

    var has_include = false;
    var has_exclude = false;

    switch (expr.data) {
        .e_string => |pattern_str| {
            if (try createMatcher(pattern_str.slice(bun.default_allocator), &buf)) |matcher| {
                has_include = !matcher.is_exclude;
                has_exclude = matcher.is_exclude;
                try matchers.append(matcher);
            }
        },
        .e_array => |patterns| {
            for (patterns.slice()) |pattern| {
                if (pattern.asString(bun.default_allocator)) |pattern_str| {
                    if (try createMatcher(pattern_str, &buf)) |matcher| {
                        has_include = !matcher.is_exclude;
                        has_exclude = matcher.is_exclude;
                        try matchers.append(matcher);
                    }
                } else {
                    return null;
                }
            }
        },
        else => {
            return null;
        },
    }

    const behavior: Behavior = if (!has_include)
        .all_matchers_exclude
    else if (!has_exclude)
        .all_matchers_include
    else
        .has_exclude_and_include_matchers;

    return .{
        .matchers = try matchers.toOwnedSlice(),
        .behavior = behavior,
    };
}

fn createMatcher(raw: []const u8, buf: *collections.ArrayListDefault(u8)) OOM!?Matcher {
    buf.clearRetainingCapacity();
    var writer = buf.writer();

    var trimmed = strings.trim(raw, &strings.whitespace_chars);

    var is_exclude = false;
    if (strings.startsWithChar(trimmed, '!')) {
        is_exclude = true;
        trimmed = trimmed[1..];
    }

    if (strings.eqlComptime(trimmed, "*")) {
        return .{ .pattern = .match_all, .is_exclude = is_exclude };
    }

    try writer.writeByte('^');
    try strings.escapeRegExpForPackageNameMatching(trimmed, writer);
    try writer.writeByte('$');

    const regex = jsc.RegularExpression.init(.cloneUTF8(buf.items()), .none) catch {
        // invalid regex is ignored.
        return null;
    };

    return .{ .pattern = .{ .regex = regex }, .is_exclude = is_exclude };
}

pub fn isMatch(this: *const PnpmMatcher, name: []const u8) bool {
    if (this.matchers.len == 0) {
        return false;
    }

    const name_str: String = .fromBytes(name);

    switch (this.behavior) {
        .all_matchers_include => {
            for (this.matchers) |matcher| {
                switch (matcher.pattern) {
                    .match_all => {
                        return true;
                    },
                    .regex => |regex| {
                        if (regex.matches(name_str)) {
                            return true;
                        }
                    },
                }
            }
            return false;
        },
        .all_matchers_exclude => {
            for (this.matchers) |matcher| {
                switch (matcher.pattern) {
                    .match_all => {
                        return false;
                    },
                    .regex => |regex| {
                        if (regex.matches(name_str)) {
                            return false;
                        }
                    },
                }
            }
            return true;
        },
        .has_exclude_and_include_matchers => {
            var matches = false;
            for (this.matchers) |matcher| {
                switch (matcher.pattern) {
                    .match_all => {
                        matches = !matcher.is_exclude;
                    },
                    .regex => |regex| {
                        if (regex.matches(name_str)) {
                            matches = !matcher.is_exclude;
                        }
                    },
                }
            }
            return matches;
        },
    }
}

const bun = @import("bun");
const jsc = bun.jsc;
const ast = bun.ast;
const collections = bun.collections;
const strings = bun.strings;
const String = bun.String;
const OOM = bun.OOM;
