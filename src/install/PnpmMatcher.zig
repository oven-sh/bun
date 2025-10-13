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

const FromExprError = OOM || error{
    InvalidRegExp,
    UnexpectedExpr,
};

pub fn fromExpr(allocator: std.mem.Allocator, expr: ast.Expr, log: *logger.Log, source: *const logger.Source) FromExprError!PnpmMatcher {
    var buf: collections.ArrayListDefault(u8) = .init();
    defer buf.deinit();

    bun.jsc.initialize(false);

    var matchers: collections.ArrayListDefault(Matcher) = .init();

    var has_include = false;
    var has_exclude = false;

    switch (expr.data) {
        .e_string => {
            const pattern = expr.data.e_string.slice(allocator);
            const matcher = createMatcher(pattern, &buf) catch |err| switch (err) {
                error.OutOfMemory => return err,
                error.InvalidRegExp => {
                    try log.addErrorFmtOpts(allocator, "Invalid regex: {s}", .{pattern}, .{
                        .loc = expr.loc,
                        .redact_sensitive_information = true,
                        .source = source,
                    });
                    return err;
                },
            };
            has_include = has_include or !matcher.is_exclude;
            has_exclude = has_exclude or matcher.is_exclude;
            try matchers.append(matcher);
        },
        .e_array => |patterns| {
            for (patterns.slice()) |pattern_expr| {
                if (try pattern_expr.asStringCloned(allocator)) |pattern| {
                    const matcher = createMatcher(pattern, &buf) catch |err| switch (err) {
                        error.OutOfMemory => return err,
                        error.InvalidRegExp => {
                            try log.addErrorFmtOpts(allocator, "Invalid regex: {s}", .{pattern}, .{
                                .loc = pattern_expr.loc,
                                .redact_sensitive_information = true,
                                .source = source,
                            });
                            return err;
                        },
                    };
                    has_include = has_include or !matcher.is_exclude;
                    has_exclude = has_exclude or matcher.is_exclude;
                    try matchers.append(matcher);
                } else {
                    try log.addErrorOpts("Expected a string", .{
                        .loc = pattern_expr.loc,
                        .redact_sensitive_information = true,
                        .source = source,
                    });
                    return error.UnexpectedExpr;
                }
            }
        },
        else => {
            try log.addErrorOpts("Expected a string or an array of strings", .{
                .loc = expr.loc,
                .redact_sensitive_information = true,
                .source = source,
            });
            return error.UnexpectedExpr;
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

const CreateMatcherError = OOM || error{InvalidRegExp};

fn createMatcher(raw: []const u8, buf: *collections.ArrayListDefault(u8)) CreateMatcherError!Matcher {
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

    const regex = try jsc.RegularExpression.init(.cloneUTF8(buf.items()), .none);

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

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const ast = bun.ast;
const collections = bun.collections;
const strings = bun.strings;
const String = bun.String;
const OOM = bun.OOM;
const logger = bun.logger;
