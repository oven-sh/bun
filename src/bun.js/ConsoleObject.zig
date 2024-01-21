const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const Output = bun.Output;
const ConsoleObject = @This();
const Shimmer = @import("./bindings/shimmer.zig").Shimmer;
const String = bun.String;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const strings = bun.strings;
const is_bindgen = JSC.is_bindgen;
const ZigException = JSC.ZigException;
const ZigString = JSC.ZigString;
const VirtualMachine = JSC.VirtualMachine;
const string = bun.string;
const JSLexer = bun.js_lexer;
const ScriptArguments = opaque {};
const JSPrinter = bun.js_printer;
const Environment = bun.Environment;
const default_allocator = bun.default_allocator;
const JestPrettyFormat = @import("./test/pretty_format.zig").JestPrettyFormat;
const JSPromise = JSC.JSPromise;
const EventType = JSC.EventType;

pub const shim = Shimmer("Bun", "ConsoleObject", @This());
pub const Type = *anyopaque;
pub const name = "Bun::ConsoleObject";
pub const include = "\"ConsoleObject.h\"";
pub const namespace = shim.namespace;
const Counter = std.AutoHashMapUnmanaged(u64, u32);

const BufferedWriter = std.io.BufferedWriter(4096, Output.WriterType);
error_writer: BufferedWriter,
writer: BufferedWriter,

counts: Counter = .{},

pub fn init(error_writer: Output.WriterType, writer: Output.WriterType) ConsoleObject {
    return ConsoleObject{
        .error_writer = BufferedWriter{ .unbuffered_writer = error_writer },
        .writer = BufferedWriter{ .unbuffered_writer = writer },
    };
}

pub const MessageLevel = enum(u32) {
    Log = 0,
    Warning = 1,
    Error = 2,
    Debug = 3,
    Info = 4,
    _,
};

pub const MessageType = enum(u32) {
    Log = 0,
    Dir = 1,
    DirXML = 2,
    Table = 3,
    Trace = 4,
    StartGroup = 5,
    StartGroupCollapsed = 6,
    EndGroup = 7,
    Clear = 8,
    Assert = 9,
    Timing = 10,
    Profile = 11,
    ProfileEnd = 12,
    Image = 13,
    _,
};

var stderr_mutex: bun.Lock = bun.Lock.init();
var stdout_mutex: bun.Lock = bun.Lock.init();

threadlocal var stderr_lock_count: u16 = 0;
threadlocal var stdout_lock_count: u16 = 0;

/// https://console.spec.whatwg.org/#formatter
pub fn messageWithTypeAndLevel(
    //console_: ConsoleObject.Type,
    _: ConsoleObject.Type,
    message_type: MessageType,
    //message_level: u32,
    level: MessageLevel,
    global: *JSGlobalObject,
    vals: [*]JSValue,
    len: usize,
) callconv(.C) void {
    if (comptime is_bindgen) {
        return;
    }

    var console = global.bunVM().console;

    // Lock/unlock a mutex incase two JS threads are console.log'ing at the same time
    // We do this the slightly annoying way to avoid assigning a pointer
    if (level == .Warning or level == .Error or message_type == .Assert) {
        if (stderr_lock_count == 0) {
            stderr_mutex.lock();
        }

        stderr_lock_count += 1;
    } else {
        if (stdout_lock_count == 0) {
            stdout_mutex.lock();
        }

        stdout_lock_count += 1;
    }

    defer {
        if (level == .Warning or level == .Error or message_type == .Assert) {
            stderr_lock_count -= 1;

            if (stderr_lock_count == 0) {
                stderr_mutex.unlock();
            }
        } else {
            stdout_lock_count -= 1;

            if (stdout_lock_count == 0) {
                stdout_mutex.unlock();
            }
        }
    }

    if (message_type == .Clear) {
        Output.resetTerminal();
        return;
    }

    if (message_type == .Assert and len == 0) {
        const text = if (Output.enable_ansi_colors_stderr)
            Output.prettyFmt("<r><red>Assertion failed<r>\n", true)
        else
            "Assertion failed\n";
        console.error_writer.unbuffered_writer.writeAll(text) catch {};
        return;
    }

    const enable_colors = if (level == .Warning or level == .Error)
        Output.enable_ansi_colors_stderr
    else
        Output.enable_ansi_colors_stdout;

    var buffered_writer = if (level == .Warning or level == .Error)
        &console.error_writer
    else
        &console.writer;
    var writer = buffered_writer.writer();
    const Writer = @TypeOf(writer);

    var print_length = len;
    var print_options: FormatOptions = .{
        .enable_colors = enable_colors,
        .add_newline = true,
        .flush = true,
    };

    if (message_type == .Table and len >= 1) {
        // if value is not an object/array/iterable, don't print a table and just print it
        var tabular_data = vals[0];
        if (tabular_data.isObject()) {
            const properties = if (len >= 2 and vals[1].jsType().isArray()) vals[1] else JSValue.undefined;
            var table_printer = TablePrinter.init(
                global,
                level,
                tabular_data,
                properties,
            );

            switch (enable_colors) {
                inline else => |colors| table_printer.printTable(Writer, writer, colors) catch return,
            }
            buffered_writer.flush() catch {};
            return;
        }
    }

    if (message_type == .Dir and len >= 2) {
        print_length = 1;
        var opts = vals[1];
        if (opts.isObject()) {
            if (opts.get(global, "depth")) |depth_prop| {
                if (depth_prop.isInt32() or depth_prop.isNumber() or depth_prop.isBigInt())
                    print_options.max_depth = depth_prop.toU16()
                else if (depth_prop.isNull())
                    print_options.max_depth = std.math.maxInt(u16);
            }
            if (opts.get(global, "colors")) |colors_prop| {
                if (colors_prop.isBoolean())
                    print_options.enable_colors = colors_prop.toBoolean();
            }
        }
    }

    if (print_length > 0)
        format(
            level,
            global,
            vals,
            print_length,
            @TypeOf(buffered_writer.unbuffered_writer.context),
            Writer,
            writer,
            print_options,
        )
    else if (message_type == .Log) {
        _ = console.writer.write("\n") catch 0;
        console.writer.flush() catch {};
    } else if (message_type != .Trace)
        writer.writeAll("undefined\n") catch {};

    if (message_type == .Trace) {
        writeTrace(Writer, writer, global);
        buffered_writer.flush() catch {};
    }
}

const TablePrinter = struct {
    const Column = struct {
        name: String,
        width: u32 = 1,
    };

    const RowKey = union(@This().Type) {
        str: String,
        num: u32,

        const Type = enum { str, num };
    };

    const PADDING = 1;

    globalObject: *JSGlobalObject,
    level: MessageLevel,
    value_formatter: ConsoleObject.Formatter,

    tabular_data: JSValue,
    properties: JSValue,

    is_iterable: bool,
    jstype: JSValue.JSType,

    /// width of the "Values" column.
    /// This column is not appended to "columns" from the start, because it needs to be the last column.
    values_col_width: ?u32 = null,

    values_col_idx: usize = std.math.maxInt(usize),

    pub fn init(
        globalObject: *JSGlobalObject,
        level: MessageLevel,
        tabular_data: JSValue,
        properties: JSValue,
    ) TablePrinter {
        return TablePrinter{
            .level = level,
            .globalObject = globalObject,
            .tabular_data = tabular_data,
            .properties = properties,
            .is_iterable = tabular_data.isIterable(globalObject),
            .jstype = tabular_data.jsType(),
            .value_formatter = ConsoleObject.Formatter{
                .remaining_values = &[_]JSValue{},
                .globalThis = globalObject,
                .ordered_properties = false,
                .quote_strings = false,
                .single_line = true,
                .max_depth = 5,
            },
        };
    }

    const VisibleCharacterCounter = struct {
        width: *usize = undefined,

        pub const WriteError = error{};

        pub const Writer = std.io.Writer(
            VisibleCharacterCounter,
            VisibleCharacterCounter.WriteError,
            VisibleCharacterCounter.write,
        );

        pub fn write(this: VisibleCharacterCounter, bytes: []const u8) WriteError!usize {
            this.width.* += strings.visible.width.exclude_ansi_colors.utf8(bytes);
            return bytes.len;
        }

        pub fn writeAll(this: VisibleCharacterCounter, bytes: []const u8) WriteError!void {
            this.width.* += strings.width.exclude_ansi_colors.utf8(bytes);
        }
    };

    /// Compute how much horizontal space will take a JSValue when printed
    fn getWidthForValue(this: *TablePrinter, value: JSValue) u32 {
        var width: usize = 0;
        var value_formatter = this.value_formatter;

        const tag = ConsoleObject.Formatter.Tag.get(value, this.globalObject);
        value_formatter.quote_strings = !(tag.tag == .String or tag.tag == .StringPossiblyFormatted);
        value_formatter.format(
            tag,
            VisibleCharacterCounter.Writer,
            VisibleCharacterCounter.Writer{
                .context = .{
                    .width = &width,
                },
            },
            value,
            this.globalObject,
            false,
        );

        return @truncate(width);
    }

    /// Update the sizes of the columns for the values of a given row, and create any additional columns as needed
    fn updateColumnsForRow(this: *TablePrinter, columns: *std.ArrayList(Column), row_key: RowKey, row_value: JSValue) !void {
        // update size of "(index)" column
        const row_key_len: u32 = switch (row_key) {
            .str => |value| @intCast(value.visibleWidthExcludeANSIColors()),
            .num => |value| @truncate(bun.fmt.fastDigitCount(value)),
        };
        columns.items[0].width = @max(columns.items[0].width, row_key_len);

        // special handling for Map: column with idx=1 is "Keys"
        if (this.jstype.isMap()) {
            const entry_key = row_value.getIndex(this.globalObject, 0);
            const entry_value = row_value.getIndex(this.globalObject, 1);
            columns.items[1].width = @max(columns.items[1].width, this.getWidthForValue(entry_key));
            this.values_col_width = @max(this.values_col_width orelse 0, this.getWidthForValue(entry_value));
            return;
        }

        if (row_value.isObject()) {
            // object ->
            //  - if "properties" arg was provided: iterate the already-created columns (except for the 0-th which is the index)
            //  - otherwise: iterate the object properties, and create the columns on-demand
            if (!this.properties.isUndefined()) {
                for (columns.items[1..]) |*column| {
                    if (row_value.getWithString(this.globalObject, column.name)) |value| {
                        column.width = @max(column.width, this.getWidthForValue(value));
                    }
                }
            } else {
                var cols_iter = JSC.JSPropertyIterator(.{
                    .skip_empty_name = false,
                    .include_value = true,
                }).init(this.globalObject, row_value.asObjectRef());
                defer cols_iter.deinit();

                while (cols_iter.next()) |col_key| {
                    const value = cols_iter.value;

                    // find or create the column for the property
                    const column: *Column = brk: {
                        const col_str = String.init(col_key);
                        for (columns.items[1..]) |*col| {
                            if (col.name.eql(col_str)) {
                                break :brk col;
                            }
                        }

                        try columns.append(.{ .name = col_str });

                        break :brk &columns.items[columns.items.len - 1];
                    };

                    column.width = @max(column.width, this.getWidthForValue(value));
                }
            }
        } else if (this.properties.isUndefined()) {
            // not object -> the value will go to the special "Values" column
            this.values_col_width = @max(this.values_col_width orelse 1, this.getWidthForValue(row_value));
        }
    }

    fn writeStringNTimes(comptime Writer: type, writer: Writer, comptime str: []const u8, n: usize) !void {
        if (comptime str.len == 1) {
            try writer.writeByteNTimes(str[0], n);
            return;
        }

        for (0..n) |_| {
            try writer.writeAll(str);
        }
    }

    fn printRow(
        this: *TablePrinter,
        comptime Writer: type,
        writer: Writer,
        comptime enable_ansi_colors: bool,
        columns: *std.ArrayList(Column),
        row_key: RowKey,
        row_value: JSValue,
    ) !void {
        try writer.writeAll("│");
        {
            const len: u32 = switch (row_key) {
                .str => |value| @truncate(value.visibleWidthExcludeANSIColors()),
                .num => |value| @truncate(bun.fmt.fastDigitCount(value)),
            };
            const needed = columns.items[0].width -| len;

            // Right-align the number column
            try writer.writeByteNTimes(' ', needed + PADDING);
            switch (row_key) {
                .str => |value| try writer.print("{}", .{value}),
                .num => |value| try writer.print("{d}", .{value}),
            }
            try writer.writeByteNTimes(' ', PADDING);
        }

        for (1..columns.items.len) |col_idx| {
            const col = columns.items[col_idx];

            try writer.writeAll("│");

            var value = JSValue.zero;
            if (col_idx == 1 and this.jstype.isMap()) { // is the "Keys" column, when iterating a Map?
                value = row_value.getIndex(this.globalObject, 0);
            } else if (col_idx == this.values_col_idx) { // is the "Values" column?
                if (this.jstype.isMap()) {
                    value = row_value.getIndex(this.globalObject, 1);
                } else if (!row_value.isObject()) {
                    value = row_value;
                }
            } else if (row_value.isObject()) {
                value = row_value.getWithString(this.globalObject, col.name) orelse JSValue.zero;
            }

            if (value.isEmpty()) {
                try writer.writeByteNTimes(' ', col.width + (PADDING * 2));
            } else {
                const len: u32 = this.getWidthForValue(value);
                const needed = col.width -| len;
                try writer.writeByteNTimes(' ', PADDING);
                const tag = ConsoleObject.Formatter.Tag.get(value, this.globalObject);
                var value_formatter = this.value_formatter;

                value_formatter.quote_strings = !(tag.tag == .String or tag.tag == .StringPossiblyFormatted);

                defer {
                    if (value_formatter.map_node) |node| {
                        node.data = value_formatter.map;
                        node.data.clearRetainingCapacity();
                        node.release();
                    }
                }
                value_formatter.format(
                    tag,
                    Writer,
                    writer,
                    value,
                    this.globalObject,
                    enable_ansi_colors,
                );

                try writer.writeByteNTimes(' ', needed + PADDING);
            }
        }
        try writer.writeAll("│\n");
    }

    pub fn printTable(
        this: *TablePrinter,
        comptime Writer: type,
        writer: Writer,
        comptime enable_ansi_colors: bool,
    ) !void {
        const globalObject = this.globalObject;

        var stack_fallback = std.heap.stackFallback(@sizeOf(Column) * 16, this.globalObject.allocator());
        var columns = try std.ArrayList(Column).initCapacity(stack_fallback.get(), 16);
        defer {
            for (columns.items) |*col| {
                col.name.deref();
            }
            columns.deinit();
        }

        // create the first column " " which is always present
        columns.appendAssumeCapacity(.{
            .name = String.static(" "),
            .width = 1,
        });

        // special case for Map: create the special "Key" column at index 1
        if (this.jstype.isMap()) {
            columns.appendAssumeCapacity(.{
                .name = String.static("Key"),
            });
        }

        // if the "properties" arg was provided, pre-populate the columns
        if (!this.properties.isUndefined()) {
            var properties_iter = JSC.JSArrayIterator.init(this.properties, globalObject);
            while (properties_iter.next()) |value| {
                try columns.append(.{
                    .name = value.toBunString(globalObject),
                });
            }
        }

        // rows first pass - calculate the column widths
        {
            if (this.is_iterable) {
                var ctx_: struct { this: *TablePrinter, columns: *@TypeOf(columns), idx: u32 = 0, err: bool = false } = .{ .this = this, .columns = &columns };
                this.tabular_data.forEachWithContext(globalObject, &ctx_, struct {
                    fn callback(_: *JSC.VM, _: *JSGlobalObject, ctx: *@TypeOf(ctx_), value: JSValue) callconv(.C) void {
                        updateColumnsForRow(ctx.this, ctx.columns, .{ .num = ctx.idx }, value) catch {
                            ctx.err = true;
                        };
                        ctx.idx += 1;
                    }
                }.callback);
                if (ctx_.err) return error.JSError;
            } else {
                var rows_iter = JSC.JSPropertyIterator(.{
                    .skip_empty_name = false,
                    .include_value = true,
                }).init(globalObject, this.tabular_data.asObjectRef());
                defer rows_iter.deinit();

                while (rows_iter.next()) |row_key| {
                    try this.updateColumnsForRow(&columns, .{ .str = String.init(row_key) }, rows_iter.value);
                }
            }
        }

        // append the special "Values" column as the last one, if it is present
        if (this.values_col_width) |width| {
            this.values_col_idx = columns.items.len;
            try columns.append(.{
                .name = String.static("Values"),
                .width = width,
            });
        }

        // print the table header (border line + column names line + border line)
        {
            for (columns.items) |*col| {
                // also update the col width with the length of the column name itself
                col.width = @max(col.width, @as(u32, @intCast(col.name.visibleWidthExcludeANSIColors())));
            }

            try writer.writeAll("┌");
            for (columns.items, 0..) |*col, i| {
                if (i > 0) try writer.writeAll("┬");
                try writeStringNTimes(Writer, writer, "─", col.width + (PADDING * 2));
            }

            try writer.writeAll("┐\n│");

            for (columns.items, 0..) |col, i| {
                if (i > 0) try writer.writeAll("│");
                const len = col.name.visibleWidthExcludeANSIColors();
                const needed = col.width -| len;
                try writer.writeByteNTimes(' ', 1);
                if (comptime enable_ansi_colors) {
                    try writer.writeAll(Output.prettyFmt("<r><b>", true));
                }
                try writer.print("{}", .{col.name});
                if (comptime enable_ansi_colors) {
                    try writer.writeAll(Output.prettyFmt("<r>", true));
                }
                try writer.writeByteNTimes(' ', needed + PADDING);
            }

            try writer.writeAll("│\n├");
            for (columns.items, 0..) |col, i| {
                if (i > 0) try writer.writeAll("┼");
                try writeStringNTimes(Writer, writer, "─", col.width + (PADDING * 2));
            }
            try writer.writeAll("┤\n");
        }

        // rows second pass - print the actual table rows
        {
            if (this.is_iterable) {
                var ctx_: struct { this: *TablePrinter, columns: *@TypeOf(columns), writer: Writer, idx: u32 = 0, err: bool = false } = .{ .this = this, .columns = &columns, .writer = writer };
                this.tabular_data.forEachWithContext(globalObject, &ctx_, struct {
                    fn callback(_: *JSC.VM, _: *JSGlobalObject, ctx: *@TypeOf(ctx_), value: JSValue) callconv(.C) void {
                        printRow(ctx.this, Writer, ctx.writer, enable_ansi_colors, ctx.columns, .{ .num = ctx.idx }, value) catch {
                            ctx.err = true;
                        };
                        ctx.idx += 1;
                    }
                }.callback);
                if (ctx_.err) return error.JSError;
            } else {
                var rows_iter = JSC.JSPropertyIterator(.{
                    .skip_empty_name = false,
                    .include_value = true,
                }).init(globalObject, this.tabular_data.asObjectRef());
                defer rows_iter.deinit();

                while (rows_iter.next()) |row_key| {
                    try this.printRow(Writer, writer, enable_ansi_colors, &columns, .{ .str = String.init(row_key) }, rows_iter.value);
                }
            }
        }

        // print the table bottom border
        {
            try writer.writeAll("└");
            try writeStringNTimes(Writer, writer, "─", columns.items[0].width + (PADDING * 2));
            for (columns.items[1..]) |*column| {
                try writer.writeAll("┴");
                try writeStringNTimes(Writer, writer, "─", column.width + (PADDING * 2));
            }
            try writer.writeAll("┘\n");
        }
    }
};

