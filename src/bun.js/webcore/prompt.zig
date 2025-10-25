//! Implements prompt, alert, and confirm Web API
comptime {
    const js_alert = jsc.toJSHostFn(alert);
    @export(&js_alert, .{ .name = "WebCore__alert" });
    const js_prompt = jsc.toJSHostFn(prompt.call);
    @export(&js_prompt, .{ .name = "WebCore__prompt" });
    const js_confirm = jsc.toJSHostFn(confirm);
    @export(&js_confirm, .{ .name = "WebCore__confirm" });
}

/// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-alert
fn alert(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    var output = bun.Output.writer();
    const has_message = arguments.len != 0;

    // 2. If the method was invoked with no arguments, then let message be the empty string; otherwise, let message be the method's first argument.
    if (has_message) {
        var state = std.heap.stackFallback(2048, bun.default_allocator);
        const allocator = state.get();
        const message = try arguments[0].toSlice(globalObject, allocator);
        defer message.deinit();

        if (message.len > 0) {
            // 3. Set message to the result of normalizing newlines given message.
            // *  We skip step 3 because they are already done in most terminals by default.

            // 4. Set message to the result of optionally truncating message.
            // *  We just don't do this because it's not necessary.

            // 5. Show message to the user, treating U+000A LF as a line break.
            output.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return.
                return .js_undefined;
            };
        }
    }

    output.writeAll(if (has_message) " [Enter] " else "Alert [Enter] ") catch {
        // 1. If we cannot show simple dialogs for this, then return.
        return .js_undefined;
    };

    // 6. Invoke WebDriver BiDi user prompt opened with this, "alert", and message.
    // *  Not pertinent to use their complex system in a server context.
    bun.Output.flush();

    // 7. Optionally, pause while waiting for the user to acknowledge the message.
    var stdin = std.io.getStdIn();
    var reader = stdin.reader();
    while (true) {
        const byte = reader.readByte() catch break;
        if (byte == '\n') break;
    }

    // 8. Invoke WebDriver BiDi user prompt closed with this and true.
    // *  Again, not necessary in a server context.

    return .js_undefined;
}

fn confirm(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).slice();
    var output = bun.Output.writer();
    const has_message = arguments.len != 0;

    if (has_message) {
        var state = std.heap.stackFallback(1024, bun.default_allocator);
        const allocator = state.get();
        // 2. Set message to the result of normalizing newlines given message.
        // *  Not pertinent to a server runtime so we will just let the terminal handle this.

        // 3. Set message to the result of optionally truncating message.
        // *  Not necessary so we won't do it.
        const message = try arguments[0].toSlice(globalObject, allocator);
        defer message.deinit();

        output.writeAll(message.slice()) catch {
            // 1. If we cannot show simple dialogs for this, then return false.
            return .false;
        };
    }

    // 4. Show message to the user, treating U+000A LF as a line break,
    //    and ask the user to respond with a positive or negative
    //    response.
    output.writeAll(if (has_message) " [y/N] " else "Confirm [y/N] ") catch {
        // 1. If we cannot show simple dialogs for this, then return false.
        return .false;
    };

    // 5. Invoke WebDriver BiDi user prompt opened with this, "confirm", and message.
    // *  Not relevant in a server context.
    bun.Output.flush();

    // 6. Pause until the user responds either positively or negatively.
    var stdin = std.io.getStdIn();
    const unbuffered_reader = stdin.reader();
    var buffered = std.io.bufferedReader(unbuffered_reader);
    var reader = buffered.reader();

    const first_byte = reader.readByte() catch {
        return .false;
    };

    // 7. Invoke WebDriver BiDi user prompt closed with this, and true if
    //    the user responded positively or false otherwise.
    // *  Not relevant in a server context.

    switch (first_byte) {
        '\n' => return .false,
        '\r' => {
            const next_byte = reader.readByte() catch {
                // They may have said yes, but the stdin is invalid.
                return .false;
            };
            if (next_byte == '\n') {
                return .false;
            }
        },
        'y', 'Y' => {
            const next_byte = reader.readByte() catch {
                // They may have said yes, but the stdin is invalid.

                return .false;
            };

            if (next_byte == '\n') {
                // 8. If the user responded positively, return true;
                //    otherwise, the user responded negatively: return false.
                return .true;
            } else if (next_byte == '\r') {
                //Check Windows style
                const second_byte = reader.readByte() catch {
                    return .false;
                };
                if (second_byte == '\n') {
                    return .true;
                }
            }
        },
        else => {},
    }

    while (reader.readByte()) |b| {
        if (b == '\n' or b == '\r') break;
    } else |_| {}

    // 8. If the user responded positively, return true; otherwise, the user
    //    responded negatively: return false.
    return .false;
}

