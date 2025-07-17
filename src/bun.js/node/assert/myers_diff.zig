//! ## IMPORTANT NOTE
//!
//! Do _NOT_ import from "bun" in this file! Do _NOT_ use the Bun object in this file!
//!
//! This file has tests defined in it which _cannot_ be run if `@import("bun")` is used!
//!
//! Run tests with `:zig test %`
const std = @import("std");
const builtin = @import("builtin");
const mem = std.mem;
const Allocator = mem.Allocator;
const stackFallback = std.heap.stackFallback;
const assert = std.debug.assert;

/// Comptime diff configuration. Defaults are usually sufficient.
pub const Options = struct {
    /// Guesstimate for the number of bytes `expected` and `actual` will be.
    /// Defaults to 256.
    ///
    /// Used to reserve space on the stack for the edit graph.
    avg_input_size: comptime_int = 256,
    /// How much stack space to reserve for edit trace frames. Defaults to 64.
    initial_trace_capacity: comptime_int = 64,
    /// When `true`, string lines that are only different by a trailing comma
    /// are considered equal. Not used when comparing chars. Defaults to
    /// `false`.
    check_comma_disparity: bool = false,
};

// By limiting maximum string and buffer lengths, we can store u32s in the
// edit graph instead of usize's, halving our memory footprint. The
// downside is that `(2 * (actual.len + expected.len))` must be less than
// 4Gb. If this becomes a problem in real user scenarios, we can adjust this.
//
// Note that overflows are much more likely to occur in real user scenarios
// than in our own testing, so overflow checks _must_ be handled. Do _not_
// use `assert` unless you also use `@setRuntimeSafety(true)`.
//
// TODO: make this configurable in `Options`?
const MAXLEN = std.math.maxInt(u32);
// Type aliasing to make future refactors easier
const uint = u32;
const int = i64; // must be large enough to hold all valid values of `uint` w/o overflow.

/// diffs two sets of lines, returning the minimal number of edits needed to
/// make them equal.
///
/// Lines may be string slices or chars. Derived from node's implementation of
/// the Myers' diff algorithm.
///
/// ## Example
/// ```zig
/// const myers_diff = @import("inode/assert/myers_diff.zig");
/// const StrDiffer = myers_diff.Differ([]const u8, .{});
/// const actual = &[_][]const u8{
///   "foo",
///   "bar",
///   "baz",
/// };
/// const expected = &[_][]const u8{
///   "foo",
///   "barrr",
///   "baz",
/// };
/// const diff = try StrDiffer.diff(allocator, actual, expected);
/// ```
///
/// TODO: support non-ASCII UTF-8 characters.
///
/// ## References
/// - [Node- `myers_diff.js`](https://github.com/nodejs/node/blob/main/lib/internal/assert/myers_diff.js)
/// - [An O(ND) Difference Algorithm and Its Variations](http://www.xmailserver.org/diff2.pdf)
pub fn Differ(comptime Line: type, comptime opts: Options) type {
    const eql: LineCmp(Line) = switch (Line) {
        // char-by-char comparison. u16 is for utf16
        u8, u16 => blk: {
            const gen = struct {
                pub fn eql(a: Line, b: Line) bool {
                    return a == b;
                }
            };
            break :blk gen.eql;
        },
        []const u8,
        []u8,
        [:0]const u8,
        [:0]u8,
        []const u16,
        []u16,
        [:0]const u16,
        [:0]u16,
        => blk: {
            const gen = struct {
                pub fn eql(a: Line, b: Line) bool {
                    return areStrLinesEqual(Line, a, b, opts.check_comma_disparity);
                }
            };
            break :blk gen.eql;
        },
        else => @compileError("Differ can only compare lines of chars or strings. Received: " ++ @typeName(Line)),
    };

    return DifferWithEql(Line, opts, eql);
}