pub fn writeTrace(comptime Writer: type, writer: Writer, global: *JSGlobalObject) void {
    var holder = ZigException.Holder.init();

    const exception = holder.zigException();
    var err = ZigString.init("trace output").toErrorInstance(global);
    err.toZigException(global, exception);
    VirtualMachine.get().remapZigException(exception, err, null);

    if (Output.enable_ansi_colors_stderr)
        VirtualMachine.printStackTrace(
            Writer,
            writer,
            exception.stack,
            true,
        ) catch {}
    else
        VirtualMachine.printStackTrace(
            Writer,
            writer,
            exception.stack,
            false,
        ) catch {};
}

pub const FormatOptions = struct {
    enable_colors: bool,
    add_newline: bool,
    flush: bool,
    ordered_properties: bool = false,
    quote_strings: bool = false,
    max_depth: u16 = 2,
};

pub fn format(
    level: MessageLevel,
    global: *JSGlobalObject,
    vals: [*]const JSValue,
    len: usize,
    comptime RawWriter: type,
    comptime Writer: type,
    writer: Writer,
    options: FormatOptions,
) void {
    var fmt: ConsoleObject.Formatter = undefined;
    defer {
        if (fmt.map_node) |node| {
            node.data = fmt.map;
            node.data.clearRetainingCapacity();
            node.release();
        }
    }

    if (len == 1) {
        fmt = ConsoleObject.Formatter{
            .remaining_values = &[_]JSValue{},
            .globalThis = global,
            .ordered_properties = options.ordered_properties,
            .quote_strings = options.quote_strings,
            .max_depth = options.max_depth,
        };
        const tag = ConsoleObject.Formatter.Tag.get(vals[0], global);

        var unbuffered_writer = if (comptime Writer != RawWriter)
            writer.context.unbuffered_writer.context.writer()
        else
            writer;

        if (tag.tag == .String) {
            if (options.enable_colors) {
                if (level == .Error) {
                    unbuffered_writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch {};
                }
                fmt.format(
                    tag,
                    @TypeOf(unbuffered_writer),
                    unbuffered_writer,
                    vals[0],
                    global,
                    true,
                );
                if (level == .Error) {
                    unbuffered_writer.writeAll(comptime Output.prettyFmt("<r>", true)) catch {};
                }
            } else {
                fmt.format(
                    tag,
                    @TypeOf(unbuffered_writer),
                    unbuffered_writer,
                    vals[0],
                    global,
                    false,
                );
            }
            if (options.add_newline) _ = unbuffered_writer.write("\n") catch 0;
        } else {
            defer {
                if (comptime Writer != RawWriter) {
                    if (options.flush) writer.context.flush() catch {};
                }
            }
            if (options.enable_colors) {
                fmt.format(
                    tag,
                    Writer,
                    writer,
                    vals[0],
                    global,
                    true,
                );
            } else {
                fmt.format(
                    tag,
                    Writer,
                    writer,
                    vals[0],
                    global,
                    false,
                );
            }
            if (options.add_newline) _ = writer.write("\n") catch 0;
        }

        return;
    }

    defer {
        if (comptime Writer != RawWriter) {
            if (options.flush) writer.context.flush() catch {};
        }
    }

    var this_value: JSValue = vals[0];
    fmt = ConsoleObject.Formatter{
        .remaining_values = vals[0..len][1..],
        .globalThis = global,
        .ordered_properties = options.ordered_properties,
        .quote_strings = options.quote_strings,
    };
    var tag: ConsoleObject.Formatter.Tag.Result = undefined;

    var any = false;
    if (options.enable_colors) {
        if (level == .Error) {
            writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch {};
        }
        while (true) {
            if (any) {
                _ = writer.write(" ") catch 0;
            }
            any = true;

            tag = ConsoleObject.Formatter.Tag.get(this_value, global);
            if (tag.tag == .String and fmt.remaining_values.len > 0) {
                tag.tag = .{ .StringPossiblyFormatted = {} };
            }

            fmt.format(tag, Writer, writer, this_value, global, true);
            if (fmt.remaining_values.len == 0) {
                break;
            }

            this_value = fmt.remaining_values[0];
            fmt.remaining_values = fmt.remaining_values[1..];
        }
        if (level == .Error) {
            writer.writeAll(comptime Output.prettyFmt("<r>", true)) catch {};
        }
    } else {
        while (true) {
            if (any) {
                _ = writer.write(" ") catch 0;
            }
            any = true;
            tag = ConsoleObject.Formatter.Tag.get(this_value, global);
            if (tag.tag == .String and fmt.remaining_values.len > 0) {
                tag.tag = .{ .StringPossiblyFormatted = {} };
            }

            fmt.format(tag, Writer, writer, this_value, global, false);
            if (fmt.remaining_values.len == 0)
                break;

            this_value = fmt.remaining_values[0];
            fmt.remaining_values = fmt.remaining_values[1..];
        }
    }

    if (options.add_newline) _ = writer.write("\n") catch 0;
}

const CustomFormattedObject = struct {
    function: JSValue = .zero,
    this: JSValue = .zero,
};

