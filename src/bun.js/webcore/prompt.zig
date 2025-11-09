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
    var stdin = std.fs.File.stdin();
    var stdin_buf: [1]u8 = undefined;
    var stdin_reader = stdin.readerStreaming(&stdin_buf);
    const reader = &stdin_reader.interface;
    while (true) {
        const byte = reader.takeByte() catch break;
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
    var stdin = std.fs.File.stdin();
    var stdin_buf: [1024]u8 = undefined;
    var stdin_reader = stdin.readerStreaming(&stdin_buf);
    const reader = &stdin_reader.interface;

    const first_byte = reader.takeByte() catch {
        return .false;
    };

    // 7. Invoke WebDriver BiDi user prompt closed with this, and true if
    //    the user responded positively or false otherwise.
    // *  Not relevant in a server context.

    switch (first_byte) {
        '\n' => return .false,
        '\r' => {
            const next_byte = reader.takeByte() catch {
                // They may have said yes, but the stdin is invalid.
                return .false;
            };
            if (next_byte == '\n') {
                return .false;
            }
        },
        'y', 'Y' => {
            const next_byte = reader.takeByte() catch {
                // They may have said yes, but the stdin is invalid.

                return .false;
            };

            if (next_byte == '\n') {
                // 8. If the user responded positively, return true;
                //    otherwise, the user responded negatively: return false.
                return .true;
            } else if (next_byte == '\r') {
                //Check Windows style
                const second_byte = reader.takeByte() catch {
                    return .false;
                };
                if (second_byte == '\n') {
                    return .true;
                }
            }
        },
        else => {},
    }

    while (reader.takeByte()) |b| {
        if (b == '\n' or b == '\r') break;
    } else |_| {}

    // 8. If the user responded positively, return true; otherwise, the user
    //    responded negatively: return false.
    return .false;
}