/// Like `Differ`, but allows the user to provide a custom equality function.
pub fn DifferWithEql(comptime Line: type, comptime opts: Options, comptime areLinesEql: LineCmp(Line)) type {

    // `V = [-MAX, MAX]`.
    const graph_initial_size = comptime guess: {
        const size_wanted = 2 * opts.avg_input_size + 1;
        break :guess size_wanted + (size_wanted % 8); // 8-byte align
    };
    if (graph_initial_size > MAXLEN) @compileError("Input guess size is too large. The edit graph must be 32-bit addressable.");

    return struct {
        pub const eql = areLinesEql;
        pub const LineType = Line;

        /// Compute the shortest edit path (diff) between two sets of lines.
        ///
        /// Returned `Diff` objects borrow from the input slices. Both `actual`
        /// and `expected` must outlive them.
        ///
        /// ## References
        /// - [Node- `myers_diff.js`](https://github.com/nodejs/node/blob/main/lib/internal/assert/myers_diff.js)
        /// - [An O(ND) Difference Algorithm and Its Variations](http://www.xmailserver.org/diff2.pdf)
        pub fn diff(bun_allocator: Allocator, actual: []const Line, expected: []const Line) Error!DiffList(Line) {

            // Edit graph's allocator
            var graph_stack_alloc = stackFallback(graph_initial_size, bun_allocator);
            const graph_alloc = graph_stack_alloc.get();

            // Match point trace's allocator
            var trace_stack_alloc = stackFallback(opts.initial_trace_capacity, bun_allocator);
            const trace_alloc = trace_stack_alloc.get();

            // const MAX \in [0, M+N]
            // let V: int array = [-MAX..MAX]. V is a flattened representation of the edit graph.
            const max: uint, const graph_size: uint = blk: {
                // This is to preserve overflow protections even when runtime safety
                // checks are disabled. We don't know what kind of stuff users are
                // diffing in the wild.
                const _max: usize = actual.len + expected.len;
                const _graph_size = (2 * _max) + 1;

                if (_max > MAXLEN) return Error.InputsTooLarge;
                if (_graph_size > MAXLEN) return Error.DiffTooLarge;

                // const m:

                break :blk .{ @intCast(_max), @intCast(_graph_size) };
            };

            var graph = try graph_alloc.alloc(uint, graph_size);
            defer graph_alloc.free(graph);
            @memset(graph, 0);
            graph.len = graph_size;

            var trace = std.ArrayList([]const uint).init(trace_alloc);
            // reserve enough space for each frame to avoid realloc on ptr list. Lists may end up in the heap, but
            // this list is at the very from (and ∴ on stack).
            try trace.ensureTotalCapacityPrecise(max + 1);
            defer {
                for (trace.items) |frame| {
                    trace_alloc.free(frame);
                }
                trace.deinit();
            }

            // ================================================================
            // ==================== actual implementation =====================
            // ================================================================

            for (0..max + 1) |_diff_level| {
                const diff_level: int = @intCast(_diff_level); // why is this always usize?
                // const new_trace = try TraceFrame.initCapacity(trace_alloc, graph.len);
                const new_trace = try trace_alloc.dupe(uint, graph);
                trace.appendAssumeCapacity(new_trace);

                const diag_start: int = -@as(int, @intCast(diff_level));
                const diag_end: int = @intCast(diff_level);

                // for k ← -D in steps of 2 do
                var diag_idx = diag_start;
                while (diag_idx <= diag_end) : (diag_idx += 2) {
                    // if k = -D or K ≠ D and V[k-1] < V[k+1] then
                    //     x ← V[k+1]
                    // else
                    //     x ← V[k-1] + 1
                    assert(diag_idx + max >= 0); // sanity check. Fine to be stripped in release.
                    const k: uint = u(diag_idx + max);

                    const uk = u(k);
                    var x = if (diag_idx == diag_start or
                        (diag_idx != diag_end and graph[uk - 1] < graph[uk + 1]))
                        graph[uk + 1]
                    else
                        graph[uk - 1] + 1;

                    // y = x - diag_idx
                    var y: usize = blk: {
                        const x2: int = @intCast(x);
                        const y: int = x2 - diag_idx;
                        assert(y >= 0 and y <= MAXLEN); // sanity check. Fine to be stripped in release.
                        break :blk @intCast(y);
                    };

                    while (x < actual.len and y < expected.len and eql(actual[x], expected[y])) {
                        x += 1;
                        y += 1;
                    }
                    graph[k] = @intCast(x);
                    if (x >= actual.len and y >= expected.len) {
                        // todo: arena
                        return backtrack(bun_allocator, &trace, actual, expected);
                    }
                }
            }

            @panic("unreachable. Diffing should always reach the end of either `actual` or `expected` first.");
        }

        fn backtrack(
            allocator: Allocator,
            trace: *const std.ArrayList([]const uint),
            actual: []const Line,
            expected: []const Line,
        ) Error!DiffList(Line) {
            const max = i(actual.len + expected.len);
            var x = i(actual.len);
            var y = i(expected.len);

            var result = DiffList(Line).init(allocator);
            if (trace.items.len == 0) return result;

            //for (let diffLevel = trace.length - 1; diffLevel >= 0; diffLevel--) {
            var diff_level: usize = trace.items.len;
            while (diff_level > 0) {
                diff_level -= 1;
                const graph = trace.items[diff_level];
                const diagonal_index = x - y;

                const diag_offset = u(diagonal_index + max);
                const prev_diagonal_index: int = if (diagonal_index == -i(diff_level) or
                    (diagonal_index != diff_level and graph[u(diag_offset - 1)] < graph[u(diag_offset + 1)]))
                    diagonal_index + 1
                else
                    diagonal_index - 1;

                const prev_x: int = i(graph[u(prev_diagonal_index + i(max))]); // v[prevDiagonalIndex + max]
                const prev_y: int = i(prev_x) - prev_diagonal_index;

                try result.ensureUnusedCapacity(u(@max(x - prev_x, y - prev_y)));
                while (x > prev_x and y > prev_y) {
                    const line: Line = blk: {
                        if (@typeInfo(Line) == .pointer and comptime opts.check_comma_disparity) {
                            const actual_el = actual[u(x) - 1];
                            // actual[x-1].endsWith(',')
                            break :blk if (actual_el[actual_el.len - 1] == ',')
                                actual[u(x) - 1]
                            else
                                expected[u(y) - 1];
                        } else {
                            break :blk actual[u(x) - 1];
                        }
                    };

                    result.appendAssumeCapacity(.{ .kind = .equal, .value = line });
                    x -= 1;
                    y -= 1;
                }
                if (diff_level > 0) {
                    if (x > prev_x) {
                        try result.append(.{ .kind = .insert, .value = actual[u(x) - 1] });
                        x -= 1;
                    } else {
                        try result.append(.{ .kind = .delete, .value = expected[u(y) - 1] });
                        y -= 1;
                    }
                }
            }

            return result;
        }

        // shorthands for int casting since I'm tired of writing `@as(int, @intCast(x))` everywhere
        inline fn u(n: anytype) uint {
            return @intCast(n);
        }
        inline fn us(n: anytype) usize {
            return @intCast(n);
        }
        inline fn i(n: anytype) int {
            return @intCast(n);
        }
    };
}