pub const Formatter = struct {
    remaining_values: []const JSValue = &[_]JSValue{},
    map: Visited.Map = undefined,
    map_node: ?*Visited.Pool.Node = null,
    hide_native: bool = false,
    globalThis: *JSGlobalObject,
    indent: u32 = 0,
    depth: u16 = 0,
    max_depth: u16 = 8,
    quote_strings: bool = false,
    quote_keys: bool = false,
    failed: bool = false,
    estimated_line_length: usize = 0,
    always_newline_scope: bool = false,
    single_line: bool = false,
    ordered_properties: bool = false,
    custom_formatted_object: CustomFormattedObject = .{},

    pub fn goodTimeForANewLine(this: *@This()) bool {
        if (this.estimated_line_length > 80) {
            this.resetLine();
            return true;
        }
        return false;
    }

    pub fn resetLine(this: *@This()) void {
        this.estimated_line_length = this.indent * 2;
    }

    pub fn addForNewLine(this: *@This(), len: usize) void {
        this.estimated_line_length +|= len;
    }

    pub const ZigFormatter = struct {
        formatter: *ConsoleObject.Formatter,
        global: *JSGlobalObject,
        value: JSValue,

        pub const WriteError = error{UhOh};
        pub fn format(self: ZigFormatter, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            self.formatter.remaining_values = &[_]JSValue{self.value};
            defer {
                self.formatter.remaining_values = &[_]JSValue{};
            }
            self.formatter.globalThis = self.global;
            self.formatter.format(
                Tag.get(self.value, self.global),
                @TypeOf(writer),
                writer,
                self.value,
                self.formatter.globalThis,
                false,
            );
        }
    };

    // For detecting circular references
    pub const Visited = struct {
        const ObjectPool = @import("../pool.zig").ObjectPool;
        pub const Map = std.AutoHashMap(JSValue.Type, void);
        pub const Pool = ObjectPool(
            Map,
            struct {
                pub fn init(allocator: std.mem.Allocator) anyerror!Map {
                    return Map.init(allocator);
                }
            }.init,
            true,
            16,
        );
    };

    pub const Tag = enum {
        StringPossiblyFormatted,
        String,
        Undefined,
        Double,
        Integer,
        Null,
        Boolean,
        Array,
        Object,
        Function,
        Class,
        Error,
        TypedArray,
        Map,
        MapIterator,
        SetIterator,
        Set,
        BigInt,
        Symbol,

        CustomFormattedObject,

        GlobalObject,
        Private,
        Promise,

        JSON,
        toJSON,
        NativeCode,
        ArrayBuffer,

        JSX,
        Event,

        Getter,

        pub fn isPrimitive(this: Tag) bool {
            return switch (this) {
                .String,
                .StringPossiblyFormatted,
                .Undefined,
                .Double,
                .Integer,
                .Null,
                .Boolean,
                .Symbol,
                .BigInt,
                => true,
                else => false,
            };
        }

        pub inline fn canHaveCircularReferences(tag: Tag) bool {
            return tag == .Array or tag == .Object or tag == .Map or tag == .Set;
        }

        const Result = struct {
            tag: union(Tag) {
                StringPossiblyFormatted: void,
                String: void,
                Undefined: void,
                Double: void,
                Integer: void,
                Null: void,
                Boolean: void,
                Array: void,
                Object: void,
                Function: void,
                Class: void,
                Error: void,
                TypedArray: void,
                Map: void,
                MapIterator: void,
                SetIterator: void,
                Set: void,
                BigInt: void,
                Symbol: void,
                CustomFormattedObject: CustomFormattedObject,
                GlobalObject: void,
                Private: void,
                Promise: void,
                JSON: void,
                toJSON: void,
                NativeCode: void,
                ArrayBuffer: void,
                JSX: void,
                Event: void,
                Getter: void,

                pub fn isPrimitive(this: @This()) bool {
                    return @as(Tag, this).isPrimitive();
                }
            },
            cell: JSValue.JSType = JSValue.JSType.Cell,
        };

        pub fn get(value: JSValue, globalThis: *JSGlobalObject) Result {
            return getAdvanced(value, globalThis, .{ .hide_global = false });
        }

        pub const Options = struct {
            hide_global: bool = false,
        };

        pub fn getAdvanced(value: JSValue, globalThis: *JSGlobalObject, opts: Options) Result {
            switch (@intFromEnum(value)) {
                0, 0xa => return Result{
                    .tag = .{ .Undefined = {} },
                },
                0x2 => return Result{
                    .tag = .{ .Null = {} },
                },
                else => {},
            }

            if (value.isInt32()) {
                return .{
                    .tag = .{ .Integer = {} },
                };
            } else if (value.isNumber()) {
                return .{
                    .tag = .{ .Double = {} },
                };
            } else if (value.isBoolean()) {
                return .{
                    .tag = .{ .Boolean = {} },
                };
            }

            if (!value.isCell())
                return .{
                    .tag = .{ .NativeCode = {} },
                };

            const js_type = value.jsType();

            if (js_type.isHidden()) return .{
                .tag = .{ .NativeCode = {} },
                .cell = js_type,
            };

            // Cell is the "unknown" type
            // if we call JSObjectGetPrivate, it can segfault
            if (js_type == .Cell) {
                return .{
                    .tag = .{ .NativeCode = {} },
                    .cell = js_type,
                };
            }

            if (js_type.canGet()) {
                // Attempt to get custom formatter
                if (value.fastGet(globalThis, .inspectCustom)) |callback_value| {
                    if (callback_value.isCallable(globalThis.vm())) {
                        return .{
                            .tag = .{
                                .CustomFormattedObject = .{
                                    .function = callback_value,
                                    .this = value,
                                },
                            },
                            .cell = js_type,
                        };
                    }
                }
            }

            if (js_type == .DOMWrapper) {
                return .{
                    .tag = .{ .Private = {} },
                    .cell = js_type,
                };
            }

            // If we check an Object has a method table and it does not
            // it will crash
            if (js_type != .Object and value.isCallable(globalThis.vm())) {
                if (value.isClass(globalThis)) {
                    return .{
                        .tag = .{ .Class = {} },
                        .cell = js_type,
                    };
                }

                return .{
                    // TODO: we print InternalFunction as Object because we have a lot of
                    // callable namespaces and printing the contents of it is better than [Function: namespace]
                    // ideally, we would print [Function: namespace] { ... } on all functions, internal and js.
                    // what we'll do later is rid of .Function and .Class and handle the prefix in the .Object formatter
                    .tag = if (js_type == .InternalFunction) .Object else .Function,
                    .cell = js_type,
                };
            }

            if (js_type == .GlobalProxy) {
                if (!opts.hide_global) {
                    return Tag.get(
                        JSC.JSValue.c(JSC.C.JSObjectGetProxyTarget(value.asObjectRef())),
                        globalThis,
                    );
                }
                return .{
                    .tag = .{ .GlobalObject = {} },
                    .cell = js_type,
                };
            }

            // Is this a react element?
            if (js_type.isObject()) {
                if (value.get(globalThis, "$$typeof")) |typeof_symbol| {
                    var reactElement = ZigString.init("react.element");
                    var react_fragment = ZigString.init("react.fragment");

                    if (JSValue.isSameValue(typeof_symbol, JSValue.symbolFor(globalThis, &reactElement), globalThis) or JSValue.isSameValue(typeof_symbol, JSValue.symbolFor(globalThis, &react_fragment), globalThis)) {
                        return .{ .tag = .{ .JSX = {} }, .cell = js_type };
                    }
                }
            }

            return .{
                .tag = switch (js_type) {
                    JSValue.JSType.ErrorInstance => .Error,
                    JSValue.JSType.NumberObject => .Double,
                    JSValue.JSType.DerivedArray, JSValue.JSType.Array => .Array,
                    JSValue.JSType.DerivedStringObject, JSValue.JSType.String, JSValue.JSType.StringObject => .String,
                    JSValue.JSType.RegExpObject => .String,
                    JSValue.JSType.Symbol => .Symbol,
                    JSValue.JSType.BooleanObject => .Boolean,
                    JSValue.JSType.JSFunction => .Function,
                    JSValue.JSType.JSWeakMap, JSValue.JSType.JSMap => .Map,
                    JSValue.JSType.JSMapIterator => .MapIterator,
                    JSValue.JSType.JSSetIterator => .SetIterator,
                    JSValue.JSType.JSWeakSet, JSValue.JSType.JSSet => .Set,
                    JSValue.JSType.JSDate => .JSON,
                    JSValue.JSType.JSPromise => .Promise,
                    JSValue.JSType.Object,
                    JSValue.JSType.FinalObject,
                    .ModuleNamespaceObject,
                    => .Object,

                    .GlobalObject => if (!opts.hide_global)
                        .Object
                    else
                        .GlobalObject,

                    .ArrayBuffer,
                    JSValue.JSType.Int8Array,
                    JSValue.JSType.Uint8Array,
                    JSValue.JSType.Uint8ClampedArray,
                    JSValue.JSType.Int16Array,
                    JSValue.JSType.Uint16Array,
                    JSValue.JSType.Int32Array,
                    JSValue.JSType.Uint32Array,
                    JSValue.JSType.Float32Array,
                    JSValue.JSType.Float64Array,
                    JSValue.JSType.BigInt64Array,
                    JSValue.JSType.BigUint64Array,
                    .DataView,
                    => .TypedArray,

                    .HeapBigInt => .BigInt,

                    // None of these should ever exist here
                    // But we're going to check anyway
                    .APIValueWrapper,
                    .NativeExecutable,
                    .ProgramExecutable,
                    .ModuleProgramExecutable,
                    .EvalExecutable,
                    .FunctionExecutable,
                    .UnlinkedFunctionExecutable,
                    .UnlinkedProgramCodeBlock,
                    .UnlinkedModuleProgramCodeBlock,
                    .UnlinkedEvalCodeBlock,
                    .UnlinkedFunctionCodeBlock,
                    .CodeBlock,
                    .JSImmutableButterfly,
                    .JSSourceCode,
                    .JSScriptFetcher,
                    .JSScriptFetchParameters,
                    .JSCallee,
                    .GlobalLexicalEnvironment,
                    .LexicalEnvironment,
                    .ModuleEnvironment,
                    .StrictEvalActivation,
                    .WithScope,
                    => .NativeCode,

                    .Event => .Event,

                    .GetterSetter, .CustomGetterSetter => .Getter,

                    .JSAsJSONType => .toJSON,

                    else => .JSON,
                },
                .cell = js_type,
            };
        }
    };

    const CellType = JSC.C.CellType;
    threadlocal var name_buf: [512]u8 = undefined;

    fn writeWithFormatting(
        this: *ConsoleObject.Formatter,
        comptime Writer: type,
        writer_: Writer,
        comptime Slice: type,
        slice_: Slice,
        globalThis: *JSGlobalObject,
        comptime enable_ansi_colors: bool,
    ) void {
        var writer = WrappedWriter(Writer){
            .ctx = writer_,
            .estimated_line_length = &this.estimated_line_length,
        };
        var slice = slice_;
        var i: u32 = 0;
        var len: u32 = @as(u32, @truncate(slice.len));
        var any_non_ascii = false;
        while (i < len) : (i += 1) {
            switch (slice[i]) {
                '%' => {
                    i += 1;
                    if (i >= len)
                        break;

                    const token = switch (slice[i]) {
                        's' => Tag.String,
                        'f' => Tag.Double,
                        'o' => Tag.Undefined,
                        'O' => Tag.Object,
                        'd', 'i' => Tag.Integer,
                        else => continue,
                    };

                    // Flush everything up to the %
                    const end = slice[0 .. i - 1];
                    if (!any_non_ascii)
                        writer.writeAll(end)
                    else
                        writer.writeAll(end);
                    any_non_ascii = false;
                    slice = slice[@min(slice.len, i + 1)..];
                    i = 0;
                    len = @as(u32, @truncate(slice.len));
                    const next_value = this.remaining_values[0];
                    this.remaining_values = this.remaining_values[1..];
                    switch (token) {
                        Tag.String => this.printAs(Tag.String, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors),
                        Tag.Double => this.printAs(Tag.Double, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors),
                        Tag.Object => this.printAs(Tag.Object, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors),
                        Tag.Integer => this.printAs(Tag.Integer, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors),

                        // undefined is overloaded to mean the '%o" field
                        Tag.Undefined => this.format(Tag.get(next_value, globalThis), Writer, writer_, next_value, globalThis, enable_ansi_colors),

                        else => unreachable,
                    }
                    if (this.remaining_values.len == 0) break;
                },
                '\\' => {
                    i += 1;
                    if (i >= len)
                        break;
                    if (slice[i] == '%') i += 2;
                },
                128...255 => {
                    any_non_ascii = true;
                },
                else => {},
            }
        }

        if (slice.len > 0) writer.writeAll(slice);
    }

    pub fn WrappedWriter(comptime Writer: type) type {
        return struct {
            ctx: Writer,
            failed: bool = false,
            estimated_line_length: *usize,

            pub fn print(self: *@This(), comptime fmt: string, args: anytype) void {
                self.ctx.print(fmt, args) catch {
                    self.failed = true;
                };
            }

            pub fn space(self: *@This()) void {
                self.estimated_line_length.* += 1;
                self.ctx.writeAll(" ") catch {
                    self.failed = true;
                };
            }

            pub fn pretty(self: *@This(), comptime fmt: string, comptime enable_ansi_color: bool, args: anytype) void {
                const length_ignoring_formatted_values = comptime brk: {
                    const fmt_str = Output.prettyFmt(fmt, false);
                    var length: usize = 0;
                    var i: usize = 0;
                    while (i < fmt_str.len) : (i += 1) {
                        switch (fmt_str[i]) {
                            '{' => {
                                i += 1;
                                if (i >= fmt_str.len)
                                    break;
                                if (fmt_str[i] == '{') {
                                    @compileError("Format string too complicated for pretty() right now");
                                }

                                while (i < fmt_str.len) : (i += 1) {
                                    if (fmt_str[i] == '}') {
                                        break;
                                    }
                                }
                                if (i >= fmt_str.len)
                                    break;
                            },
                            128...255 => {
                                @compileError("Format string too complicated for pretty() right now");
                            },
                            else => {},
                        }
                        length += 1;
                    }

                    break :brk length;
                };

                self.estimated_line_length.* += length_ignoring_formatted_values;
                self.ctx.print(comptime Output.prettyFmt(fmt, enable_ansi_color), args) catch {
                    self.failed = true;
                };
            }

            pub fn writeLatin1(self: *@This(), buf: []const u8) void {
                var remain = buf;
                while (remain.len > 0) {
                    if (strings.firstNonASCII(remain)) |i| {
                        if (i > 0) {
                            self.ctx.writeAll(remain[0..i]) catch {
                                self.failed = true;
                                return;
                            };
                        }
                        self.ctx.writeAll(&strings.latin1ToCodepointBytesAssumeNotASCII(remain[i])) catch {
                            self.failed = true;
                        };
                        remain = remain[i + 1 ..];
                    } else {
                        break;
                    }
                }

                self.ctx.writeAll(remain) catch return;
            }

            pub inline fn writeAll(self: *@This(), buf: []const u8) void {
                self.ctx.writeAll(buf) catch {
                    self.failed = true;
                };
            }

            pub inline fn writeString(self: *@This(), str: ZigString) void {
                self.print("{}", .{str});
            }

            pub inline fn write16Bit(self: *@This(), input: []const u16) void {
                bun.fmt.formatUTF16Type([]const u16, input, self.ctx) catch {
                    self.failed = true;
                };
            }
        };
    }

    pub fn writeIndent(
        this: *ConsoleObject.Formatter,
        comptime Writer: type,
        writer: Writer,
    ) !void {
        var buf = [_]u8{' '} ** 64;
        var total_remain: u32 = this.indent;
        while (total_remain > 0) {
            const written: u8 = @min(32, total_remain);
            try writer.writeAll(buf[0 .. written * 2]);
            total_remain -|= written;
        }
    }

    pub fn printComma(this: *ConsoleObject.Formatter, comptime Writer: type, writer: Writer, comptime enable_ansi_colors: bool) !void {
        try writer.writeAll(comptime Output.prettyFmt("<r><d>,<r>", enable_ansi_colors));
        this.estimated_line_length += 1;
    }

    pub fn MapIterator(comptime Writer: type, comptime enable_ansi_colors: bool, comptime is_iterator: bool, comptime single_line: bool) type {
        return struct {
            formatter: *ConsoleObject.Formatter,
            writer: Writer,
            count: usize = 0,
            pub fn forEach(_: [*c]JSC.VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void {
                var this: *@This() = bun.cast(*@This(), ctx orelse return);
                if (single_line and this.count > 0) {
                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch unreachable;
                    this.writer.writeAll(" ") catch unreachable;
                }
                if (!is_iterator) {
                    const key = JSC.JSObject.getIndex(nextValue, globalObject, 0);
                    const value = JSC.JSObject.getIndex(nextValue, globalObject, 1);

                    if (!single_line) {
                        this.formatter.writeIndent(Writer, this.writer) catch unreachable;
                    }
                    const key_tag = Tag.getAdvanced(key, globalObject, .{ .hide_global = true });

                    this.formatter.format(
                        key_tag,
                        Writer,
                        this.writer,
                        key,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );
                    this.writer.writeAll(": ") catch unreachable;
                    const value_tag = Tag.getAdvanced(value, globalObject, .{ .hide_global = true });
                    this.formatter.format(
                        value_tag,
                        Writer,
                        this.writer,
                        value,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );
                } else {
                    if (!single_line) {
                        this.writer.writeAll("\n") catch unreachable;
                        this.formatter.writeIndent(Writer, this.writer) catch unreachable;
                    }
                    const tag = Tag.getAdvanced(nextValue, globalObject, .{ .hide_global = true });
                    this.formatter.format(
                        tag,
                        Writer,
                        this.writer,
                        nextValue,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );
                }
                this.count += 1;
                if (!single_line) {
                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch unreachable;
                    if (!is_iterator) {
                        this.writer.writeAll("\n") catch unreachable;
                    }
                }
            }
        };
    }

    pub fn SetIterator(comptime Writer: type, comptime enable_ansi_colors: bool, comptime single_line: bool) type {
        return struct {
            formatter: *ConsoleObject.Formatter,
            writer: Writer,
            is_first: bool = true,
            pub fn forEach(_: [*c]JSC.VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void {
                var this: *@This() = bun.cast(*@This(), ctx orelse return);
                if (single_line) {
                    if (!this.is_first) {
                        this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch unreachable;
                        this.writer.writeAll(" ") catch unreachable;
                    }
                    this.is_first = false;
                } else {
                    this.formatter.writeIndent(Writer, this.writer) catch {};
                }
                const key_tag = Tag.getAdvanced(nextValue, globalObject, .{ .hide_global = true });
                this.formatter.format(
                    key_tag,
                    Writer,
                    this.writer,
                    nextValue,
                    this.formatter.globalThis,
                    enable_ansi_colors,
                );

                if (!single_line) {
                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch unreachable;
                    this.writer.writeAll("\n") catch unreachable;
                }
            }
        };
    }

    pub fn PropertyIterator(comptime Writer: type, comptime enable_ansi_colors_: bool) type {
        return struct {
            formatter: *ConsoleObject.Formatter,
            writer: Writer,
            i: usize = 0,
            single_line: bool,
            always_newline: bool = false,
            parent: JSValue,
            const enable_ansi_colors = enable_ansi_colors_;
            pub fn handleFirstProperty(this: *@This(), globalThis: *JSC.JSGlobalObject, value: JSValue) void {
                if (!value.jsType().isFunction()) {
                    var writer = WrappedWriter(Writer){
                        .ctx = this.writer,
                        .failed = false,
                        .estimated_line_length = &this.formatter.estimated_line_length,
                    };

                    if (getObjectName(globalThis, value)) |name_str| {
                        writer.print("{} ", .{name_str});
                    }
                }

                if (!this.single_line) {
                    this.always_newline = true;
                }
                this.formatter.estimated_line_length = this.formatter.indent * 2 + 1;
                this.formatter.indent += 1;
                this.formatter.depth += 1;
                if (this.single_line) {
                    this.writer.writeAll("{ ") catch {};
                } else {
                    this.writer.writeAll("{\n") catch {};
                    this.formatter.writeIndent(Writer, this.writer) catch {};
                }
            }

            pub fn forEach(
                globalThis: *JSGlobalObject,
                ctx_ptr: ?*anyopaque,
                key_: [*c]ZigString,
                value: JSValue,
                is_symbol: bool,
                is_private_symbol: bool,
            ) callconv(.C) void {
                const key = key_.?[0];
                if (key.eqlComptime("constructor")) return;

                var ctx: *@This() = bun.cast(*@This(), ctx_ptr orelse return);
                var this = ctx.formatter;
                const writer_ = ctx.writer;
                var writer = WrappedWriter(Writer){
                    .ctx = writer_,
                    .failed = false,
                    .estimated_line_length = &this.estimated_line_length,
                };

                const tag = Tag.getAdvanced(value, globalThis, .{ .hide_global = true });

                if (tag.cell.isHidden()) return;
                if (ctx.i == 0) {
                    handleFirstProperty(ctx, globalThis, ctx.parent);
                } else {
                    this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                }

                defer ctx.i += 1;
                if (ctx.i > 0) {
                    if (!this.single_line and (ctx.always_newline or this.always_newline_scope or this.goodTimeForANewLine())) {
                        writer.writeAll("\n");
                        this.writeIndent(Writer, writer_) catch {};
                        this.resetLine();
                    } else {
                        writer.space();
                    }
                }

                if (!is_symbol) {

                    // TODO: make this one pass?
                    if (!key.is16Bit() and (!this.quote_keys and JSLexer.isLatin1Identifier(@TypeOf(key.slice()), key.slice()))) {
                        this.addForNewLine(key.len + 1);

                        writer.print(
                            comptime Output.prettyFmt("<r>{}<d>:<r> ", enable_ansi_colors),
                            .{key},
                        );
                    } else if (key.is16Bit() and (!this.quote_keys and JSLexer.isLatin1Identifier(@TypeOf(key.utf16SliceAligned()), key.utf16SliceAligned()))) {
                        this.addForNewLine(key.len + 1);

                        writer.print(
                            comptime Output.prettyFmt("<r>{}<d>:<r> ", enable_ansi_colors),
                            .{key},
                        );
                    } else if (key.is16Bit()) {
                        var utf16Slice = key.utf16SliceAligned();

                        this.addForNewLine(utf16Slice.len + 2);

                        if (comptime enable_ansi_colors) {
                            writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                        }

                        writer.writeAll("\"");

                        while (strings.indexOfAny16(utf16Slice, "\"")) |j| {
                            writer.write16Bit(utf16Slice[0..j]);
                            writer.writeAll("\"");
                            utf16Slice = utf16Slice[j + 1 ..];
                        }

                        writer.write16Bit(utf16Slice);

                        writer.print(
                            comptime Output.prettyFmt("\"<r><d>:<r> ", enable_ansi_colors),
                            .{},
                        );
                    } else {
                        this.addForNewLine(key.len + 2);

                        writer.print(
                            comptime Output.prettyFmt("<r><green>{s}<r><d>:<r> ", enable_ansi_colors),
                            .{JSPrinter.formatJSONString(key.slice())},
                        );
                    }
                } else if (Environment.isDebug and is_private_symbol) {
                    this.addForNewLine(1 + "$:".len + key.len);
                    writer.print(
                        comptime Output.prettyFmt("<r><magenta>${any}<r><d>:<r> ", enable_ansi_colors),
                        .{key},
                    );
                } else {
                    this.addForNewLine(1 + "[Symbol()]:".len + key.len);
                    writer.print(
                        comptime Output.prettyFmt("<r><d>[<r><blue>Symbol({any})<r><d>]:<r> ", enable_ansi_colors),
                        .{key},
                    );
                }

                if (tag.cell.isStringLike()) {
                    if (comptime enable_ansi_colors) {
                        writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                    }
                }

                this.format(tag, Writer, ctx.writer, value, globalThis, enable_ansi_colors);

                if (tag.cell.isStringLike()) {
                    if (comptime enable_ansi_colors) {
                        writer.writeAll(comptime Output.prettyFmt("<r>", true));
                    }
                }
            }
        };
    }

    fn getObjectName(globalThis: *JSC.JSGlobalObject, value: JSValue) ?ZigString {
        var name_str = ZigString.init("");
        value.getClassName(globalThis, &name_str);
        if (!name_str.eqlComptime("Object")) {
            return name_str;
        }
        return null;
    }

    extern fn JSC__JSValue__callCustomInspectFunction(
        *JSC.JSGlobalObject,
        JSValue,
        JSValue,
        depth: u32,
        max_depth: u32,
        colors: bool,
    ) JSValue;

    pub fn printAs(
        this: *ConsoleObject.Formatter,
        comptime Format: ConsoleObject.Formatter.Tag,
        comptime Writer: type,
        writer_: Writer,
        value: JSValue,
        jsType: JSValue.JSType,
        comptime enable_ansi_colors: bool,
    ) void {
        if (this.failed)
            return;
        var writer = WrappedWriter(Writer){ .ctx = writer_, .estimated_line_length = &this.estimated_line_length };
        defer {
            if (writer.failed) {
                this.failed = true;
            }
        }
        if (comptime Format.canHaveCircularReferences()) {
            if (this.map_node == null) {
                this.map_node = Visited.Pool.get(default_allocator);
                this.map_node.?.data.clearRetainingCapacity();
                this.map = this.map_node.?.data;
            }

            const entry = this.map.getOrPut(@intFromEnum(value)) catch unreachable;
            if (entry.found_existing) {
                writer.writeAll(comptime Output.prettyFmt("<r><cyan>[Circular]<r>", enable_ansi_colors));
                return;
            }
        }

        defer {
            if (comptime Format.canHaveCircularReferences()) {
                _ = this.map.remove(@intFromEnum(value));
            }
        }

        switch (comptime Format) {
            .StringPossiblyFormatted => {
                var str = value.toSlice(this.globalThis, bun.default_allocator);
                defer str.deinit();
                this.addForNewLine(str.len);
                const slice = str.slice();
                this.writeWithFormatting(Writer, writer_, @TypeOf(slice), slice, this.globalThis, enable_ansi_colors);
            },
            .String => {
                const str: bun.String = bun.String.tryFromJS(value, this.globalThis) orelse {
                    writer.failed = true;
                    return;
                };
                defer str.deref();
                this.addForNewLine(str.length());

                if (this.quote_strings and jsType != .RegExpObject) {
                    if (str.isEmpty()) {
                        writer.writeAll("\"\"");
                        return;
                    }

                    if (comptime enable_ansi_colors) {
                        writer.writeAll(Output.prettyFmt("<r><green>", true));
                    }

                    defer if (comptime enable_ansi_colors)
                        writer.writeAll(Output.prettyFmt("<r>", true));

                    if (str.isUTF16()) {
                        this.printAs(.JSON, Writer, writer_, value, .StringObject, enable_ansi_colors);
                        return;
                    }

                    JSPrinter.writeJSONString(str.latin1(), Writer, writer_, .latin1) catch unreachable;

                    return;
                }

                if (jsType == .RegExpObject and enable_ansi_colors) {
                    writer.print(comptime Output.prettyFmt("<r><red>", enable_ansi_colors), .{});
                }

                if (str.isUTF16()) {
                    // streaming print
                    writer.print("{}", .{str});
                } else if (str.asUTF8()) |slice| {
                    // fast path
                    writer.writeAll(slice);
                } else if (!str.isEmpty()) {
                    // slow path
                    const buf = strings.allocateLatin1IntoUTF8(bun.default_allocator, []const u8, str.latin1()) catch &[_]u8{};
                    if (buf.len > 0) {
                        defer bun.default_allocator.free(buf);
                        writer.writeAll(buf);
                    }
                }

                if (jsType == .RegExpObject and enable_ansi_colors) {
                    writer.print(comptime Output.prettyFmt("<r>", enable_ansi_colors), .{});
                }
            },
            .Integer => {
                const int = value.coerce(i64, this.globalThis);
                if (int < std.math.maxInt(u32)) {
                    var i = int;
                    const is_negative = i < 0;
                    if (is_negative) {
                        i = -i;
                    }
                    const digits = if (i != 0)
                        bun.fmt.fastDigitCount(@as(usize, @intCast(i))) + @as(usize, @intFromBool(is_negative))
                    else
                        1;
                    this.addForNewLine(digits);
                } else {
                    this.addForNewLine(bun.fmt.count("{d}", .{int}));
                }
                writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{int});
            },
            .BigInt => {
                const out_str = value.getZigString(this.globalThis).slice();
                this.addForNewLine(out_str.len);

                writer.print(comptime Output.prettyFmt("<r><yellow>{s}n<r>", enable_ansi_colors), .{out_str});
            },
            .Double => {
                if (value.isCell()) {
                    var number_name = ZigString.Empty;
                    value.getClassName(this.globalThis, &number_name);

                    var number_value = ZigString.Empty;
                    value.toZigString(&number_value, this.globalThis);

                    if (!strings.eqlComptime(number_name.slice(), "Number")) {
                        this.addForNewLine(number_name.len + number_value.len + "[Number ():]".len);
                        writer.print(comptime Output.prettyFmt("<r><yellow>[Number ({s}): {s}]<r>", enable_ansi_colors), .{
                            number_name,
                            number_value,
                        });
                        return;
                    }

                    this.addForNewLine(number_name.len + number_value.len + 4);
                    writer.print(comptime Output.prettyFmt("<r><yellow>[{s}: {s}]<r>", enable_ansi_colors), .{
                        number_name,
                        number_value,
                    });
                    return;
                }

                const num = value.asNumber();

                if (std.math.isPositiveInf(num)) {
                    this.addForNewLine("Infinity".len);
                    writer.print(comptime Output.prettyFmt("<r><yellow>Infinity<r>", enable_ansi_colors), .{});
                } else if (std.math.isNegativeInf(num)) {
                    this.addForNewLine("-Infinity".len);
                    writer.print(comptime Output.prettyFmt("<r><yellow>-Infinity<r>", enable_ansi_colors), .{});
                } else if (std.math.isNan(num)) {
                    this.addForNewLine("NaN".len);
                    writer.print(comptime Output.prettyFmt("<r><yellow>NaN<r>", enable_ansi_colors), .{});
                } else {
                    this.addForNewLine(std.fmt.count("{d}", .{num}));
                    writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{num});
                }
            },
            .Undefined => {
                this.addForNewLine(9);
                writer.print(comptime Output.prettyFmt("<r><d>undefined<r>", enable_ansi_colors), .{});
            },
            .Null => {
                this.addForNewLine(4);
                writer.print(comptime Output.prettyFmt("<r><yellow>null<r>", enable_ansi_colors), .{});
            },
            .CustomFormattedObject => {
                // Call custom inspect function. Will return the error if there is one
                // we'll need to pass the callback through to the "this" value in here
                const result = JSC__JSValue__callCustomInspectFunction(
                    this.globalThis,
                    this.custom_formatted_object.function,
                    this.custom_formatted_object.this,
                    this.max_depth -| this.depth,
                    this.max_depth,
                    enable_ansi_colors,
                );
                // Strings are printed directly, otherwise we recurse. It is possible to end up in an infinite loop.
                if (result.isString()) {
                    writer.print("{}", .{result.fmtString(this.globalThis)});
                } else {
                    this.format(ConsoleObject.Formatter.Tag.get(result, this.globalThis), Writer, writer_, result, this.globalThis, enable_ansi_colors);
                }
            },
            .Symbol => {
                const description = value.getDescription(this.globalThis);
                this.addForNewLine("Symbol".len);

                if (description.len > 0) {
                    this.addForNewLine(description.len + "()".len);
                    writer.print(comptime Output.prettyFmt("<r><blue>Symbol({any})<r>", enable_ansi_colors), .{description});
                } else {
                    writer.print(comptime Output.prettyFmt("<r><blue>Symbol<r>", enable_ansi_colors), .{});
                }
            },
            .Error => {
                VirtualMachine.get().printErrorlikeObject(
                    value,
                    null,
                    null,
                    Writer,
                    writer_,
                    enable_ansi_colors,
                    false,
                );
            },
            .Class => {
                var printable = ZigString.init(&name_buf);
                value.getClassName(this.globalThis, &printable);
                this.addForNewLine(printable.len);

                if (printable.len == 0) {
                    writer.print(comptime Output.prettyFmt("<cyan>[class (anonymous)]<r>", enable_ansi_colors), .{});
                } else {
                    writer.print(comptime Output.prettyFmt("<cyan>[class {}]<r>", enable_ansi_colors), .{printable});
                }
            },
            .Function => {
                var printable = value.getName(this.globalThis);
                defer printable.deref();

                if (printable.isEmpty()) {
                    writer.print(comptime Output.prettyFmt("<cyan>[Function]<r>", enable_ansi_colors), .{});
                } else {
                    writer.print(comptime Output.prettyFmt("<cyan>[Function: {}]<r>", enable_ansi_colors), .{printable});
                }
            },
            .Getter => {
                writer.print(comptime Output.prettyFmt("<cyan>[Getter]<r>", enable_ansi_colors), .{});
            },
            .Array => {
                const len = @as(u32, @truncate(value.getLength(this.globalThis)));

                // TODO: DerivedArray does not get passed along in JSType, and it's not clear why.
                // if (jsType == .DerivedArray) {
                //     var printable = value.className(this.globalThis);

                //     if (!printable.isEmpty()) {
                //         writer.print(comptime Output.prettyFmt("{}<r><d>(<r><yellow><r>{d}<r><d>)<r> ", enable_ansi_colors), .{ printable, len });
                //     }
                // }

                if (len == 0) {
                    writer.writeAll("[]");
                    this.addForNewLine(2);
                    return;
                }

                var was_good_time = this.always_newline_scope or
                    // heuristic: more than 10, probably should have a newline before it
                    len > 10;
                {
                    this.indent += 1;
                    this.depth += 1;
                    defer this.depth -|= 1;
                    defer this.indent -|= 1;

                    this.addForNewLine(2);

                    const prev_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = prev_quote_strings;
                    var empty_start: ?u32 = null;
                    first: {
                        const element = value.getDirectIndex(this.globalThis, 0);

                        const tag = Tag.getAdvanced(element, this.globalThis, .{ .hide_global = true });

                        was_good_time = was_good_time or !tag.tag.isPrimitive() or this.goodTimeForANewLine();

                        if (!this.single_line and (this.ordered_properties or was_good_time)) {
                            this.resetLine();
                            writer.writeAll("[");
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch unreachable;
                            this.addForNewLine(1);
                        } else {
                            writer.writeAll("[ ");
                            this.addForNewLine(2);
                        }

                        if (element.isEmpty()) {
                            empty_start = 0;
                            break :first;
                        }

                        this.format(tag, Writer, writer_, element, this.globalThis, enable_ansi_colors);

                        if (tag.cell.isStringLike()) {
                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r>", true));
                            }
                        }
                    }

                    var i: u32 = 1;

                    while (i < len) : (i += 1) {
                        const element = value.getDirectIndex(this.globalThis, i);
                        if (element.isEmpty()) {
                            if (empty_start == null) {
                                empty_start = i;
                            }
                            continue;
                        }

                        if (empty_start) |empty| {
                            if (empty > 0) {
                                this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                                if (!this.single_line and (this.ordered_properties or this.goodTimeForANewLine())) {
                                    was_good_time = true;
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch unreachable;
                                } else {
                                    writer.space();
                                }
                            }
                            const empty_count = i - empty;
                            if (empty_count == 1) {
                                writer.pretty("<r><d>empty item<r>", enable_ansi_colors, .{});
                            } else {
                                this.estimated_line_length += bun.fmt.fastDigitCount(empty_count);
                                writer.pretty("<r><d>{d} x empty items<r>", enable_ansi_colors, .{empty_count});
                            }
                            empty_start = null;
                        }

                        this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                        if (!this.single_line and (this.ordered_properties or this.goodTimeForANewLine())) {
                            writer.writeAll("\n");
                            was_good_time = true;
                            this.writeIndent(Writer, writer_) catch unreachable;
                        } else {
                            writer.space();
                        }

                        const tag = Tag.getAdvanced(element, this.globalThis, .{ .hide_global = true });

                        this.format(tag, Writer, writer_, element, this.globalThis, enable_ansi_colors);

                        if (tag.cell.isStringLike()) {
                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r>", true));
                            }
                        }
                    }

                    if (empty_start) |empty| {
                        if (empty > 0) {
                            this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                            if (!this.single_line and (this.ordered_properties or this.goodTimeForANewLine())) {
                                writer.writeAll("\n");
                                was_good_time = true;
                                this.writeIndent(Writer, writer_) catch unreachable;
                            } else {
                                writer.space();
                            }
                        }

                        empty_start = null;

                        const empty_count = len - empty;
                        if (empty_count == 1) {
                            writer.pretty("<r><d>empty item<r>", enable_ansi_colors, .{});
                        } else {
                            this.estimated_line_length += bun.fmt.fastDigitCount(empty_count);
                            writer.pretty("<r><d>{d} x empty items<r>", enable_ansi_colors, .{empty_count});
                        }
                    }
                }

                if (!this.single_line and (this.ordered_properties or was_good_time or this.goodTimeForANewLine())) {
                    this.resetLine();
                    writer.writeAll("\n");
                    this.writeIndent(Writer, writer_) catch {};
                    writer.writeAll("]");
                    this.resetLine();
                    this.addForNewLine(1);
                } else {
                    writer.writeAll(" ]");
                    this.addForNewLine(2);
                }
            },
            .Private => {
                if (value.as(JSC.WebCore.Response)) |response| {
                    response.writeFormat(ConsoleObject.Formatter, this, writer_, enable_ansi_colors) catch {};
                    return;
                } else if (value.as(JSC.WebCore.Request)) |request| {
                    request.writeFormat(ConsoleObject.Formatter, this, writer_, enable_ansi_colors) catch {};
                    return;
                } else if (value.as(JSC.API.BuildArtifact)) |build| {
                    build.writeFormat(ConsoleObject.Formatter, this, writer_, enable_ansi_colors) catch {};
                    return;
                } else if (value.as(JSC.WebCore.Blob)) |blob| {
                    blob.writeFormat(ConsoleObject.Formatter, this, writer_, enable_ansi_colors) catch {};
                    return;
                } else if (value.as(JSC.FetchHeaders) != null) {
                    if (value.get(this.globalThis, "toJSON")) |toJSONFunction| {
                        this.addForNewLine("Headers ".len);
                        writer.writeAll(comptime Output.prettyFmt("<r>Headers ", enable_ansi_colors));
                        const prev_quote_keys = this.quote_keys;
                        this.quote_keys = true;
                        defer this.quote_keys = prev_quote_keys;

                        return this.printAs(
                            .Object,
                            Writer,
                            writer_,
                            toJSONFunction.callWithThis(this.globalThis, value, &.{}),
                            .Object,
                            enable_ansi_colors,
                        );
                    }
                } else if (value.as(JSC.DOMFormData) != null) {
                    if (value.get(this.globalThis, "toJSON")) |toJSONFunction| {
                        const prev_quote_keys = this.quote_keys;
                        this.quote_keys = true;
                        defer this.quote_keys = prev_quote_keys;

                        return this.printAs(
                            .Object,
                            Writer,
                            writer_,
                            toJSONFunction.callWithThis(this.globalThis, value, &.{}),
                            .Object,
                            enable_ansi_colors,
                        );
                    }

                    // this case should never happen
                    return this.printAs(.Undefined, Writer, writer_, .undefined, .Cell, enable_ansi_colors);
                } else if (value.as(JSC.API.Bun.Timer.TimerObject)) |timer| {
                    this.addForNewLine("Timeout(# ) ".len + bun.fmt.fastDigitCount(@as(u64, @intCast(@max(timer.id, 0)))));
                    if (timer.kind == .setInterval) {
                        this.addForNewLine("repeats ".len + bun.fmt.fastDigitCount(@as(u64, @intCast(@max(timer.id, 0)))));
                        writer.print(comptime Output.prettyFmt("<r><blue>Timeout<r> <d>(#<yellow>{d}<r><d>, repeats)<r>", enable_ansi_colors), .{
                            timer.id,
                        });
                    } else {
                        writer.print(comptime Output.prettyFmt("<r><blue>Timeout<r> <d>(#<yellow>{d}<r><d>)<r>", enable_ansi_colors), .{
                            timer.id,
                        });
                    }

                    return;
                } else if (value.as(JSC.BuildMessage)) |build_log| {
                    build_log.msg.writeFormat(writer_, enable_ansi_colors) catch {};
                    return;
                } else if (value.as(JSC.ResolveMessage)) |resolve_log| {
                    resolve_log.msg.writeFormat(writer_, enable_ansi_colors) catch {};
                    return;
                } else if (JestPrettyFormat.printAsymmetricMatcher(this, Format, &writer, writer_, name_buf, value, enable_ansi_colors)) {
                    return;
                } else if (jsType != .DOMWrapper) {
                    if (value.isCallable(this.globalThis.vm())) {
                        return this.printAs(.Function, Writer, writer_, value, jsType, enable_ansi_colors);
                    }

                    return this.printAs(.Object, Writer, writer_, value, jsType, enable_ansi_colors);
                }
                return this.printAs(.Object, Writer, writer_, value, .Event, enable_ansi_colors);
            },
            .NativeCode => {
                this.addForNewLine("[native code]".len);
                writer.writeAll("[native code]");
            },
            .Promise => {
                if (!this.single_line and this.goodTimeForANewLine()) {
                    writer.writeAll("\n");
                    this.writeIndent(Writer, writer_) catch {};
                }

                writer.writeAll("Promise { " ++ comptime Output.prettyFmt("<r><cyan>", enable_ansi_colors));

                switch (JSPromise.status(@as(*JSPromise, @ptrCast(value.asObjectRef().?)), this.globalThis.vm())) {
                    JSPromise.Status.Pending => {
                        writer.writeAll("<pending>");
                    },
                    JSPromise.Status.Fulfilled => {
                        writer.writeAll("<resolved>");
                    },
                    JSPromise.Status.Rejected => {
                        writer.writeAll("<rejected>");
                    },
                }

                writer.writeAll(comptime Output.prettyFmt("<r>", enable_ansi_colors) ++ " }");
            },
            .Boolean => {
                if (value.isCell()) {
                    var bool_name = ZigString.Empty;
                    value.getClassName(this.globalThis, &bool_name);
                    var bool_value = ZigString.Empty;
                    value.toZigString(&bool_value, this.globalThis);

                    if (!strings.eqlComptime(bool_name.slice(), "Boolean")) {
                        this.addForNewLine(bool_value.len + bool_name.len + "[Boolean (): ]".len);
                        writer.print(comptime Output.prettyFmt("<r><yellow>[Boolean ({s}): {s}]<r>", enable_ansi_colors), .{
                            bool_name,
                            bool_value,
                        });
                        return;
                    }
                    this.addForNewLine(bool_value.len + "[Boolean: ]".len);
                    writer.print(comptime Output.prettyFmt("<r><yellow>[Boolean: {s}]<r>", enable_ansi_colors), .{bool_value});
                    return;
                }
                if (value.toBoolean()) {
                    this.addForNewLine(4);
                    writer.writeAll(comptime Output.prettyFmt("<r><yellow>true<r>", enable_ansi_colors));
                } else {
                    this.addForNewLine(5);
                    writer.writeAll(comptime Output.prettyFmt("<r><yellow>false<r>", enable_ansi_colors));
                }
            },
            .GlobalObject => {
                const fmt = "[Global Object]";
                this.addForNewLine(fmt.len);
                writer.writeAll(comptime Output.prettyFmt("<cyan>" ++ fmt ++ "<r>", enable_ansi_colors));
            },
            .Map => {
                const length_value = value.get(this.globalThis, "size") orelse JSC.JSValue.jsNumberFromInt32(0);
                const length = length_value.toInt32();

                const prev_quote_strings = this.quote_strings;
                this.quote_strings = true;
                defer this.quote_strings = prev_quote_strings;

                const map_name = if (value.jsType() == .JSWeakMap) "WeakMap" else "Map";

                if (length == 0) {
                    return writer.print("{s} {{}}", .{map_name});
                }

                switch (this.single_line) {
                    inline else => |single_line| {
                        writer.print("{s}({d}) {{" ++ (if (single_line) " " else "\n"), .{ map_name, length });
                    },
                }
                {
                    this.indent += 1;
                    this.depth +|= 1;
                    defer this.indent -|= 1;
                    defer this.depth -|= 1;
                    switch (this.single_line) {
                        inline else => |single_line| {
                            var iter = MapIterator(Writer, enable_ansi_colors, false, single_line){
                                .formatter = this,
                                .writer = writer_,
                            };
                            value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                            if (single_line and iter.count > 0) {
                                writer.writeAll(" ");
                            }
                        },
                    }
                }
                if (!this.single_line) {
                    this.writeIndent(Writer, writer_) catch {};
                }
                writer.writeAll("}");
            },
            .MapIterator => {
                const prev_quote_strings = this.quote_strings;
                this.quote_strings = true;
                defer this.quote_strings = prev_quote_strings;

                writer.print("MapIterator {{ ", .{});
                {
                    this.indent += 1;
                    this.depth +|= 1;
                    defer this.indent -|= 1;
                    defer this.depth -|= 1;
                    switch (this.single_line) {
                        inline else => |single_line| {
                            var iter = MapIterator(Writer, enable_ansi_colors, true, single_line){
                                .formatter = this,
                                .writer = writer_,
                            };
                            value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                            if (iter.count > 0) {
                                if (single_line) {
                                    writer.writeAll(" ");
                                } else {
                                    writer.writeAll("\n");
                                }
                            }
                        },
                    }
                }
                if (!this.single_line) {
                    this.writeIndent(Writer, writer_) catch {};
                }
                writer.writeAll("}");
            },
            .SetIterator => {
                const prev_quote_strings = this.quote_strings;
                this.quote_strings = true;
                defer this.quote_strings = prev_quote_strings;

                writer.print("SetIterator {{ ", .{});
                {
                    this.indent += 1;
                    this.depth +|= 1;
                    defer this.indent -|= 1;
                    defer this.depth -|= 1;
                    switch (this.single_line) {
                        inline else => |single_line| {
                            var iter = MapIterator(Writer, enable_ansi_colors, true, single_line){
                                .formatter = this,
                                .writer = writer_,
                            };
                            value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                            if (iter.count > 0 and !single_line) {
                                writer.writeAll("\n");
                            }
                        },
                    }
                }
                if (!this.single_line) {
                    this.writeIndent(Writer, writer_) catch {};
                }
                writer.writeAll("}");
            },
            .Set => {
                const length_value = value.get(this.globalThis, "size") orelse JSC.JSValue.jsNumberFromInt32(0);
                const length = length_value.toInt32();

                const prev_quote_strings = this.quote_strings;
                this.quote_strings = true;
                defer this.quote_strings = prev_quote_strings;

                if (!this.single_line) {
                    this.writeIndent(Writer, writer_) catch {};
                }

                const set_name = if (value.jsType() == .JSWeakSet) "WeakSet" else "Set";

                if (length == 0) {
                    return writer.print("{s} {{}}", .{set_name});
                }

                switch (this.single_line) {
                    inline else => |single_line| {
                        writer.print("{s}({d}) {{" ++ (if (single_line) " " else "\n"), .{ set_name, length });
                    },
                }
                {
                    this.indent += 1;
                    this.depth +|= 1;
                    defer this.indent -|= 1;
                    defer this.depth -|= 1;
                    switch (this.single_line) {
                        inline else => |single_line| {
                            var iter = SetIterator(Writer, enable_ansi_colors, single_line){
                                .formatter = this,
                                .writer = writer_,
                            };
                            value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                            if (single_line and !iter.is_first) {
                                writer.writeAll(" ");
                            }
                        },
                    }
                }
                if (this.single_line) {
                    this.writeIndent(Writer, writer_) catch {};
                }
                writer.writeAll("}");
            },
            .toJSON => {
                if (value.get(this.globalThis, "toJSON")) |func| {
                    const result = func.callWithThis(this.globalThis, value, &.{});
                    if (result.toError() == null) {
                        const prev_quote_keys = this.quote_keys;
                        this.quote_keys = true;
                        defer this.quote_keys = prev_quote_keys;
                        this.printAs(.Object, Writer, writer_, result, value.jsType(), enable_ansi_colors);
                        return;
                    }
                }

                writer.writeAll("{}");
            },
            .JSON => {
                var str = bun.String.empty;
                defer str.deref();

                value.jsonStringify(this.globalThis, this.indent, &str);
                this.addForNewLine(str.length());
                if (jsType == JSValue.JSType.JSDate) {
                    // in the code for printing dates, it never exceeds this amount
                    var iso_string_buf: [36]u8 = undefined;
                    var out_buf: []const u8 = std.fmt.bufPrint(&iso_string_buf, "{}", .{str}) catch "";

                    if (strings.eql(out_buf, "null")) {
                        out_buf = "Invalid Date";
                    } else if (out_buf.len > 2) {
                        // trim the quotes
                        out_buf = out_buf[1 .. out_buf.len - 1];
                    }

                    writer.print(comptime Output.prettyFmt("<r><magenta>{s}<r>", enable_ansi_colors), .{out_buf});
                    return;
                }

                writer.print("{}", .{str});
            },
            .Event => {
                const event_type = EventType.map.getWithEql(value.get(this.globalThis, "type").?.getZigString(this.globalThis), ZigString.eqlComptime) orelse EventType.unknown;
                if (event_type != .MessageEvent and event_type != .ErrorEvent) {
                    return this.printAs(.Object, Writer, writer_, value, .Event, enable_ansi_colors);
                }

                writer.print(
                    comptime Output.prettyFmt("<r><cyan>{s}<r> {{\n", enable_ansi_colors),
                    .{
                        @tagName(event_type),
                    },
                );
                {
                    this.indent += 1;
                    this.depth +|= 1;
                    defer this.indent -|= 1;
                    defer this.depth -|= 1;
                    const old_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = old_quote_strings;
                    this.writeIndent(Writer, writer_) catch unreachable;

                    switch (this.single_line) {
                        inline else => |single_line| {
                            writer.print(
                                comptime Output.prettyFmt("<r>type: <green>\"{s}\"<r><d>,<r>" ++ (if (single_line) " " else "\n"), enable_ansi_colors),
                                .{
                                    event_type.label(),
                                },
                            );
                            if (!single_line) {
                                this.writeIndent(Writer, writer_) catch unreachable;
                            }
                        },
                    }

                    switch (event_type) {
                        .MessageEvent => {
                            writer.print(
                                comptime Output.prettyFmt("<r><blue>data<d>:<r> ", enable_ansi_colors),
                                .{},
                            );
                            const data = value.get(this.globalThis, "data").?;
                            const tag = Tag.getAdvanced(data, this.globalThis, .{ .hide_global = true });
                            if (tag.cell.isStringLike()) {
                                this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                            } else {
                                this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                            }
                        },
                        .ErrorEvent => {
                            {
                                const error_value = value.get(this.globalThis, "error").?;

                                if (!error_value.isEmptyOrUndefinedOrNull()) {
                                    writer.print(
                                        comptime Output.prettyFmt("<r><blue>error<d>:<r> ", enable_ansi_colors),
                                        .{},
                                    );

                                    const tag = Tag.getAdvanced(error_value, this.globalThis, .{ .hide_global = true });
                                    this.format(tag, Writer, writer_, error_value, this.globalThis, enable_ansi_colors);
                                }
                            }

                            const message_value = value.get(this.globalThis, "message").?;
                            if (message_value.isString()) {
                                writer.print(
                                    comptime Output.prettyFmt("<r><blue>message<d>:<r> ", enable_ansi_colors),
                                    .{},
                                );

                                const tag = Tag.getAdvanced(message_value, this.globalThis, .{ .hide_global = true });
                                this.format(tag, Writer, writer_, message_value, this.globalThis, enable_ansi_colors);
                            }
                        },
                        else => unreachable,
                    }
                    if (!this.single_line) {
                        writer.writeAll("\n");
                    }
                }

                if (!this.single_line) {
                    this.writeIndent(Writer, writer_) catch unreachable;
                }
                writer.writeAll("}");
            },
            .JSX => {
                writer.writeAll(comptime Output.prettyFmt("<r>", enable_ansi_colors));

                writer.writeAll("<");

                var needs_space = false;
                var tag_name_str = ZigString.init("");

                var tag_name_slice: ZigString.Slice = ZigString.Slice.empty;
                var is_tag_kind_primitive = false;

                defer if (tag_name_slice.isAllocated()) tag_name_slice.deinit();

                if (value.get(this.globalThis, "type")) |type_value| {
                    const _tag = Tag.getAdvanced(type_value, this.globalThis, .{ .hide_global = true });

                    if (_tag.cell == .Symbol) {} else if (_tag.cell.isStringLike()) {
                        type_value.toZigString(&tag_name_str, this.globalThis);
                        is_tag_kind_primitive = true;
                    } else if (_tag.cell.isObject() or type_value.isCallable(this.globalThis.vm())) {
                        type_value.getNameProperty(this.globalThis, &tag_name_str);
                        if (tag_name_str.len == 0) {
                            tag_name_str = ZigString.init("NoName");
                        }
                    } else {
                        type_value.toZigString(&tag_name_str, this.globalThis);
                    }

                    tag_name_slice = tag_name_str.toSlice(default_allocator);
                    needs_space = true;
                } else {
                    tag_name_slice = ZigString.init("unknown").toSlice(default_allocator);

                    needs_space = true;
                }

                if (!is_tag_kind_primitive)
                    writer.writeAll(comptime Output.prettyFmt("<cyan>", enable_ansi_colors))
                else
                    writer.writeAll(comptime Output.prettyFmt("<green>", enable_ansi_colors));
                writer.writeAll(tag_name_slice.slice());
                if (enable_ansi_colors) writer.writeAll(comptime Output.prettyFmt("<r>", enable_ansi_colors));

                if (value.get(this.globalThis, "key")) |key_value| {
                    if (!key_value.isUndefinedOrNull()) {
                        if (needs_space)
                            writer.writeAll(" key=")
                        else
                            writer.writeAll("key=");

                        const old_quote_strings = this.quote_strings;
                        this.quote_strings = true;
                        defer this.quote_strings = old_quote_strings;

                        this.format(Tag.getAdvanced(key_value, this.globalThis, .{ .hide_global = true }), Writer, writer_, key_value, this.globalThis, enable_ansi_colors);

                        needs_space = true;
                    }
                }

                if (value.get(this.globalThis, "props")) |props| {
                    const prev_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = prev_quote_strings;

                    var props_iter = JSC.JSPropertyIterator(.{
                        .skip_empty_name = true,

                        .include_value = true,
                    }).init(this.globalThis, props.asObjectRef());
                    defer props_iter.deinit();

                    const children_prop = props.get(this.globalThis, "children");
                    if (props_iter.len > 0) {
                        {
                            this.indent += 1;
                            defer this.indent -|= 1;
                            const count_without_children = props_iter.len - @as(usize, @intFromBool(children_prop != null));

                            while (props_iter.next()) |prop| {
                                if (prop.eqlComptime("children"))
                                    continue;

                                const property_value = props_iter.value;
                                const tag = Tag.getAdvanced(property_value, this.globalThis, .{ .hide_global = true });

                                if (tag.cell.isHidden()) continue;

                                if (needs_space) writer.space();
                                needs_space = false;

                                writer.print(
                                    comptime Output.prettyFmt("<r><blue>{s}<d>=<r>", enable_ansi_colors),
                                    .{prop.trunc(128)},
                                );

                                if (tag.cell.isStringLike()) {
                                    if (comptime enable_ansi_colors) {
                                        writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                                    }
                                }

                                this.format(tag, Writer, writer_, property_value, this.globalThis, enable_ansi_colors);

                                if (tag.cell.isStringLike()) {
                                    if (comptime enable_ansi_colors) {
                                        writer.writeAll(comptime Output.prettyFmt("<r>", true));
                                    }
                                }

                                if (!this.single_line and (
                                // count_without_children is necessary to prevent printing an extra newline
                                // if there are children and one prop and the child prop is the last prop
                                    props_iter.i + 1 < count_without_children and
                                    // 3 is arbitrary but basically
                                    //  <input type="text" value="foo" />
                                    //  ^ should be one line
                                    // <input type="text" value="foo" bar="true" baz={false} />
                                    //  ^ should be multiple lines
                                    props_iter.i > 3))
                                {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch unreachable;
                                } else if (props_iter.i + 1 < count_without_children) {
                                    writer.space();
                                }
                            }
                        }

                        if (children_prop) |children| {
                            const tag = Tag.get(children, this.globalThis);

                            const print_children = switch (tag.tag) {
                                .String, .JSX, .Array => true,
                                else => false,
                            };

                            if (print_children and !this.single_line) {
                                print_children: {
                                    switch (tag.tag) {
                                        .String => {
                                            const children_string = children.getZigString(this.globalThis);
                                            if (children_string.len == 0) break :print_children;
                                            if (comptime enable_ansi_colors) writer.writeAll(comptime Output.prettyFmt("<r>", true));

                                            writer.writeAll(">");
                                            if (children_string.len < 128) {
                                                writer.writeString(children_string);
                                            } else {
                                                this.indent += 1;
                                                writer.writeAll("\n");
                                                this.writeIndent(Writer, writer_) catch unreachable;
                                                this.indent -|= 1;
                                                writer.writeString(children_string);
                                                writer.writeAll("\n");
                                                this.writeIndent(Writer, writer_) catch unreachable;
                                            }
                                        },
                                        .JSX => {
                                            writer.writeAll(">\n");

                                            {
                                                this.indent += 1;
                                                this.writeIndent(Writer, writer_) catch unreachable;
                                                defer this.indent -|= 1;
                                                this.format(Tag.get(children, this.globalThis), Writer, writer_, children, this.globalThis, enable_ansi_colors);
                                            }

                                            writer.writeAll("\n");
                                            this.writeIndent(Writer, writer_) catch unreachable;
                                        },
                                        .Array => {
                                            const length = children.getLength(this.globalThis);
                                            if (length == 0) break :print_children;
                                            writer.writeAll(">\n");

                                            {
                                                this.indent += 1;
                                                this.writeIndent(Writer, writer_) catch unreachable;
                                                const _prev_quote_strings = this.quote_strings;
                                                this.quote_strings = false;
                                                defer this.quote_strings = _prev_quote_strings;

                                                defer this.indent -|= 1;

                                                var j: usize = 0;
                                                while (j < length) : (j += 1) {
                                                    const child = JSC.JSObject.getIndex(children, this.globalThis, @as(u32, @intCast(j)));
                                                    this.format(Tag.getAdvanced(child, this.globalThis, .{ .hide_global = true }), Writer, writer_, child, this.globalThis, enable_ansi_colors);
                                                    if (j + 1 < length) {
                                                        writer.writeAll("\n");
                                                        this.writeIndent(Writer, writer_) catch unreachable;
                                                    }
                                                }
                                            }

                                            writer.writeAll("\n");
                                            this.writeIndent(Writer, writer_) catch unreachable;
                                        },
                                        else => unreachable,
                                    }

                                    writer.writeAll("</");
                                    if (!is_tag_kind_primitive)
                                        writer.writeAll(comptime Output.prettyFmt("<r><cyan>", enable_ansi_colors))
                                    else
                                        writer.writeAll(comptime Output.prettyFmt("<r><green>", enable_ansi_colors));
                                    writer.writeAll(tag_name_slice.slice());
                                    if (enable_ansi_colors) writer.writeAll(comptime Output.prettyFmt("<r>", enable_ansi_colors));
                                    writer.writeAll(">");
                                }

                                return;
                            }
                        }
                    }
                }

                writer.writeAll(" />");
            },
            .Object => {
                const prev_quote_strings = this.quote_strings;
                this.quote_strings = true;
                defer this.quote_strings = prev_quote_strings;

                const Iterator = PropertyIterator(Writer, enable_ansi_colors);

                // We want to figure out if we should print this object
                // on one line or multiple lines
                //
                // The 100% correct way would be to print everything to
                // a temporary buffer and then check how long each line was
                //
                // But it's important that console.log() is fast. So we
                // do a small compromise to avoid multiple passes over input
                //
                // We say:
                //
                //   If the object has at least 2 properties and ANY of the following conditions are met:
                //      - total length of all the property names is more than
                //        14 characters
                //     - the parent object is printing each property on a new line
                //     - The first property is a DOM object, ESM namespace, Map, Set, or Blob
                //
                //   Then, we print it each property on a new line, recursively.
                //
                const prev_always_newline_scope = this.always_newline_scope;
                defer this.always_newline_scope = prev_always_newline_scope;
                var iter = Iterator{
                    .formatter = this,
                    .writer = writer_,
                    .always_newline = !this.single_line and (this.always_newline_scope or this.goodTimeForANewLine()),
                    .single_line = this.single_line,
                    .parent = value,
                };

                if (this.depth > this.max_depth) {
                    if (this.single_line) {
                        writer.writeAll(" ");
                    } else if (this.always_newline_scope or this.goodTimeForANewLine()) {
                        writer.writeAll("\n");
                        this.writeIndent(Writer, writer_) catch {};
                        this.resetLine();
                    }

                    var display_name = value.getName(this.globalThis);
                    if (display_name.isEmpty()) {
                        display_name = String.static("Object");
                    }
                    writer.print(comptime Output.prettyFmt("<r><cyan>[{} ...]<r>", enable_ansi_colors), .{
                        display_name,
                    });
                    return;
                } else if (this.ordered_properties) {
                    value.forEachPropertyOrdered(this.globalThis, &iter, Iterator.forEach);
                } else {
                    value.forEachProperty(this.globalThis, &iter, Iterator.forEach);
                }

                if (iter.i == 0) {
                    if (value.isClass(this.globalThis))
                        this.printAs(.Class, Writer, writer_, value, jsType, enable_ansi_colors)
                    else if (value.isCallable(this.globalThis.vm()))
                        this.printAs(.Function, Writer, writer_, value, jsType, enable_ansi_colors)
                    else {
                        if (getObjectName(this.globalThis, value)) |name_str| {
                            writer.print("{} ", .{name_str});
                        }
                        writer.writeAll("{}");
                    }
                } else {
                    this.depth -= 1;

                    if (iter.always_newline) {
                        this.indent -|= 1;
                        this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                        writer.writeAll("\n");
                        this.writeIndent(Writer, writer_) catch {};
                        writer.writeAll("}");
                        this.estimated_line_length += 1;
                    } else {
                        this.estimated_line_length += 2;
                        writer.writeAll(" }");
                    }
                }
            },
            .TypedArray => {
                const arrayBuffer = value.asArrayBuffer(this.globalThis).?;
                const slice = arrayBuffer.byteSlice();

                writer.writeAll(
                    if (arrayBuffer.typed_array_type == .Uint8Array and
                        arrayBuffer.value.isBuffer(this.globalThis))
                        "Buffer"
                    else
                        bun.asByteSlice(@tagName(arrayBuffer.typed_array_type)),
                );
                writer.print("({d}) [ ", .{arrayBuffer.len});

                if (slice.len > 0) {
                    switch (jsType) {
                        .Int8Array => this.writeTypedArray(
                            *@TypeOf(writer),
                            &writer,
                            i8,
                            @as([]align(std.meta.alignment([]i8)) i8, @alignCast(std.mem.bytesAsSlice(i8, slice))),
                            enable_ansi_colors,
                        ),
                        .Int16Array => this.writeTypedArray(
                            *@TypeOf(writer),
                            &writer,
                            i16,
                            @as([]align(std.meta.alignment([]i16)) i16, @alignCast(std.mem.bytesAsSlice(i16, slice))),
                            enable_ansi_colors,
                        ),
                        .Uint16Array => this.writeTypedArray(
                            *@TypeOf(writer),
                            &writer,
                            u16,
                            @as([]align(std.meta.alignment([]u16)) u16, @alignCast(std.mem.bytesAsSlice(u16, slice))),
                            enable_ansi_colors,
                        ),
                        .Int32Array => this.writeTypedArray(
                            *@TypeOf(writer),
                            &writer,
                            i32,
                            @as([]align(std.meta.alignment([]i32)) i32, @alignCast(std.mem.bytesAsSlice(i32, slice))),
                            enable_ansi_colors,
                        ),
                        .Uint32Array => this.writeTypedArray(
                            *@TypeOf(writer),
                            &writer,
                            u32,
                            @as([]align(std.meta.alignment([]u32)) u32, @alignCast(std.mem.bytesAsSlice(u32, slice))),
                            enable_ansi_colors,
                        ),
                        .Float32Array => this.writeTypedArray(
                            *@TypeOf(writer),
                            &writer,
                            f32,
                            @as([]align(std.meta.alignment([]f32)) f32, @alignCast(std.mem.bytesAsSlice(f32, slice))),
                            enable_ansi_colors,
                        ),
                        .Float64Array => this.writeTypedArray(
                            *@TypeOf(writer),
                            &writer,
                            f64,
                            @as([]align(std.meta.alignment([]f64)) f64, @alignCast(std.mem.bytesAsSlice(f64, slice))),
                            enable_ansi_colors,
                        ),
                        .BigInt64Array => this.writeTypedArray(
                            *@TypeOf(writer),
                            &writer,
                            i64,
                            @as([]align(std.meta.alignment([]i64)) i64, @alignCast(std.mem.bytesAsSlice(i64, slice))),
                            enable_ansi_colors,
                        ),
                        .BigUint64Array => {
                            this.writeTypedArray(
                                *@TypeOf(writer),
                                &writer,
                                u64,
                                @as([]align(std.meta.alignment([]u64)) u64, @alignCast(std.mem.bytesAsSlice(u64, slice))),
                                enable_ansi_colors,
                            );
                        },

                        // Uint8Array, Uint8ClampedArray, DataView, ArrayBuffer
                        else => this.writeTypedArray(*@TypeOf(writer), &writer, u8, slice, enable_ansi_colors),
                    }
                }

                writer.writeAll(" ]");
            },
            else => {},
        }
    }

    fn writeTypedArray(this: *ConsoleObject.Formatter, comptime WriterWrapped: type, writer: WriterWrapped, comptime Number: type, slice: []const Number, comptime enable_ansi_colors: bool) void {
        const fmt_ = if (Number == i64 or Number == u64)
            "<r><yellow>{d}n<r>"
        else
            "<r><yellow>{d}<r>";
        const more = if (Number == i64 or Number == u64)
            "<r><d>n, ... {d} more<r>"
        else
            "<r><d>, ... {d} more<r>";

        writer.print(comptime Output.prettyFmt(fmt_, enable_ansi_colors), .{slice[0]});
        var leftover = slice[1..];
        const max = 512;
        leftover = leftover[0..@min(leftover.len, max)];
        for (leftover) |el| {
            this.printComma(@TypeOf(&writer.ctx), &writer.ctx, enable_ansi_colors) catch return;
            writer.space();

            writer.print(comptime Output.prettyFmt(fmt_, enable_ansi_colors), .{el});
        }

        if (slice.len > max + 1) {
            writer.print(comptime Output.prettyFmt(more, enable_ansi_colors), .{slice.len - max - 1});
        }
    }

    pub fn format(this: *ConsoleObject.Formatter, result: Tag.Result, comptime Writer: type, writer: Writer, value: JSValue, globalThis: *JSGlobalObject, comptime enable_ansi_colors: bool) void {
        if (comptime is_bindgen) {
            return;
        }
        const prevGlobalThis = this.globalThis;
        defer this.globalThis = prevGlobalThis;
        this.globalThis = globalThis;

        // This looks incredibly redundant. We make the ConsoleObject.Formatter.Tag a
        // comptime var so we have to repeat it here. The rationale there is
        // it _should_ limit the stack usage because each version of the
        // function will be relatively small
        switch (result.tag) {
            .StringPossiblyFormatted => this.printAs(.StringPossiblyFormatted, Writer, writer, value, result.cell, enable_ansi_colors),
            .String => this.printAs(.String, Writer, writer, value, result.cell, enable_ansi_colors),
            .Undefined => this.printAs(.Undefined, Writer, writer, value, result.cell, enable_ansi_colors),
            .Double => this.printAs(.Double, Writer, writer, value, result.cell, enable_ansi_colors),
            .Integer => this.printAs(.Integer, Writer, writer, value, result.cell, enable_ansi_colors),
            .Null => this.printAs(.Null, Writer, writer, value, result.cell, enable_ansi_colors),
            .Boolean => this.printAs(.Boolean, Writer, writer, value, result.cell, enable_ansi_colors),
            .Array => this.printAs(.Array, Writer, writer, value, result.cell, enable_ansi_colors),
            .Object => this.printAs(.Object, Writer, writer, value, result.cell, enable_ansi_colors),
            .Function => this.printAs(.Function, Writer, writer, value, result.cell, enable_ansi_colors),
            .Class => this.printAs(.Class, Writer, writer, value, result.cell, enable_ansi_colors),
            .Error => this.printAs(.Error, Writer, writer, value, result.cell, enable_ansi_colors),
            .ArrayBuffer, .TypedArray => this.printAs(.TypedArray, Writer, writer, value, result.cell, enable_ansi_colors),
            .Map => this.printAs(.Map, Writer, writer, value, result.cell, enable_ansi_colors),
            .MapIterator => this.printAs(.MapIterator, Writer, writer, value, result.cell, enable_ansi_colors),
            .SetIterator => this.printAs(.SetIterator, Writer, writer, value, result.cell, enable_ansi_colors),
            .Set => this.printAs(.Set, Writer, writer, value, result.cell, enable_ansi_colors),
            .Symbol => this.printAs(.Symbol, Writer, writer, value, result.cell, enable_ansi_colors),
            .BigInt => this.printAs(.BigInt, Writer, writer, value, result.cell, enable_ansi_colors),
            .GlobalObject => this.printAs(.GlobalObject, Writer, writer, value, result.cell, enable_ansi_colors),
            .Private => this.printAs(.Private, Writer, writer, value, result.cell, enable_ansi_colors),
            .Promise => this.printAs(.Promise, Writer, writer, value, result.cell, enable_ansi_colors),

            // Call JSON.stringify on the value
            .JSON => this.printAs(.JSON, Writer, writer, value, result.cell, enable_ansi_colors),

            // Call value.toJSON() and print as an object
            .toJSON => this.printAs(.toJSON, Writer, writer, value, result.cell, enable_ansi_colors),

            .NativeCode => this.printAs(.NativeCode, Writer, writer, value, result.cell, enable_ansi_colors),
            .JSX => this.printAs(.JSX, Writer, writer, value, result.cell, enable_ansi_colors),
            .Event => this.printAs(.Event, Writer, writer, value, result.cell, enable_ansi_colors),
            .Getter => this.printAs(.Getter, Writer, writer, value, result.cell, enable_ansi_colors),

            .CustomFormattedObject => |callback| {
                this.custom_formatted_object = callback;
                this.printAs(.CustomFormattedObject, Writer, writer, value, result.cell, enable_ansi_colors);
            },
        }
    }
};

