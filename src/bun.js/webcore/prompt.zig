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
    /// Helper to set or unset O_NONBLOCK flag on a file descriptor.
    fn setBlocking(fd_native: std.posix.fd_t, block: bool) !void {
        const fd = bun.FD.fromNative(fd_native);
        const flags = try bun.sys.fcntl(fd, std.posix.F.GETFL, 0).unwrap();
        var new_flags = flags;
        if (block) {
            new_flags &= ~@as(@TypeOf(flags), bun.O.NONBLOCK);
        } else {
            new_flags |= bun.O.NONBLOCK;
        }
        _ = try bun.sys.fcntl(fd, std.posix.F.SETFL, new_flags).unwrap();
    }

    fn handleBackspace(input: *std.ArrayList(u8), cursor_index: *usize) void {
        if (cursor_index.* > 0) {
            const old_cursor_index = cursor_index.*;
            const prev_codepoint_start = utf8Prev(input.items, old_cursor_index);

            const start = prev_codepoint_start.?;
            var i: usize = 0;
            while (i < old_cursor_index - start) : (i += 1) {
                _ = input.orderedRemove(start);
            }
            cursor_index.* = start;
        }
    }

    fn utf8Prev(slice: []const u8, index: usize) ?usize {
        if (index == 0) return null;
        var i = index - 1;
        // Search backward for the start byte of a codepoint, or the beginning of the string.
        // A continuation byte starts with 0b10xxxxxx.
        while (i > 0 and (slice[i] & 0b11000000) == 0b10000000) {
            i -= 1;
        }
        return i;
    }

    fn utf8Next(slice: []const u8, index: usize) ?usize {
        if (index >= slice.len) return null;
        // Get the byte length of the codepoint at `index`.
        const len = bun.strings.utf8ByteSequenceLength(slice[index]);
        const next_index = index + len;
        if (next_index > slice.len) return null;
        return next_index;
    }

    fn getTerminalWidth() usize {
        var w: std.c.winsize = undefined;
        // Query terminal size using ioctl.
        if (std.c.ioctl(bun.FD.stdout().native(), std.c.T.IOCGWINSZ, &w) == 0) {
            if (w.col > 0) {
                return w.col;
            }
        }
        return 80; // Default width if ioctl fails or reports invalid width
    }

    /// Calculates the row and column position of a `byte_index` within a `slice`,
    /// accounting for terminal wrapping and tab characters.
    fn calculateWrappedPosition(slice: []const u8, byte_index: usize, start_column: usize, terminal_width: usize) struct { row: usize, col: usize } {
        var row: usize = 0;
        var col: usize = start_column;
        var i: usize = 0;
        while (i < byte_index) {
            const char = slice[i];
            if (char == '\t') {
                const tab_width = 8;
                const next_tab_stop = ((col / tab_width) + 1) * tab_width;
                const spaces_to_add = next_tab_stop - col;
                if (col + spaces_to_add > terminal_width) {
                    row += 1;
                    col = spaces_to_add;
                } else {
                    col += spaces_to_add;
                }
                i += 1;
            } else {
                const codepoint_slice = slice[i..];
                const next_codepoint_start = utf8Next(codepoint_slice, 0);
                const codepoint_len = next_codepoint_start orelse 1; // Default to 1 byte if invalid UTF-8
                const char_width = columnWidth(codepoint_slice[0..codepoint_len]);

                if (col + char_width > terminal_width) {
                    row += 1;
                    col = char_width;
                } else {
                    col += char_width;
                }
                i += codepoint_len;
            }
        }
        return .{ .row = row, .col = col };
    }

    /// Redraws the entire prompt and input line, handling cursor positioning and line wrapping.
    /// This function ensures the terminal display correctly reflects the current input state.
    fn fullRedraw(
        stdout_writer: anytype,
        input: *std.ArrayList(u8),
        cursor_index: usize,
        prompt_width: usize,
        last_cursor_row: *usize,
    ) !void {
        const terminal_width = getTerminalWidth();

        // Calculate future positions of the end of the text and the cursor.
        const end_pos = calculateWrappedPosition(input.items, input.items.len, prompt_width, terminal_width);
        const cursor_pos = calculateWrappedPosition(input.items, cursor_index, prompt_width, terminal_width);

        // Move cursor up to the original prompt line.
        if (last_cursor_row.* > 0) {
            try stdout_writer.print("\x1b[{d}A", .{last_cursor_row.*});
        }
        try stdout_writer.writeAll("\r"); // Move to column 0

        // Create space for new lines if the input has wrapped.
        var r: usize = 0;
        while (r < end_pos.row) : (r += 1) {
            try stdout_writer.writeAll("\n");
        }
        // Move cursor back up to the starting line for drawing.
        if (end_pos.row > 0) {
            try stdout_writer.print("\x1b[{d}A", .{end_pos.row});
        }

        // Clear the current line from prompt start and everything below it.
        try stdout_writer.print("\x1b[{d}G", .{prompt_width + 1});
        try stdout_writer.writeAll("\x1b[J"); // Clear from cursor to end of screen

        var i: usize = 0;
        var current_column = prompt_width;
        while (i < input.items.len) {
            const char = input.items[i];
            if (char == '\t') {
                const tab_width = 8;
                const next_tab_stop = ((current_column / tab_width) + 1) * tab_width;
                const spaces_to_add = next_tab_stop - current_column;

                if (current_column + spaces_to_add > terminal_width) {
                    try stdout_writer.writeAll("\r\n");
                    current_column = 0;
                }

                var j: usize = 0;
                while (j < spaces_to_add) : (j += 1) {
                    _ = try stdout_writer.writeByte(' ');
                }
                current_column += spaces_to_add;
                i += 1;
            } else {
                const codepoint_slice = input.items[i..];
                const next_codepoint_start = utf8Next(codepoint_slice, 0);
                const codepoint_len = next_codepoint_start orelse 1;
                const char_width = columnWidth(codepoint_slice[0..codepoint_len]);

                if (current_column + char_width > terminal_width) {
                    try stdout_writer.writeAll("\r\n");
                    current_column = 0;
                }
                _ = try stdout_writer.writeAll(codepoint_slice[0..codepoint_len]);
                current_column += char_width;
                i += codepoint_len;
            }
        }

        // Update the last known cursor row for the next redraw.
        last_cursor_row.* = cursor_pos.row;

        // Position the cursor at its final target position.
        // First move up to the origin, then down to the target row and column.
        if (end_pos.row > 0) {
            try stdout_writer.print("\x1b[{d}A", .{end_pos.row});
        }
        try stdout_writer.writeAll("\r"); // Move to column 0

        if (cursor_pos.row > 0) {
            try stdout_writer.print("\x1b[{d}B", .{cursor_pos.row});
        }
        try stdout_writer.print("\x1b[{d}G", .{cursor_pos.col + 1});

        bun.Output.flush();
    }

    /// Calculates the column position of a `byte_index` within a `slice`,
    /// without accounting for terminal wrapping.
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

    /// Determines the visible width of a UTF-8 slice in terminal columns.
    fn columnWidth(slice: []const u8) usize {
        return bun.strings.visible.width.utf8(slice);
    }

    /// Reads bytes from a reader into an ArrayList until a delimiter is found or max_size is reached.
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

    /// Reads bytes from a reader into an ArrayList until a delimiter is found, dynamically resizing the list.
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

    extern fn Bun__ttySetMode(fd: i32, mode: i32) i32;

    /// Implements the `prompt` Web API, providing an interactive TTY input
    /// with editing capabilities or falling back to a simple line reader.
    /// https://html.spec.whatwg.org/multipage/timers-and-user-prompts.html#dom-prompt
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
        const default_value = if (has_default) arguments[1] else .null;

        var message_slice: []const u8 = undefined;
        if (has_message) {
            const message = try arguments[0].toSlice(globalObject, allocator);
            defer message.deinit();
            message_slice = message.slice();

            output.writeAll(message_slice) catch {
                return .null; // Failed to show message
            };
        }

        output.writeAll(if (has_message) " " else "Prompt ") catch {
            return .null; // Failed to show prompt
        };

        var default_string_slice: []const u8 = undefined;
        if (has_default) {
            const default_string = try arguments[1].toSlice(globalObject, allocator);
            defer default_string.deinit();
            default_string_slice = default_string.slice();

            output.print("[{s}] ", .{default_string_slice}) catch {
                return .null; // Failed to show default value
            };
        }

        bun.Output.flush();

        // On Windows, unset `ENABLE_VIRTUAL_TERMINAL_INPUT` to prevent backspace from deleting the entire line.
        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.windows.updateStdioModeFlags(.std_in, .{ .unset = c.ENABLE_VIRTUAL_TERMINAL_INPUT }) catch null;

        defer if (comptime Environment.isWindows) {
            if (original_mode) |mode| {
                _ = bun.c.SetConsoleMode(bun.FD.stdin().native(), mode);
            }
        };

        // Handle interactive TTY input for non-Windows systems.
        if ((comptime !Environment.isWindows) and bun.c.isatty(bun.FD.stdin().native()) == 1 and bun.c.isatty(bun.FD.stdout().native()) == 1) {
            const original_ttymode = Bun__ttySetMode(bun.FD.stdin().native(), 1);
            const stdin_fd = bun.FD.stdin().native();

            const LoopResult = enum {
                InputLine,
                Cancelled, // Ctrl+C, Ctrl+D, or I/O error
                Error,
            };
            var loop_result: LoopResult = .Error; // Default to Error

            var pending_sigint = false;

            var input = std.ArrayList(u8).init(allocator);
            defer input.deinit();
            var cursor_index: usize = 0;
            var prompt_width: usize = 0;
            var last_cursor_row: usize = 0;

            // Calculate initial prompt width.
            if (has_message) {
                prompt_width += columnWidth(message_slice);
            }
            prompt_width += columnWidth(if (has_message) " " else "Prompt ");

            if (has_default) {
                prompt_width += columnWidth("[") + columnWidth(default_string_slice) + columnWidth("] ");
            }

            // Deferred cleanup: restore terminal settings and print a newline.
            defer {
                _ = Bun__ttySetMode(stdin_fd, original_ttymode);
                _ = bun.Output.writer().writeAll("\n") catch {};
                bun.Output.flush();
                if (pending_sigint) {
                    _ = std.c.kill(std.c.getpid(), std.posix.SIG.INT);
                }
            }

            const reader = bun.Output.buffered_stdin.reader();
            const stdout_writer = bun.Output.writer();

            // Main input loop for interactive TTY.
            while (true) {
                const first_byte = reader.readByte() catch {
                    loop_result = .Cancelled; // Treat I/O error as cancellation (EOF)
                    break;
                };

                // Handle terminal exit control codes.
                switch (first_byte) {
                    std.ascii.control_code.lf, std.ascii.control_code.cr => {
                        loop_result = .InputLine;
                        break;
                    },
                    std.ascii.control_code.etx => { // Ctrl+C
                        pending_sigint = true;
                        loop_result = .Cancelled;
                        break;
                    },
                    std.ascii.control_code.eot => { // Ctrl+D (EOT)
                        loop_result = .Cancelled;
                        break;
                    },
                    else => {},
                }

                // Process escape sequences or batch pasted input.
                if (first_byte == std.ascii.control_code.esc) {
                    block: {
                        const byte2 = reader.readByte() catch break :block;

                        // Alt+Backspace check
                        if (byte2 == std.ascii.control_code.del or byte2 == std.ascii.control_code.bs) {
                            handleBackspace(&input, &cursor_index);
                            break :block;
                        }

                        // Standard escape sequence (e.g., arrow keys)
                        if (byte2 != '[') {
                            break :block;
                        }

                        var final_byte = reader.readByte() catch break :block;

                        // Consume parameters until the final command byte.
                        if (final_byte >= '0' and final_byte <= '9') {
                            while (true) {
                                const peek = reader.readByte() catch break;
                                if ((peek >= 'A' and peek <= 'Z') or peek == '~') {
                                    final_byte = peek;
                                    break;
                                }
                            }
                        }

                        // Execute the action (e.g., 'D' for Left arrow, 'C' for Right arrow).
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
                            'H' => cursor_index = 0, // Home
                            'F' => cursor_index = input.items.len, // End
                            '~' => { // Delete (e.g., ESC [ 3 ~)
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
                    }
                } else {
                    // Handle batch paste by temporarily setting stdin to non-blocking mode.
                    var batch = std.ArrayList(u8).init(allocator);
                    try batch.append(first_byte);

                    batch_read_block: {
                        if (setBlocking(stdin_fd, false)) {
                            // Successfully set non-blocking mode
                        } else |_| {
                            // Handle error from setBlocking
                            loop_result = .Error;
                            break :batch_read_block;
                        }
                        defer setBlocking(stdin_fd, true) catch {};

                        while (true) {
                            const next_byte = reader.readByte() catch |err| {
                                if (err == error.WouldBlock or err == error.FileBusy) {
                                    break; // Batch paste complete
                                }
                                loop_result = .Error; // Propagate I/O error
                                break :batch_read_block;
                            };
                            try batch.append(next_byte);
                        }
                    }

                    // Process the entire batch of input bytes.
                    for (batch.items) |b| {
                        switch (b) {
                            std.ascii.control_code.ht => {
                                try input.insert(cursor_index, b);
                                cursor_index += 1;
                            },
                            // Check for exit control codes that might be part of a paste.
                            std.ascii.control_code.lf, std.ascii.control_code.cr => {
                                loop_result = .InputLine;
                                break; // Exit batch and main loop
                            },
                            std.ascii.control_code.bs, std.ascii.control_code.del => handleBackspace(&input, &cursor_index),

                            // Handle standard printable characters and UTF-8 bytes.
                            else => {
                                try input.insert(cursor_index, b);
                                cursor_index += 1;
                            },
                        }
                    }
                    batch.deinit();

                    if (loop_result == .InputLine) {
                        break; // Exit main loop if a line-end was found in the batch
                    }
                }

                // Redraw the terminal once after processing input.
                fullRedraw(stdout_writer, &input, cursor_index, prompt_width, &last_cursor_row) catch {
                    loop_result = .Error;
                    break;
                };
            } // End of while (true)

            // Determine and return the final value based on loop result.
            return switch (loop_result) {
                .InputLine => {
                    if (input.items.len == 0 and !has_default) return bun.String.empty.toJS(globalObject);
                    if (input.items.len == 0) return default_value;
                    return bun.String.createUTF8ForJS(globalObject, input.items);
                },
                .Cancelled, .Error => .null,
            };
        }

        // Fallback for non-interactive terminals (or Windows).
        const reader = bun.Output.buffered_stdin.reader();
        var second_byte: ?u8 = null;
        const first_byte = reader.readByte() catch {
            return .null; // I/O error or EOF
        };

        if (first_byte == '\n') {
            if (!has_default) return bun.String.empty.toJS(globalObject);
            return default_value;
        } else if (first_byte == '\r') {
            const second = reader.readByte() catch return .null;
            second_byte = second;
            if (second == '\n') {
                if (!has_default) return bun.String.empty.toJS(globalObject);
                return default_value;
            }
        }

        var input = std.array_list.Managed(u8).initCapacity(allocator, 2048) catch {
        var input = std.ArrayList(u8).initCapacity(allocator, 2048) catch {
            // 8. Let result be null if the user aborts, or otherwise the string
            //    that the user responded with.
            return .null;
            return .null; // Out of memory
        };
        defer input.deinit();

        input.appendAssumeCapacity(first_byte);
        if (second_byte) |second| input.appendAssumeCapacity(second);

        // Read the rest of the line, handling potential buffer overflows by resizing.
        readUntilDelimiterArrayListAppendAssumeCapacity(reader, &input, '\n', 2048) catch |e| {
            if (e != error.StreamTooLong) {
                return .null; // I/O error
            }

            input.ensureTotalCapacity(4096) catch {
                return .null; // Out of memory
            };

            readUntilDelimiterArrayListAppendAssumeCapacity(reader, &input, '\n', 4096) catch |e2| {
                if (e2 != error.StreamTooLong) {
                    return .null; // I/O error
                }

                readUntilDelimiterArrayListInfinity(reader, &input, '\n') catch {
                    return .null; // I/O error
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

        return bun.String.createUTF8ForJS(globalObject, input.items);
    }
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const c = bun.c;
const jsc = bun.jsc;