pub fn printDiff(T: type, diffs: std.ArrayList(Diff(T))) !void {
    const stdout = if (builtin.is_test)
        std.io.getStdErr().writer()
    else
        std.io.getStdOut().writer();

    const specifier = switch (T) {
        u8 => "c",
        u32 => "u",
        []const u8 => "s",
        else => @compileError("printDiff can only print chars and strings. Received: " ++ @typeName(T)),
    };

    for (0..diffs.items.len) |idx| {
        const d = diffs.items[diffs.items.len - (idx + 1)];
        const op: u8 = switch (d.kind) {
            inline .equal => ' ',
            inline .insert => '+',
            inline .delete => '-',
        };
        try stdout.writeByte(op);
        try stdout.print(" {" ++ specifier ++ "}\n", .{d.value});
    }
}

// =============================================================================
// ============================ EQUALITY FUNCTIONS ============================
// =============================================================================

fn areCharsEqual(comptime T: type, a: T, b: T) bool {
    return a == b;
}

fn areLinesEqual(comptime T: type, a: T, b: T, comptime check_comma_disparity: bool) bool {
    return switch (T) {
        u8, u32 => a == b,
        []const u8, []u8, [:0]const u8, [:0]u8 => areStrLinesEqual(T, a, b, check_comma_disparity),
        else => @compileError("areLinesEqual can only compare chars and strings. Received: " ++ @typeName(T)),
    };
}