pub const prompt = struct {
    const KEY_CTRL_C = 3;
    const KEY_CTRL_D = 4;
    const KEY_BACKSPACE = 8;
    const KEY_TAB = 9;
    const KEY_ENTER = 13;
    const KEY_ESC = 27;
    const KEY_DEL = 127;

    fn handleBackspace(input: *std.ArrayList(u8), cursor_index: *usize) void {
        if (cursor_index.* > 0) {
            const old_cursor_index = cursor_index.*;
            const prev_codepoint_start = utf8Prev(input.items, old_cursor_index);

            if (prev_codepoint_start) |start| {
                var i: usize = 0;
                while (i < old_cursor_index - start) : (i += 1) {
                    _ = input.orderedRemove(start);
                }
                cursor_index.* = start;
            } else {
                _ = input.orderedRemove(old_cursor_index - 1);
                cursor_index.* -= 1;
            }
        }
    }

    fn utf8Prev(slice: []const u8, index: usize) ?usize {
        if (index == 0) return null;
        var i = index - 1;
        // Search backward for the start byte of a codepoint.
        // A continuation byte starts with 0b10xxxxxx.
        while (i > 0 and (slice[i] & 0b11000000) == 0b10000000) {
            i -= 1;
        }
        // If we found a start byte, return its index.
        // This handles ASCII (0xxxxxxx) and multibyte start bytes (11xxxxxx).
        // If we stopped at 0, it's either a valid start byte or an invalid continuation byte.
        // We return i, and the caller's logic will handle the deletion.
        return i;
    }

    fn utf8Next(slice: []const u8, index: usize) ?usize {
        if (index >= slice.len) return null;
        // Use the project's internal function to get the byte length of the codepoint.
        const len = bun.strings.utf8ByteSequenceLength(slice[index]);
        const next_index = index + len;
        if (next_index > slice.len) return null;
        return next_index;
    }

    fn fullRedraw(stdout_writer: anytype, input: *std.ArrayList(u8), cursor_index: usize, prompt_width: usize) !void {
        // 1. Move cursor to the start of the input area using absolute positioning (column prompt_width + 1).
        _ = stdout_writer.print("\x1b[{d}G", .{prompt_width + 1}) catch {};

        // 2. Write the entire input buffer, expanding tabs to spaces to ensure correct alignment.
        var i: usize = 0;
        var current_column = prompt_width;
        while (i < input.items.len) {
            const char = input.items[i];
            if (char == '\t') {
                const tab_width = 8;
                const next_tab_stop = ((current_column / tab_width) + 1) * tab_width;
                const spaces_to_add = next_tab_stop - current_column;
                var j: usize = 0;
                while (j < spaces_to_add) : (j += 1) {
                    _ = stdout_writer.writeByte(' ') catch {};
                }
                current_column = next_tab_stop;
                i += 1;
            } else {
                const codepoint_slice = input.items[i..];
                const next_codepoint_start = utf8Next(codepoint_slice, 0);
                const codepoint_len = next_codepoint_start orelse 1;
                const char_width = columnWidth(codepoint_slice[0..codepoint_len]);

                _ = stdout_writer.writeAll(codepoint_slice[0..codepoint_len]) catch {};

                current_column += char_width;
                i += codepoint_len;
            }
        }

        // 3. Clear the rest of the line.
        _ = stdout_writer.writeAll("\x1b[K") catch {};

        // 4. Move cursor to the correct column position using absolute positioning.
        const new_column_width = columnPosition(input.items, cursor_index, prompt_width);
        _ = stdout_writer.print("\x1b[{d}G", .{prompt_width + new_column_width + 1}) catch {};

        bun.Output.flush();
    }

    fn calculateColumn(slice: []const u8, byte_index: usize, start_column: usize) usize {
        var column: usize = start_column;
        var i: usize = 0;
        while (i < byte_index) {
            const char = slice[i];
            if (char == '\t') {
                // Align to next tab stop (multiple of 8)
                const tab_width = 8;
                column = ((column / tab_width) + 1) * tab_width;
                i += 1;
            } else {
                // Use the project's visible width function for other characters
                const codepoint_slice = slice[i..];
                const next_codepoint_start = utf8Next(codepoint_slice, 0);
                const codepoint_len = next_codepoint_start orelse 1;
                const char_width = columnWidth(codepoint_slice[0..codepoint_len]);

                column += char_width;
                i += codepoint_len;
            }
        }
        return column;
    }

    fn columnPosition(slice: []const u8, byte_index: usize, start_column: usize) usize {
        return calculateColumn(slice, byte_index, start_column) - start_column;
    }

    fn columnWidth(slice: []const u8) usize {
        return bun.strings.visible.width.utf8(slice);
    }

    /// Adapted from `std.io.Reader.readUntilDelimiterArrayList` to only append
    /// and assume capacity.
    pub fn readUntilDelimiterArrayListAppendAssumeCapacity(
        reader: anytype,
        array_list: *std.array_list.Managed(u8),
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
        array_list: *std.array_list.Managed(u8),
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
                var pending_sigint: bool = false;
                if (c_termios.tcgetattr(bun.FD.stdin().native(), &original_termios) != 0) {
                    return .null;
                }

                defer {
                    _ = c_termios.tcsetattr(bun.FD.stdin().native(), c_termios.TCSADRAIN, &original_termios);
                    // Move cursor to next line after input is done
                    _ = bun.Output.writer().writeAll("\n") catch {};
                    bun.Output.flush();
                    if (pending_sigint) {
                        _ = c_termios.raise(c_termios.SIGINT);
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
                var prompt_width: usize = 0;

                // Calculate prompt width for redraws
                if (has_message) {
                    const message = try arguments[0].toSlice(globalObject, allocator);
                    defer message.deinit();
                    prompt_width += columnWidth(message.slice());
                }
                prompt_width += columnWidth(if (has_message) " " else "Prompt ");

                if (has_default) {
                    const default_string = try arguments[1].toSlice(globalObject, allocator);
                    defer default_string.deinit();

                    prompt_width += columnWidth("[") + columnWidth(default_string.slice()) + columnWidth("] ");
                }

                const reader = bun.Output.buffered_stdin.reader();
                const stdout_writer = bun.Output.writer();

                while (true) {
                    const byte = reader.readByte() catch {
                        // Real I/O error or EOF from upstream (not user EOT)
                        return .null;
                    };

                    switch (byte) {
                        KEY_TAB => {
                            try input.insert(cursor_index, byte);
                            cursor_index += 1;
                        },

                        // End of input
                        '\n', KEY_ENTER => {
                            if (input.items.len == 0 and !has_default) return jsc.ZigString.init("").toJS(globalObject);
                            if (input.items.len == 0) return default;

                            var result = jsc.ZigString.init(input.items);
                            result.markUTF8();
                            return result.toJS(globalObject);
                        },

                        // Backspace
                        KEY_BACKSPACE, KEY_DEL => handleBackspace(&input, &cursor_index),

                        // Ctrl+C
                        KEY_CTRL_C => {
                            // This will trigger the defer and restore terminal settings
                            pending_sigint = true;
                            return .null;
                        },

                        // Escape sequence (e.g., arrow keys, alt+backspace)
                        KEY_ESC => block: {
                            const byte2 = reader.readByte() catch break :block;

                            // Alt+Backspace -> treat as regular backspace
                            if (byte2 == KEY_DEL or byte2 == KEY_BACKSPACE) {
                                handleBackspace(&input, &cursor_index);
                                break :block; // Exit escape sequence handler to allow redraw
                            }

                            // Standard escape sequence (e.g., arrow keys)
                            if (byte2 != '[') {
                                break :block;
                            }

                            var final_byte = reader.readByte() catch break :block;

                            // Check for complex sequence (e.g., ESC [ 3 ~ or ESC [ 1 ; 5 D)
                            if (final_byte >= '0' and final_byte <= '9') {
                                // Consume parameters until the final command byte
                                while (true) {
                                    const peek = reader.readByte() catch break;
                                    if ((peek >= 'A' and peek <= 'Z') or peek == '~') {
                                        final_byte = peek;
                                        break;
                                    }
                                }
                            }

                            switch (final_byte) {
                                'D' => { // Left arrow
                                    if (cursor_index > 0) {
                                        cursor_index = utf8Prev(input.items, cursor_index) orelse cursor_index - 1;
                                    }
                                },
                                'C' => { // Right arrow
                                    if (cursor_index < input.items.len) {
                                        cursor_index = utf8Next(input.items, cursor_index) orelse cursor_index + 1;
                                    }
                                },
                                'H' => { // Home
                                    cursor_index = 0;
                                },
                                'F' => { // End
                                    cursor_index = input.items.len;
                                },
                                '~' => { // Handles Delete (e.g. ESC [ 3 ~)
                                    if (cursor_index < input.items.len) {
                                        const next_codepoint_start = utf8Next(input.items, cursor_index);

                                        if (next_codepoint_start) |end| {
                                            var i: usize = 0;
                                            while (i < end - cursor_index) : (i += 1) {
                                                _ = input.orderedRemove(cursor_index);
                                            }
                                        } else {
                                            // Fallback: delete one byte if invalid UTF-8
                                            _ = input.orderedRemove(cursor_index);
                                        }
                                    }
                                },
                                else => {},
                            }
                        },

                        // Ctrl+D (EOT)
                        KEY_CTRL_D => {
                            return .null;
                        },

                        else => {
                            try input.insert(cursor_index, byte);
                            cursor_index += 1;
                        },
                    }
                    try fullRedraw(stdout_writer, &input, cursor_index, prompt_width);
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

        var input = std.array_list.Managed(u8).initCapacity(allocator, 2048) catch {
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