pub fn count(
    // console
    _: ConsoleObject.Type,
    // global
    globalThis: *JSGlobalObject,
    // chars
    ptr: [*]const u8,
    // len
    len: usize,
) callconv(.C) void {
    var this = globalThis.bunVM().console;
    const slice = ptr[0..len];
    const hash = bun.hash(slice);
    // we don't want to store these strings, it will take too much memory
    const counter = this.counts.getOrPut(globalThis.allocator(), hash) catch unreachable;
    const current = @as(u32, if (counter.found_existing) counter.value_ptr.* else @as(u32, 0)) + 1;
    counter.value_ptr.* = current;

    var writer_ctx = &this.writer;
    var writer = &writer_ctx.writer();
    if (Output.enable_ansi_colors_stdout)
        writer.print(comptime Output.prettyFmt("<r>{s}<d>: <r><yellow>{d}<r>\n", true), .{ slice, current }) catch unreachable
    else
        writer.print(comptime Output.prettyFmt("<r>{s}<d>: <r><yellow>{d}<r>\n", false), .{ slice, current }) catch unreachable;
    writer_ctx.flush() catch unreachable;
}
pub fn countReset(
    // console
    _: ConsoleObject.Type,
    // global
    globalThis: *JSGlobalObject,
    // chars
    ptr: [*]const u8,
    // len
    len: usize,
) callconv(.C) void {
    var this = globalThis.bunVM().console;
    const slice = ptr[0..len];
    const hash = bun.hash(slice);
    // we don't delete it because deleting is implemented via tombstoning
    const entry = this.counts.getEntry(hash) orelse return;
    entry.value_ptr.* = 0;
}

