const std = @import("std");

const string = []const u8;

const RED = "\x1b[31;1m";
const GREEN = "\x1b[32;1m";
const CYAN = "\x1b[36;1m";
const WHITE = "\x1b[37;1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

pub const Tester = struct {
    pass: std.ArrayList(Expectation),
    fail: std.ArrayList(Expectation),
    allocator: std.mem.Allocator,

    pub fn t(allocator: std.mem.Allocator) Tester {
        return Tester{
            .allocator = allocator,
            .pass = std.ArrayList(Expectation).init(allocator),
            .fail = std.ArrayList(Expectation).init(allocator),
        };
    }

    pub const Expectation = struct {
        expected: string,
        result: string,
        source: std.builtin.SourceLocation,

        pub fn init(expected: string, result: string, src: std.builtin.SourceLocation) Expectation {
            return Expectation{
                .expected = expected,
                .result = result,
                .source = src,
            };
        }
        const PADDING = 0;
        pub fn print(self: *const @This()) void {
            const pad = &([_]u8{' '} ** PADDING);
            var stderr = std.io.getStdErr();

            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll(pad) catch unreachable;
            stderr.writeAll(DIM) catch unreachable;
            std.fmt.format(stderr.writer(), "{s}:{d}:{d}", .{ self.source.file, self.source.line, self.source.column }) catch unreachable;
            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll("\n") catch unreachable;

            stderr.writeAll(pad) catch unreachable;
            stderr.writeAll("Expected: ") catch unreachable;
            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll(GREEN) catch unreachable;
            std.fmt.format(stderr.writer(), "\"{s}\"", .{self.expected}) catch unreachable;
            stderr.writeAll(GREEN) catch unreachable;
            stderr.writeAll(RESET) catch unreachable;

            stderr.writeAll("\n") catch unreachable;
            stderr.writeAll(pad) catch unreachable;
            stderr.writeAll("Received: ") catch unreachable;
            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll(RED) catch unreachable;
            std.fmt.format(stderr.writer(), "\"{s}\"", .{self.result}) catch unreachable;
            stderr.writeAll(RED) catch unreachable;
            stderr.writeAll(RESET) catch unreachable;
            stderr.writeAll("\n") catch unreachable;
        }
        const strings = @import("../string_immutable.zig");
        pub fn evaluate_outcome(self: *const @This()) Outcome {
            if (strings.eql(self.expected, self.result)) {
                return .pass;
            } else {
                return .fail;
            }
        }
    };

    pub const Outcome = enum {
        pass,
        fail,
    };

    pub inline fn expect(tester: *Tester, expected: string, result: string, src: std.builtin.SourceLocation) bool {
        var expectation = Expectation.init(expected, result, src);
        switch (expectation.evaluate_outcome()) {
            .pass => {
                tester.pass.append(expectation) catch unreachable;
                return true;
            },
            .fail => {
                tester.fail.append(expectation) catch unreachable;
                return false;
            },
        }
    }

    const ReportType = enum {
        none,
        pass,
        fail,
        some_fail,

        pub fn init(tester: *Tester) ReportType {
            if (tester.fail.items.len == 0 and tester.pass.items.len == 0) {
                return .none;
            } else if (tester.fail.items.len == 0) {
                return .pass;
            } else if (tester.pass.items.len == 0) {
                return .fail;
            } else {
                return .some_fail;
            }
        }
    };

    pub fn report(tester: *Tester, src: std.builtin.SourceLocation) void {
        var stderr = std.io.getStdErr();

        if (tester.fail.items.len > 0) {
            std.fmt.format(stderr.writer(), "\n\n", .{}) catch unreachable;
        }

        for (tester.fail.items) |item| {
            item.print();
            std.fmt.format(stderr.writer(), "\n", .{}) catch unreachable;
        }

        switch (ReportType.init(tester)) {
            .none => {
                std.log.info("No expectations.\n\n", .{});
            },
            .pass => {
                std.fmt.format(stderr.writer(), "{s}All {d} expectations passed.{s}\n", .{ GREEN, tester.pass.items.len, GREEN }) catch unreachable;
                std.fmt.format(stderr.writer(), RESET, .{}) catch unreachable;
                std.testing.expect(true) catch std.debug.panic("Test failure", .{});
            },
            .fail => {
                std.fmt.format(stderr.writer(), "{s}All {d} expectations failed.{s}\n\n", .{ RED, tester.fail.items.len, RED }) catch unreachable;
                std.fmt.format(stderr.writer(), RESET, .{}) catch unreachable;
                std.testing.expect(false) catch std.debug.panic("Test failure", .{});
            },
            .some_fail => {
                std.fmt.format(stderr.writer(), "{s}{d} failed{s} and {s}{d} passed{s} of {d} expectations{s}\n\n", .{
                    RED,
                    tester.fail.items.len,
                    RED ++ RESET,
                    GREEN,
                    tester.pass.items.len,
                    GREEN ++ RESET,
                    tester.fail.items.len + tester.pass.items.len,
                    RESET,
                }) catch unreachable;
                std.fmt.format(stderr.writer(), RESET, .{}) catch unreachable;
                std.testing.expect(false) catch std.debug.panic("Test failure in {s}: {s}:{d}:{d}", .{ src.fn_name, src.file, src.line, src.column });
            },
        }
    }
};