fn areStrLinesEqual(comptime T: type, a: T, b: T, comptime check_comma_disparity: bool) bool {
    // Hypothesis: unlikely to be the same, since assert.equal, etc. is rarely
    // used to compare the same object. May be true on shallow copies.
    // TODO: check Godbolt
    // if (a.ptr == b.ptr) return true;

    // []const u8 -> u8
    const info = @typeInfo(T);
    const ChildType = info.pointer.child;

    if (comptime !check_comma_disparity) {
        return mem.eql(ChildType, a, b);
    }

    const largest, const smallest = if (a.len > b.len) .{ a, b } else .{ b, a };
    return switch (largest.len - smallest.len) {
        inline 0 => mem.eql(ChildType, a, b),
        inline 1 => largest[largest.len - 1] == ',' and mem.eql(ChildType, largest[0..smallest.len], smallest), // 'foo,' == 'foo'
        else => false,
    };
}

// =============================================================================
// =================================== TYPES ===================================
// =============================================================================

/// Generic equality function. Returns `true` if two lines are equal.
pub fn LineCmp(Line: type) type {
    return fn (a: Line, b: Line) bool;
}

pub const Error = error{
    DiffTooLarge,
    InputsTooLarge,
} || Allocator.Error;

const TraceFrame = std.ArrayListUnmanaged(u8);

pub const DiffKind = enum {
    insert,
    delete,
    equal,

    pub fn format(value: DiffKind, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        return switch (value) {
            .insert => writer.writeByte('+'),
            .delete => writer.writeByte('-'),
            .equal => writer.writeByte(' '),
        };
    }
};

pub fn Diff(comptime T: type) type {
    return struct {
        kind: DiffKind,
        value: T,

        const Self = @This();
        pub fn eql(self: Self, other: Self) bool {
            return self.kind == other.kind and mem.eql(T, self.value, other.value);
        }

        /// pub fn format(value: ?, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void
        pub fn format(value: anytype, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const specifier = switch (T) {
                u8 => "c",
                u32 => "u",
                []const u8, [:0]const u8, []u8, [:0]u8 => "s",
                else => @compileError("printDiff can only print chars and strings. Received: " ++ @typeName(T)),
            };
            return writer.print("{} {" ++ specifier ++ "}", .{ value.kind, value.value });
        }
    };
}

pub fn DiffList(comptime T: type) type {
    return std.ArrayList(Diff(T));
}

// =============================================================================

const t = std.testing;
test areLinesEqual {
    // check_comma_disparity is never respected when comparing chars
    try t.expect(areLinesEqual(u8, 'a', 'a', false));
    try t.expect(areLinesEqual(u8, 'a', 'a', true));
    try t.expect(!areLinesEqual(u8, ',', 'a', false));
    try t.expect(!areLinesEqual(u8, ',', 'a', true));

    // strings w/o comma check
    try t.expect(areLinesEqual([]const u8, "", "", false));
    try t.expect(areLinesEqual([]const u8, "a", "a", false));
    try t.expect(areLinesEqual([]const u8, "Bun", "Bun", false));
    try t.expect(areLinesEqual([]const u8, "😤", "😤", false));
    // not equal
    try t.expect(!areLinesEqual([]const u8, "", "a", false));
    try t.expect(!areLinesEqual([]const u8, "", " ", false));
    try t.expect(!areLinesEqual([]const u8, "\n", "\t", false));
    try t.expect(!areLinesEqual([]const u8, "bun", "Bun", false));
    try t.expect(!areLinesEqual([]const u8, "😤", "😩", false));

    // strings w/ comma check
    try t.expect(areLinesEqual([]const u8, "", "", true));
    try t.expect(areLinesEqual([]const u8, "", ",", true));
    try t.expect(areLinesEqual([]const u8, " ", " ,", true));
    try t.expect(areLinesEqual([]const u8, "I am speed", "I am speed", true));
    try t.expect(areLinesEqual([]const u8, "I am speed,", "I am speed", true));
    try t.expect(areLinesEqual([]const u8, "I am speed", "I am speed,", true));
    try t.expect(areLinesEqual([]const u8, "😤", "😤", false));
    // try t.expect(areLinesEqual([]const u8, "😤", "😤,", false));
    // try t.expect(areLinesEqual([]const u8, "😤,", "😤", false));
    // not equal
    try t.expect(!areLinesEqual([]const u8, "", "Bun", true));
    try t.expect(!areLinesEqual([]const u8, "bun", "Bun", true));
    try t.expect(!areLinesEqual([]const u8, ",Bun", "Bun", true));
    try t.expect(!areLinesEqual([]const u8, "Bun", ",Bun", true));
    try t.expect(!areLinesEqual([]const u8, "", " ,", true));
    try t.expect(!areLinesEqual([]const u8, " ", " , ", true));
    try t.expect(!areLinesEqual([]const u8, "I, am speed", "I am speed", true));
    try t.expect(!areLinesEqual([]const u8, ",😤", "😤", true));
}