const PendingTimers = std.AutoHashMap(u64, ?std.time.Timer);
threadlocal var pending_time_logs: PendingTimers = undefined;
threadlocal var pending_time_logs_loaded = false;

pub fn time(
    // console
    _: ConsoleObject.Type,
    // global
    _: *JSGlobalObject,
    chars: [*]const u8,
    len: usize,
) callconv(.C) void {
    const id = bun.hash(chars[0..len]);
    if (!pending_time_logs_loaded) {
        pending_time_logs = PendingTimers.init(default_allocator);
        pending_time_logs_loaded = true;
    }

    const result = pending_time_logs.getOrPut(id) catch unreachable;

    if (!result.found_existing or (result.found_existing and result.value_ptr.* == null)) {
        result.value_ptr.* = std.time.Timer.start() catch unreachable;
    }
}
pub fn timeEnd(
    // console
    _: ConsoleObject.Type,
    // global
    _: *JSGlobalObject,
    chars: [*]const u8,
    len: usize,
) callconv(.C) void {
    if (!pending_time_logs_loaded) {
        return;
    }

    const id = bun.hash(chars[0..len]);
    const result = (pending_time_logs.fetchPut(id, null) catch null) orelse return;
    var value: std.time.Timer = result.value orelse return;
    // get the duration in microseconds
    // then display it in milliseconds
    Output.printElapsed(@as(f64, @floatFromInt(value.read() / std.time.ns_per_us)) / std.time.us_per_ms);
    switch (len) {
        0 => Output.printErrorln("\n", .{}),
        else => Output.printErrorln(" {s}", .{chars[0..len]}),
    }

    Output.flush();
}