pub const prompt = struct {
    /// Adapted from `std.io.Reader.readUntilDelimiterArrayList` to only append
    /// and assume capacity.
    pub fn readUntilDelimiterArrayListAppendAssumeCapacity(
        reader: anytype,
        array_list: *std.ArrayList(u8),
        delimiter: u8,
        max_size: usize,
    ) !void {
        while (true) {
            if (array_list.items.len == max_size) {
                return error.StreamTooLong;
            }

            const byte: u8 = try reader.readByte();

            if (byte == delimiter) {
                return;
            }

            array_list.appendAssumeCapacity(byte);
        }
    }

    /// Adapted from `std.io.Reader.readUntilDelimiterArrayList` to always append
    /// and not resize.
    fn readUntilDelimiterArrayListInfinity(
        reader: anytype,
        array_list: *std.ArrayList(u8),
        delimiter: u8,
    ) !void {
        while (true) {
            const byte: u8 = try reader.readByte();

            if (byte == delimiter) {
                return;
            }

            try array_list.append(byte);
        }
    }

    /// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-prompt
    /// This implementation has two modes:
    /// 1. If stdin is an interactive TTY, it switches the terminal to raw mode to
    ///    provide a rich editing experience with cursor movement.
    /// 2. If stdin is not a TTY (e.g., piped input), it falls back to a simple
    ///    buffered line reader.
    pub fn call(
        globalObject: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(3).slice();
        var state = std.heap.stackFallback(2048, bun.default_allocator);
        const allocator = state.get();
        var output = bun.Output.writer();
        const has_message = arguments.len != 0;
        const has_default = arguments.len >= 2;
        // 4. Set default to the result of optionally truncating default.
        // *  We don't really need to do this.
        const default = if (has_default) arguments[1] else .null;

        if (has_message) {
            // 2. Set message to the result of normalizing newlines given message.
            // *  Not pertinent to a server runtime so we will just let the terminal handle this.

            // 3. Set message to the result of optionally truncating message.
            // *  Not necessary so we won't do it.
            const message = try arguments[0].toSlice(globalObject, allocator);
            defer message.deinit();

            output.writeAll(message.slice()) catch {
                // 1. If we cannot show simple dialogs for this, then return null.
                return .null;
            };
        }

        // 4. Set default to the result of optionally truncating default.

        // 5. Show message to the user, treating U+000A LF as a line break,
        //    and ask the user to either respond with a string value or
        //    abort. The response must be defaulted to the value given by
        //    default.
        output.writeAll(if (has_message) " " else "Prompt ") catch {
            // 1. If we cannot show simple dialogs for this, then return false.
            return .false;
        };

        if (has_default) {
            const default_string = try arguments[1].toSlice(globalObject, allocator);
            defer default_string.deinit();

            output.print("[{s}] ", .{default_string.slice()}) catch {
                // 1. If we cannot show simple dialogs for this, then return false.
                return .false;
            };
        }

        // 6. Invoke WebDriver BiDi user prompt opened with this, "prompt" and message.
        // *  Not relevant in a server context.
        bun.Output.flush();

        // unset `ENABLE_VIRTUAL_TERMINAL_INPUT` on windows. This prevents backspace from
        // deleting the entire line
        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.windows.updateStdioModeFlags(.std_in, .{ .unset = c.ENABLE_VIRTUAL_TERMINAL_INPUT }) catch null;

        defer if (comptime Environment.isWindows) {
            if (original_mode) |mode| {
                _ = bun.c.SetConsoleMode(bun.FD.stdin().native(), mode);
            }
        };

        // 7. Pause while waiting for the user's response.
        if (comptime !Environment.isWindows) {
            const c_termios = @cImport({
                @cInclude("termios.h");
                @cInclude("unistd.h");
                @cInclude("signal.h");
            });

            if (c_termios.isatty(bun.FD.stdin().native()) == 1) {
                var original_termios: c_termios.termios = undefined;
                var pendingSigint: bool = false;
                if (c_termios.tcgetattr(bun.FD.stdin().native(), &original_termios) != 0) {
                    return .null;
                }

                defer {
                    _ = c_termios.tcsetattr(bun.FD.stdin().native(), c_termios.TCSADRAIN, &original_termios);
                    // Move cursor to next line after input is done
                    _ = bun.Output.writer().writeAll("\n") catch {};
                    bun.Output.flush();
                    if (pendingSigint) {
                        _ = c_signal.raise(c_signal.SIGINT);
                    }
                }

                var raw_termios = original_termios;
                // Unset canonical mode, echo, signal generation, and extended input processing
                raw_termios.c_lflag &= ~@as(c_termios.tcflag_t, c_termios.ICANON | c_termios.ECHO | c_termios.ISIG | c_termios.IEXTEN);
                // Set VMIN=1 and VTIME=0 for non-canonical read (read returns after 1 byte)
                raw_termios.c_cc[c_termios.VMIN] = 1;
                raw_termios.c_cc[c_termios.VTIME] = 0;

                if (c_termios.tcsetattr(bun.FD.stdin().native(), c_termios.TCSADRAIN, &raw_termios) != 0) {
                    return .null;
                }

                var input = std.ArrayList(u8).init(allocator);
                defer input.deinit();
                var cursor_index: usize = 0;

                const reader = bun.Output.buffered_stdin.reader();
                var stdout_writer = bun.Output.writer();

                while (true) {
                    const byte = reader.readByte() catch {
                        // Real I/O error or EOF from upstream (not user EOT)
                        return .null;
                    };

                    switch (byte) {
                        // End of input
                        '\n', '\r' => {
                            if (input.items.len == 0 and !has_default) return jsc.ZigString.init("").toJS(globalObject);
                            if (input.items.len == 0) return default;

                            var result = jsc.ZigString.init(input.items);
                            result.markUTF8();
                            return result.toJS(globalObject);
                        },

                        // Backspace (ASCII 8) or DEL (ASCII 127)
                        8, 127 => {
                            if (cursor_index > 0) {
                                const old_cursor_index = cursor_index;
                                const prev_codepoint_start = std.unicode.utf8Prev(input.items, old_cursor_index);
                                if (prev_codepoint_start) |start| {
                                    // Remove the codepoint bytes
                                    _ = input.orderedRemoveRange(start, old_cursor_index);
                                    cursor_index = start;
                                } else {
                                    // Fallback for invalid UTF-8 or start of string: delete one byte
                                    _ = input.orderedRemove(old_cursor_index - 1);
                                    cursor_index -= 1;
                                }

                                // Redraw the line from the cursor
                                _ = stdout_writer.writeAll("\x1b[D") catch {}; // Move cursor left (1 column)
                                _ = stdout_writer.writeAll(input.items[cursor_index..]) catch {};
                                _ = stdout_writer.writeAll(" ") catch {}; // Clear the character at the end (1 column)
                                _ = stdout_writer.print("\x1b[{d}D", .{input.items.len - cursor_index + 1}) catch {}; // Move cursor back
                                bun.Output.flush();
                            }
                        },

                        // Ctrl+C
                        3 => {
                            // This will trigger the defer and restore terminal settings
                            pendingSigint = true;
                            return .null;
                        },

                        // Escape sequence (e.g., arrow keys)
                        27 => {
                            // Try to read the next two bytes for [D (left) or [C (right)
                            const byte2 = reader.readByte() catch continue;
                            if (byte2 != '[') {
                                continue;
                            }
                            switch (reader.readByte() catch continue) {
                                'D' => { // Left arrow
                                    if (cursor_index > 0) {
                                        cursor_index = std.unicode.utf8Prev(input.items, cursor_index) orelse cursor_index - 1;
                                        _ = stdout_writer.writeAll("\x1b[D") catch {};
                                        bun.Output.flush();
                                    }
                                },
                                'C' => { // Right arrow
                                    if (cursor_index < input.items.len) {
                                        cursor_index = std.unicode.utf8Next(input.items, cursor_index) orelse cursor_index + 1;
                                        _ = stdout_writer.writeAll("\x1b[C") catch {};
                                        bun.Output.flush();
                                    }
                                },
                                '3' => { // DEL
                                    const next = reader.readByte() catch continue;
                                    if (next != '~') {
                                        // Signifies that there is a modifier key (SHIFT, CTRL).
                                        // We ignore the modifier as that is what canonical mode does.
                                        if (next == ';') {
                                            _ = reader.readByte() catch continue; // modifier key skipped
                                            const final = reader.readByte() catch continue;
                                            if (final != '~') {
                                                continue;
                                            }
                                        } else {
                                            continue;
                                        }
                                    }
                                    // Handle Delete key: remove character under cursor
                                    if (cursor_index < input.items.len) {
                                        const next_codepoint_start = std.unicode.utf8Next(input.items, cursor_index);
                                        if (next_codepoint_start) |end| {
                                            // Remove the codepoint bytes
                                            _ = input.orderedRemoveRange(cursor_index, end);
                                        } else {
                                            // Fallback: delete one byte if invalid UTF-8
                                            _ = input.orderedRemove(cursor_index);
                                        }

                                        // Redraw from cursor
                                        _ = stdout_writer.writeAll(input.items[cursor_index..]) catch {};
                                        _ = stdout_writer.writeAll(" ") catch {};
                                        _ = stdout_writer.print("\x1b[{d}D", .{input.items.len - cursor_index + 1}) catch {};
                                        bun.Output.flush();
                                    }
                                },
                                else => {},
                            }
                        },

                        // Ctrl+D (EOT)
                        4 => {
                            return .null;
                        },

                        else => {
                            try input.insert(cursor_index, byte);
                            cursor_index += 1;

                            // Echo the new character and redraw the rest of the line
                            _ = stdout_writer.writeAll(input.items[cursor_index - 1 ..]) catch {};
                            // Move cursor back to its correct position
                            if (input.items.len > cursor_index) {
                                _ = stdout_writer.print("\x1b[{d}D", .{input.items.len - cursor_index}) catch {};
                            }
                            bun.Output.flush();
                        },
                    }
                }
            }
        }

        // Fallback for non-interactive terminals (or Windows)
        const reader = bun.Output.buffered_stdin.reader();
        var second_byte: ?u8 = null;
        const first_byte = reader.readByte() catch {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return .null;
        };

        if (first_byte == '\n') {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return default;
        } else if (first_byte == '\r') {
            const second = reader.readByte() catch return .null;
            second_byte = second;
            if (second == '\n') return default;
        }

        var input = std.ArrayList(u8).initCapacity(allocator, 2048) catch {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return .null;
        };
        defer input.deinit();

        input.appendAssumeCapacity(first_byte);
        if (second_byte) |second| input.appendAssumeCapacity(second);

        // All of this code basically just first tries to load the input into a
        // buffer of size 2048. If that is too small, then increase the buffer
        // size to 4096. If that is too small, then just dynamically allocate
        // the rest.
        readUntilDelimiterArrayListAppendAssumeCapacity(reader, &input, '\n', 2048) catch |e| {
            if (e != error.StreamTooLong) {
                // 8. Let result be null if the user aborts, or otherwise the string
                //    that the user responded with.
                return .null;
            }

            input.ensureTotalCapacity(4096) catch {
                // 8. Let result be null if the user aborts, or otherwise the string
                //    that the user responded with.
                return .null;
            };

            readUntilDelimiterArrayListAppendAssumeCapacity(reader, &input, '\n', 4096) catch |e2| {
                if (e2 != error.StreamTooLong) {
                    // 8. Let result be null if the user aborts, or otherwise the string
                    //    that the user responded with.
                    return .null;
                }

                readUntilDelimiterArrayListInfinity(reader, &input, '\n') catch {
                    // 8. Let result be null if the user aborts, or otherwise the string
                    //    that the user responded with.
                    return .null;
                };
            };
        };

        if (input.items.len > 0 and input.items[input.items.len - 1] == '\r') {
            input.items.len -= 1;
        }

        if (comptime Environment.allow_assert) {
            bun.assert(input.items.len > 0);
            bun.assert(input.items[input.items.len - 1] != '\r');
        }

        // 8. Let result be null if the user aborts, or otherwise the string
        //    that the user responded with.
        var result = jsc.ZigString.init(input.items);
        result.markUTF8();

        // 9. Invoke WebDriver BiDi user prompt closed with this, false if
        //    result is null or true otherwise, and result.
        // *  Too complex for server context.

        // 9. Return result.
        return result.toJS(globalObject);
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const c = bun.c;
const jsc = bun.jsc;
