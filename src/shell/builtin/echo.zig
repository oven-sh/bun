const Echo = @This();

/// Should be allocated with the arena from Builtin
output: std.array_list.Managed(u8),

state: union(enum) {
    idle,
    waiting,
    waiting_write_err,
    done,
} = .idle,

pub fn start(this: *Echo) Yield {
    var args = this.bltn().argsSlice();

    // Parse flags: echo accepts -n, -e, -E in any combination.
    // Flag parsing stops at the first arg that doesn't start with '-'
    // or contains an invalid flag character.
    var no_newline = false;
    var escape_sequences = false;
    var flags_done = false;
    var args_start: usize = 0;

    for (args) |arg| {
        if (flags_done) break;
        const flag = std.mem.span(arg);
        if (flag.len < 2 or flag[0] != '-') {
            flags_done = true;
            break;
        }
        // Validate all characters are valid echo flags
        var valid = true;
        for (flag[1..]) |c| {
            switch (c) {
                'n', 'e', 'E' => {},
                else => {
                    valid = false;
                    break;
                },
            }
        }
        if (!valid) {
            flags_done = true;
            break;
        }
        // Apply flags (last -e/-E wins)
        for (flag[1..]) |c| {
            switch (c) {
                'n' => no_newline = true,
                'e' => escape_sequences = true,
                'E' => escape_sequences = false,
                else => unreachable,
            }
        }
        args_start += 1;
    }

    args = args[args_start..];
    const args_len = args.len;
    var has_leading_newline: bool = false;
    var stop_output = false;

    // TODO: Should flush buffer after it gets to a certain size
    for (args, 0..) |arg, i| {
        if (stop_output) break;
        const thearg = std.mem.span(arg);
        const is_last = i == args_len - 1;

        if (escape_sequences) {
            stop_output = appendWithEscapes(&this.output, thearg);
        } else {
            if (is_last) {
                if (thearg.len > 0 and thearg[thearg.len - 1] == '\n') {
                    has_leading_newline = true;
                }
                bun.handleOom(this.output.appendSlice(bun.strings.trimSubsequentLeadingChars(thearg, '\n')));
            } else {
                bun.handleOom(this.output.appendSlice(thearg));
            }
        }

        if (!stop_output and !is_last) {
            bun.handleOom(this.output.append(' '));
        }
    }

    if (!stop_output and !has_leading_newline and !no_newline) bun.handleOom(this.output.append('\n'));

    if (this.bltn().stdout.needsIO()) |safeguard| {
        this.state = .waiting;
        return this.bltn().stdout.enqueue(this, this.output.items[0..], safeguard);
    }
    _ = this.bltn().writeNoIO(.stdout, this.output.items[0..]);
    this.state = .done;
    return this.bltn().done(0);
}

/// Appends `input` to `output`, interpreting backslash escape sequences.
/// Returns true if a \c escape was encountered (meaning stop all output).
fn appendWithEscapes(output: *std.array_list.Managed(u8), input: []const u8) bool {
    var i: usize = 0;
    while (i < input.len) {
        if (input[i] == '\\' and i + 1 < input.len) {
            switch (input[i + 1]) {
                '\\' => {
                    bun.handleOom(output.append('\\'));
                    i += 2;
                },
                'a' => {
                    bun.handleOom(output.append('\x07'));
                    i += 2;
                },
                'b' => {
                    bun.handleOom(output.append('\x08'));
                    i += 2;
                },
                'c' => {
                    // \c: produce no further output
                    return true;
                },
                'e', 'E' => {
                    bun.handleOom(output.append('\x1b'));
                    i += 2;
                },
                'f' => {
                    bun.handleOom(output.append('\x0c'));
                    i += 2;
                },
                'n' => {
                    bun.handleOom(output.append('\n'));
                    i += 2;
                },
                'r' => {
                    bun.handleOom(output.append('\r'));
                    i += 2;
                },
                't' => {
                    bun.handleOom(output.append('\t'));
                    i += 2;
                },
                'v' => {
                    bun.handleOom(output.append('\x0b'));
                    i += 2;
                },
                '0' => {
                    // \0nnn: octal value (up to 3 octal digits)
                    i += 2; // skip \0
                    var val: u8 = 0;
                    var digits: usize = 0;
                    while (digits < 3 and i < input.len and input[i] >= '0' and input[i] <= '7') {
                        val = val *% 8 +% (input[i] - '0');
                        i += 1;
                        digits += 1;
                    }
                    bun.handleOom(output.append(val));
                },
                'x' => {
                    // \xHH: hex value (up to 2 hex digits)
                    i += 2; // skip \x
                    var val: u8 = 0;
                    var digits: usize = 0;
                    while (digits < 2 and i < input.len) {
                        const hex_val = hexDigitValue(input[i]);
                        if (hex_val) |hv| {
                            val = val *% 16 +% hv;
                            i += 1;
                            digits += 1;
                        } else {
                            break;
                        }
                    }
                    if (digits > 0) {
                        bun.handleOom(output.append(val));
                    } else {
                        // No valid hex digits: output \x literally
                        bun.handleOom(output.appendSlice("\\x"));
                    }
                },
                else => {
                    // Unknown escape: output backslash and the character as-is
                    bun.handleOom(output.append('\\'));
                    bun.handleOom(output.append(input[i + 1]));
                    i += 2;
                },
            }
        } else {
            bun.handleOom(output.append(input[i]));
            i += 1;
        }
    }
    return false;
}

fn hexDigitValue(c: u8) ?u8 {
    if (c >= '0' and c <= '9') return c - '0';
    if (c >= 'a' and c <= 'f') return c - 'a' + 10;
    if (c >= 'A' and c <= 'F') return c - 'A' + 10;
    return null;
}

pub fn onIOWriterChunk(this: *Echo, _: usize, e: ?jsc.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting or this.state == .waiting_write_err);
    }

    if (e != null) {
        defer e.?.deref();
        return this.bltn().done(e.?.getErrno());
    }

    this.state = .done;
    const exit_code: ExitCode = if (this.state == .waiting_write_err) 1 else 0;
    return this.bltn().done(exit_code);
}

pub fn deinit(this: *Echo) void {
    log("({s}) deinit", .{@tagName(.echo)});
    this.output.deinit();
}

pub inline fn bltn(this: *Echo) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("echo", this));
    return @fieldParentPtr("impl", impl);
}

const log = bun.Output.scoped(.echo, .hidden);

const interpreter = @import("../interpreter.zig");
const std = @import("std");

const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const bun = @import("bun");
const assert = bun.assert;
const jsc = bun.jsc;

const ExitCode = bun.shell.ExitCode;
const Yield = bun.shell.Yield;