pub fn timeLog(
    // console
    _: ConsoleObject.Type,
    // global
    global: *JSGlobalObject,
    // chars
    chars: [*]const u8,
    // len
    len: usize,
    // args
    args: [*]JSValue,
    args_len: usize,
) callconv(.C) void {
    if (!pending_time_logs_loaded) {
        return;
    }

    const id = bun.hash(chars[0..len]);
    var value: std.time.Timer = (pending_time_logs.get(id) orelse return) orelse return;
    // get the duration in microseconds
    // then display it in milliseconds
    Output.printElapsed(@as(f64, @floatFromInt(value.read() / std.time.ns_per_us)) / std.time.us_per_ms);
    switch (len) {
        0 => {},
        else => Output.printError(" {s}", .{chars[0..len]}),
    }
    Output.flush();

    // print the arguments
    var fmt = ConsoleObject.Formatter{
        .remaining_values = &[_]JSValue{},
        .globalThis = global,
        .ordered_properties = false,
        .quote_strings = false,
    };
    var console = global.bunVM().console;
    var writer = console.error_writer.writer();
    const Writer = @TypeOf(writer);
    for (args[0..args_len]) |arg| {
        const tag = ConsoleObject.Formatter.Tag.get(arg, global);
        _ = writer.write(" ") catch 0;
        if (Output.enable_ansi_colors_stderr) {
            fmt.format(tag, Writer, writer, arg, global, true);
        } else {
            fmt.format(tag, Writer, writer, arg, global, false);
        }
    }
    _ = writer.write("\n") catch 0;
    writer.context.flush() catch {};
}
pub fn profile(
    // console
    _: ConsoleObject.Type,
    // global
    _: *JSGlobalObject,
    // chars
    _: [*]const u8,
    // len
    _: usize,
) callconv(.C) void {}
pub fn profileEnd(
    // console
    _: ConsoleObject.Type,
    // global
    _: *JSGlobalObject,
    // chars
    _: [*]const u8,
    // len
    _: usize,
) callconv(.C) void {}
pub fn takeHeapSnapshot(
    // console
    _: ConsoleObject.Type,
    // global
    globalThis: *JSGlobalObject,
    // chars
    _: [*]const u8,
    // len
    _: usize,
) callconv(.C) void {
    // TODO: this does an extra JSONStringify and we don't need it to!
    var snapshot: [1]JSValue = .{globalThis.generateHeapSnapshot()};
    ConsoleObject.messageWithTypeAndLevel(undefined, MessageType.Log, MessageLevel.Debug, globalThis, &snapshot, 1);
}
pub fn timeStamp(
    // console
    _: ConsoleObject.Type,
    // global
    _: *JSGlobalObject,
    // args
    _: *ScriptArguments,
) callconv(.C) void {}
pub fn record(
    // console
    _: ConsoleObject.Type,
    // global
    _: *JSGlobalObject,
    // args
    _: *ScriptArguments,
) callconv(.C) void {}
pub fn recordEnd(
    // console
    _: ConsoleObject.Type,
    // global
    _: *JSGlobalObject,
    // args
    _: *ScriptArguments,
) callconv(.C) void {}
pub fn screenshot(
    // console
    _: ConsoleObject.Type,
    // global
    _: *JSGlobalObject,
    // args
    _: *ScriptArguments,
) callconv(.C) void {}