// const CharList = DiffList(u8);
// const CDiff = Diff(u8);
// const CharDiffer = Differ(u8, .{});

// fn testCharDiff(actual: []const u8, expected: []const u8, expected_diff: []const Diff(u8)) !void {
//     const allocator = t.allocator;
//     const actual_diff = try CharDiffer.diff(allocator, actual, expected);
//     defer actual_diff.deinit();
//     try t.expectEqualSlices(Diff(u8), expected_diff, actual_diff.items);
// }

// test CharDiffer {
//     const TestCase = std.meta.Tuple(&[_]type{ []const CDiff, []const u8, []const u8 });
//     const test_cases = &[_]TestCase{
//         .{ &[_]CDiff{}, "foo", "foo" },
//     };
//     for (test_cases) |test_case| {
//         const expected_diff, const actual, const expected = test_case;
//         try testCharDiff(actual, expected, expected_diff);
//     }
// }

const StrDiffer = Differ([]const u8, .{ .check_comma_disparity = true });
test StrDiffer {
    const a = t.allocator;
    inline for (.{
        .{ "foo", "foo" },
        .{ "foo", "bar" },
        .{
            // actual
            \\[
            \\  1,
            \\  2,
            \\  3,
            \\  4,
            \\  5,
            \\  6,
            \\  7
            \\]
            ,
            // expected
            \\[
            \\  1,
            \\  2,
            \\  3,
            \\  4,
            \\  5,
            \\  9,
            \\  7
            \\]
        },
        // remove line
        .{
            \\Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            \\incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            \\nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
            \\Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
            \\fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
            \\culpa qui officia deserunt mollit anim id est laborum.
            ,
            \\Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            \\incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            \\Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
            \\fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
            \\culpa qui officia deserunt mollit anim id est laborum.
            ,
        },
        // add some line
        .{
            \\Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            \\incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            \\nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
            \\Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
            \\fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
            \\culpa qui officia deserunt mollit anim id est laborum.
            ,
            \\Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            \\incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            \\Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            \\nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
            \\Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
            \\fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
            \\culpa qui officia deserunt mollit anim id est laborum.
            \\Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
            ,
        },
        // modify lines
        .{
            \\foo
            \\bar
            \\baz
            ,
            \\foo
            \\barrr
            \\baz
        },
        .{
            \\foooo
            \\bar
            \\baz
            ,
            \\foo
            \\bar
            \\baz
        },
        .{
            \\foo
            \\bar
            \\baz
            ,
            \\foo
            \\bar
            \\baz
        },
        .{
            \\Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor
            \\incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            \\nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
            \\Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
            \\fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in
            \\culpa qui officia deserunt mollit anim id est laborum.
            ,
            \\Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor modified
            \\incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis
            \\nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
            \\Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu
            \\fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in also modified
            \\culpa qui officia deserunt mollit anim id est laborum.
            ,
        },
    }) |thing| {
        var actual = try split(u8, a, thing[0]);
        var expected = try split(u8, a, thing[1]);
        defer {
            actual.deinit(a);
            expected.deinit(a);
        }
        var d = try StrDiffer.diff(a, actual.items, expected.items);
        defer d.deinit();
    }
}

pub fn split(
    comptime T: type,
    alloc: Allocator,
    s: []const T,
) Allocator.Error!std.ArrayListUnmanaged([]const T) {
    comptime {
        if (T != u8 and T != u16) {
            @compileError("Split only supports latin1, utf8, and utf16. Received: " ++ @typeName(T));
        }
    }
    const newline: T = if (comptime T == u8) '\n' else '\n';
    //
    // thing
    var it = std.mem.splitScalar(T, s, newline);
    var lines = std.ArrayListUnmanaged([]const T){};
    try lines.ensureUnusedCapacity(alloc, s.len >> 4);
    errdefer lines.deinit(alloc);
    while (it.next()) |l| {
        try lines.append(alloc, l);
    }

    return lines;
}