pub const Export = shim.exportFunctions(.{
    .messageWithTypeAndLevel = messageWithTypeAndLevel,
    .count = count,
    .countReset = countReset,
    .time = time,
    .timeLog = timeLog,
    .timeEnd = timeEnd,
    .profile = profile,
    .profileEnd = profileEnd,
    .takeHeapSnapshot = takeHeapSnapshot,
    .timeStamp = timeStamp,
    .record = record,
    .recordEnd = recordEnd,
    .screenshot = screenshot,
});

comptime {
    @export(messageWithTypeAndLevel, .{
        .name = Export[0].symbol_name,
    });
    @export(count, .{
        .name = Export[1].symbol_name,
    });
    @export(countReset, .{
        .name = Export[2].symbol_name,
    });
    @export(time, .{
        .name = Export[3].symbol_name,
    });
    @export(timeLog, .{
        .name = Export[4].symbol_name,
    });
    @export(timeEnd, .{
        .name = Export[5].symbol_name,
    });
    @export(profile, .{
        .name = Export[6].symbol_name,
    });
    @export(profileEnd, .{
        .name = Export[7].symbol_name,
    });
    @export(takeHeapSnapshot, .{
        .name = Export[8].symbol_name,
    });
    @export(timeStamp, .{
        .name = Export[9].symbol_name,
    });
    @export(record, .{
        .name = Export[10].symbol_name,
    });
    @export(recordEnd, .{
        .name = Export[11].symbol_name,
    });
    @export(screenshot, .{
        .name = Export[12].symbol_name,
    });
}
