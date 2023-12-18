const std = @import("std");
const bun = @import("root").bun;
const Output = bun.Output;
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const default_allocator = bun.default_allocator;
const CAPI = JSC.C;
const ZigString = JSC.ZigString;
const strings = bun.strings;
const string = bun.string;
const JSLexer = bun.js_lexer;
const JSPrinter = bun.js_printer;
const JSPrivateDataPtr = JSC.JSPrivateDataPtr;
const JS = @import("../javascript.zig");
const JSPromise = JSC.JSPromise;
const expect = @import("./expect.zig");

pub const EventType = enum(u8) {
    Event,
    MessageEvent,
    CloseEvent,
    ErrorEvent,
    OpenEvent,
    unknown = 254,
    _,

    pub const map = bun.ComptimeStringMap(EventType, .{
        .{ EventType.Event.label(), EventType.Event },
        .{ EventType.MessageEvent.label(), EventType.MessageEvent },
        .{ EventType.CloseEvent.label(), EventType.CloseEvent },
        .{ EventType.ErrorEvent.label(), EventType.ErrorEvent },
        .{ EventType.OpenEvent.label(), EventType.OpenEvent },
    });

    pub fn label(this: EventType) string {
        return switch (this) {
            .Event => "event",
            .MessageEvent => "message",
            .CloseEvent => "close",
            .ErrorEvent => "error",
            .OpenEvent => "open",
            else => "event",
        };
    }
};

pub const JestPrettyFormat = struct {
    pub const Type = *anyopaque;
    const Counter = std.AutoHashMapUnmanaged(u64, u32);

    counts: Counter = .{},

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

    pub const FormatOptions = struct {
        enable_colors: bool,
        add_newline: bool,
        flush: bool,
        quote_strings: bool = false,
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
        var fmt: JestPrettyFormat.Formatter = undefined;
        defer {
            if (fmt.map_node) |node| {
                node.data = fmt.map;
                node.data.clearRetainingCapacity();
                node.release();
            }
        }

        if (len == 1) {
            fmt = JestPrettyFormat.Formatter{
                .remaining_values = &[_]JSValue{},
                .globalThis = global,
                .quote_strings = options.quote_strings,
            };
            const tag = JestPrettyFormat.Formatter.Tag.get(vals[0], global);

            var unbuffered_writer = if (comptime Writer != RawWriter)
                writer.context.unbuffered_writer.context.writer()
            else
                writer;

            if (tag.tag == .String) {
                if (options.enable_colors) {
                    if (level == .Error) {
                        unbuffered_writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch unreachable;
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
                        unbuffered_writer.writeAll(comptime Output.prettyFmt("<r>", true)) catch unreachable;
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
        fmt = JestPrettyFormat.Formatter{
            .remaining_values = vals[0..len][1..],
            .globalThis = global,
            .quote_strings = options.quote_strings,
        };
        var tag: JestPrettyFormat.Formatter.Tag.Result = undefined;

        var any = false;
        if (options.enable_colors) {
            if (level == .Error) {
                writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch unreachable;
            }
            while (true) {
                if (any) {
                    _ = writer.write(" ") catch 0;
                }
                any = true;

                tag = JestPrettyFormat.Formatter.Tag.get(this_value, global);
                if (tag.tag == .String and fmt.remaining_values.len > 0) {
                    tag.tag = .StringPossiblyFormatted;
                }

                fmt.format(tag, Writer, writer, this_value, global, true);
                if (fmt.remaining_values.len == 0) {
                    break;
                }

                this_value = fmt.remaining_values[0];
                fmt.remaining_values = fmt.remaining_values[1..];
            }
            if (level == .Error) {
                writer.writeAll(comptime Output.prettyFmt("<r>", true)) catch unreachable;
            }
        } else {
            while (true) {
                if (any) {
                    _ = writer.write(" ") catch 0;
                }
                any = true;
                tag = JestPrettyFormat.Formatter.Tag.get(this_value, global);
                if (tag.tag == .String and fmt.remaining_values.len > 0) {
                    tag.tag = .StringPossiblyFormatted;
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

    pub const Formatter = struct {
        remaining_values: []const JSValue = &[_]JSValue{},
        map: Visited.Map = undefined,
        map_node: ?*Visited.Pool.Node = null,
        hide_native: bool = false,
        globalThis: *JSGlobalObject,
        indent: u32 = 0,
        quote_strings: bool = false,
        failed: bool = false,
        estimated_line_length: usize = 0,
        always_newline_scope: bool = false,

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
            formatter: *JestPrettyFormat.Formatter,
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
            const ObjectPool = @import("../../pool.zig").ObjectPool;
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
            Set,
            Symbol,
            BigInt,

            GlobalObject,
            Private,
            Promise,

            JSON,
            NativeCode,
            ArrayBuffer,

            JSX,
            Event,

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
                tag: Tag,
                cell: JSValue.JSType = JSValue.JSType.Cell,
            };

            pub fn get(value: JSValue, globalThis: *JSGlobalObject) Result {
                switch (@intFromEnum(value)) {
                    0, 0xa => return Result{
                        .tag = .Undefined,
                    },
                    0x2 => return Result{
                        .tag = .Null,
                    },
                    else => {},
                }

                if (value.isInt32()) {
                    return .{
                        .tag = .Integer,
                    };
                } else if (value.isNumber()) {
                    return .{
                        .tag = .Double,
                    };
                } else if (value.isBoolean()) {
                    return .{
                        .tag = .Boolean,
                    };
                }

                if (!value.isCell())
                    return .{
                        .tag = .NativeCode,
                    };

                const js_type = value.jsType();

                if (js_type.isHidden()) return .{
                    .tag = .NativeCode,
                    .cell = js_type,
                };

                // Cell is the "unknown" type
                // if we call JSObjectGetPrivate, it can segfault
                if (js_type == .Cell) {
                    return .{
                        .tag = .NativeCode,
                        .cell = js_type,
                    };
                }

                if (js_type == .DOMWrapper) {
                    return .{
                        .tag = .Private,
                        .cell = js_type,
                    };
                }

                if (CAPI.JSObjectGetPrivate(value.asObjectRef()) != null)
                    return .{
                        .tag = .Private,
                        .cell = js_type,
                    };

                // If we check an Object has a method table and it does not
                // it will crash
                if (js_type != .Object and value.isCallable(globalThis.vm())) {
                    if (value.isClass(globalThis)) {
                        return .{
                            .tag = .Class,
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
                    return Tag.get(
                        JSC.JSValue.c(JSC.C.JSObjectGetProxyTarget(value.asObjectRef())),
                        globalThis,
                    );
                }

                // Is this a react element?
                if (js_type.isObject()) {
                    if (value.get(globalThis, "$$typeof")) |typeof_symbol| {
                        var reactElement = ZigString.init("react.element");
                        var react_fragment = ZigString.init("react.fragment");

                        if (JSValue.isSameValue(typeof_symbol, JSValue.symbolFor(globalThis, &reactElement), globalThis) or JSValue.isSameValue(typeof_symbol, JSValue.symbolFor(globalThis, &react_fragment), globalThis)) {
                            return .{ .tag = .JSX, .cell = js_type };
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
                        JSValue.JSType.JSWeakSet, JSValue.JSType.JSSet => .Set,
                        JSValue.JSType.JSDate => .JSON,
                        JSValue.JSType.JSPromise => .Promise,
                        JSValue.JSType.Object,
                        JSValue.JSType.FinalObject,
                        .ModuleNamespaceObject,
                        .GlobalObject,
                        => .Object,

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
                        .GetterSetter,
                        .CustomGetterSetter,
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

                        else => .JSON,
                    },
                    .cell = js_type,
                };
            }
        };

        const CellType = CAPI.CellType;
        threadlocal var name_buf: [512]u8 = undefined;

        fn writeWithFormatting(
            this: *JestPrettyFormat.Formatter,
            comptime Writer: type,
            writer_: Writer,
            comptime Slice: type,
            slice_: Slice,
            globalThis: *JSGlobalObject,
            comptime enable_ansi_colors: bool,
        ) void {
            var writer = WrappedWriter(Writer){ .ctx = writer_ };
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
                estimated_line_length: *usize = undefined,

                pub fn print(self: *@This(), comptime fmt: string, args: anytype) void {
                    self.ctx.print(fmt, args) catch {
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
                    strings.formatUTF16Type([]const u16, input, self.ctx) catch {
                        self.failed = true;
                    };
                }
            };
        }

        pub fn writeIndent(
            this: *JestPrettyFormat.Formatter,
            comptime Writer: type,
            writer: Writer,
        ) !void {
            const indent = @min(this.indent, 32);
            var buf = [_]u8{' '} ** 64;
            var total_remain: usize = indent;
            while (total_remain > 0) {
                const written = @min(32, total_remain);
                try writer.writeAll(buf[0 .. written * 2]);
                total_remain -|= written;
            }
        }

        pub fn printComma(this: *JestPrettyFormat.Formatter, comptime Writer: type, writer: Writer, comptime enable_ansi_colors: bool) !void {
            try writer.writeAll(comptime Output.prettyFmt("<r><d>,<r>", enable_ansi_colors));
            this.estimated_line_length += 1;
        }

        pub fn MapIterator(comptime Writer: type, comptime enable_ansi_colors: bool) type {
            return struct {
                formatter: *JestPrettyFormat.Formatter,
                writer: Writer,
                pub fn forEach(_: [*c]JSC.VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void {
                    var this: *@This() = bun.cast(*@This(), ctx orelse return);
                    const key = JSC.JSObject.getIndex(nextValue, globalObject, 0);
                    const value = JSC.JSObject.getIndex(nextValue, globalObject, 1);
                    this.formatter.writeIndent(Writer, this.writer) catch unreachable;
                    const key_tag = Tag.get(key, globalObject);

                    this.formatter.format(
                        key_tag,
                        Writer,
                        this.writer,
                        key,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );
                    this.writer.writeAll(" => ") catch unreachable;
                    const value_tag = Tag.get(value, globalObject);
                    this.formatter.format(
                        value_tag,
                        Writer,
                        this.writer,
                        value,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );
                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch unreachable;
                    this.writer.writeAll("\n") catch unreachable;
                }
            };
        }

        pub fn SetIterator(comptime Writer: type, comptime enable_ansi_colors: bool) type {
            return struct {
                formatter: *JestPrettyFormat.Formatter,
                writer: Writer,
                pub fn forEach(_: [*c]JSC.VM, globalObject: [*c]JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.C) void {
                    var this: *@This() = bun.cast(*@This(), ctx orelse return);
                    this.formatter.writeIndent(Writer, this.writer) catch {};
                    const key_tag = Tag.get(nextValue, globalObject);
                    this.formatter.format(
                        key_tag,
                        Writer,
                        this.writer,
                        nextValue,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    );

                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch unreachable;
                    this.writer.writeAll("\n") catch unreachable;
                }
            };
        }

        pub fn PropertyIterator(comptime Writer: type, comptime enable_ansi_colors_: bool) type {
            return struct {
                formatter: *JestPrettyFormat.Formatter,
                writer: Writer,
                i: usize = 0,
                always_newline: bool = false,
                parent: JSValue,
                const enable_ansi_colors = enable_ansi_colors_;
                pub fn handleFirstProperty(this: *@This(), globalThis: *JSC.JSGlobalObject, value: JSValue) void {
                    if (!value.jsType().isFunction()) {
                        var writer = WrappedWriter(Writer){
                            .ctx = this.writer,
                            .failed = false,
                        };
                        var name_str = ZigString.init("");

                        value.getNameProperty(globalThis, &name_str);
                        if (name_str.len > 0 and !name_str.eqlComptime("Object")) {
                            writer.print("{} ", .{name_str});
                        } else {
                            value.getPrototype(globalThis).getNameProperty(globalThis, &name_str);
                            if (name_str.len > 0 and !name_str.eqlComptime("Object")) {
                                writer.print("{} ", .{name_str});
                            }
                        }
                    }

                    this.always_newline = true;
                    this.formatter.estimated_line_length = this.formatter.indent * 2 + 1;

                    if (this.formatter.indent == 0) this.writer.writeAll("\n") catch {};
                    var classname = ZigString.Empty;
                    value.getClassName(globalThis, &classname);
                    if (!classname.isEmpty() and !classname.eqlComptime("Object")) {
                        this.writer.print("{} ", .{classname}) catch {};
                    }

                    this.writer.writeAll("{\n") catch {};
                    this.formatter.indent += 1;
                    this.formatter.writeIndent(Writer, this.writer) catch {};
                }

                pub fn forEach(
                    globalThis: *JSGlobalObject,
                    ctx_ptr: ?*anyopaque,
                    key_: [*c]ZigString,
                    value: JSValue,
                    is_symbol: bool,
                    is_private_symbol: bool,
                ) callconv(.C) void {
                    if (is_private_symbol) return;

                    const key = key_.?[0];
                    if (key.eqlComptime("constructor")) return;
                    if (key.eqlComptime("call")) return;

                    var ctx: *@This() = bun.cast(*@This(), ctx_ptr orelse return);
                    var this = ctx.formatter;
                    const writer_ = ctx.writer;
                    var writer = WrappedWriter(Writer){
                        .ctx = writer_,
                        .failed = false,
                    };

                    const tag = Tag.get(value, globalThis);

                    if (tag.cell.isHidden()) return;
                    if (ctx.i == 0) {
                        handleFirstProperty(ctx, globalThis, ctx.parent);
                    } else {
                        this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                    }

                    defer ctx.i += 1;
                    if (ctx.i > 0) {
                        if (ctx.always_newline or this.always_newline_scope or this.goodTimeForANewLine()) {
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch {};
                            this.resetLine();
                        } else {
                            this.estimated_line_length += 1;
                            writer.writeAll(" ");
                        }
                    }

                    if (!is_symbol) {

                        // TODO: make this one pass?
                        if (!key.is16Bit() and JSLexer.isLatin1Identifier(@TypeOf(key.slice()), key.slice())) {
                            this.addForNewLine(key.len + 2);

                            writer.print(
                                comptime Output.prettyFmt("<r>\"{}\"<d>:<r> ", enable_ansi_colors),
                                .{key},
                            );
                        } else if (key.is16Bit() and JSLexer.isLatin1Identifier(@TypeOf(key.utf16SliceAligned()), key.utf16SliceAligned())) {
                            this.addForNewLine(key.len + 2);

                            writer.print(
                                comptime Output.prettyFmt("<r>\"{}\"<d>:<r> ", enable_ansi_colors),
                                .{key},
                            );
                        } else if (key.is16Bit()) {
                            var utf16Slice = key.utf16SliceAligned();

                            this.addForNewLine(utf16Slice.len + 2);

                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                            }

                            writer.writeAll("'");

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
                    } else {
                        this.addForNewLine(1 + "[Symbol()]:".len + key.len);
                        writer.print(
                            comptime Output.prettyFmt("<r><d>[<r><blue>Symbol({any})<r><d>]:<r> ", enable_ansi_colors),
                            .{
                                key,
                            },
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

        pub fn printAs(
            this: *JestPrettyFormat.Formatter,
            comptime Format: JestPrettyFormat.Formatter.Tag,
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
                    var str = ZigString.init("");
                    value.toZigString(&str, this.globalThis);
                    this.addForNewLine(str.len);

                    if (value.jsType() == .StringObject or value.jsType() == .DerivedStringObject) {
                        if (str.len == 0) {
                            writer.writeAll("String {}");
                            return;
                        }
                        if (this.indent == 0 and str.len > 0) {
                            writer.writeAll("\n");
                        }
                        writer.writeAll("String {\n");
                        this.indent += 1;
                        defer this.indent -|= 1;
                        this.resetLine();
                        this.writeIndent(Writer, writer_) catch unreachable;
                        const length = str.len;
                        for (str.slice(), 0..) |c, i| {
                            writer.print("\"{d}\": \"{c}\",\n", .{ i, c });
                            if (i != length - 1) this.writeIndent(Writer, writer_) catch unreachable;
                        }
                        this.resetLine();
                        writer.writeAll("}\n");
                        return;
                    }

                    if (this.quote_strings and jsType != .RegExpObject) {
                        if (str.len == 0) {
                            writer.writeAll("\"\"");
                            return;
                        }

                        if (comptime enable_ansi_colors) {
                            writer.writeAll(Output.prettyFmt("<r><green>", true));
                        }

                        defer if (comptime enable_ansi_colors)
                            writer.writeAll(Output.prettyFmt("<r>", true));

                        var has_newline = false;

                        if (str.indexOfAny("\n\r")) |_| {
                            has_newline = true;
                            writer.writeAll("\n");
                        }

                        writer.writeAll("\"");
                        var remaining = str;
                        while (remaining.indexOfAny("\\\r")) |i| {
                            switch (remaining.charAt(i)) {
                                '\\' => {
                                    writer.print("{}\\", .{remaining.substringWithLen(0, i)});
                                    remaining = remaining.substring(i + 1);
                                },
                                '\r' => {
                                    if (i + 1 < remaining.len and remaining.charAt(i + 1) == '\n') {
                                        writer.print("{}", .{remaining.substringWithLen(0, i)});
                                    } else {
                                        writer.print("{}\n", .{remaining.substringWithLen(0, i)});
                                    }

                                    remaining = remaining.substring(i + 1);
                                },
                                else => unreachable,
                            }
                        }

                        writer.writeString(remaining);
                        writer.writeAll("\"");
                        if (has_newline) writer.writeAll("\n");
                        return;
                    }

                    if (jsType == .RegExpObject and enable_ansi_colors) {
                        writer.print(comptime Output.prettyFmt("<r><red>", enable_ansi_colors), .{});
                    }

                    if (str.is16Bit()) {
                        // streaming print
                        writer.print("{}", .{str});
                    } else if (strings.isAllASCII(str.slice())) {
                        // fast path
                        writer.writeAll(str.slice());
                    } else if (str.len > 0) {
                        // slow path
                        const buf = strings.allocateLatin1IntoUTF8(bun.default_allocator, []const u8, str.slice()) catch &[_]u8{};
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
                    const int = value.toInt64();
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
                        this.printAs(.Object, Writer, writer_, value, .Object, enable_ansi_colors);
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
                    var classname = ZigString.Empty;
                    value.getClassName(this.globalThis, &classname);
                    var message_string = ZigString.Empty;
                    if (value.get(this.globalThis, "message")) |message_prop| {
                        message_prop.toZigString(&message_string, this.globalThis);
                    }
                    if (message_string.len == 0) {
                        writer.print("[{s}]", .{classname});
                        return;
                    }
                    writer.print("[{s}: {s}]", .{ classname, message_string });
                    return;
                },
                .Class => {
                    var printable = ZigString.init(&name_buf);
                    value.getClassName(this.globalThis, &printable);
                    this.addForNewLine(printable.len);

                    if (printable.len == 0) {
                        writer.print(comptime Output.prettyFmt("<cyan>[class]<r>", enable_ansi_colors), .{});
                    } else {
                        writer.print(comptime Output.prettyFmt("<cyan>[class {}]<r>", enable_ansi_colors), .{printable});
                    }
                },
                .Function => {
                    var printable = ZigString.init(&name_buf);
                    value.getNameProperty(this.globalThis, &printable);

                    if (printable.len == 0) {
                        writer.print(comptime Output.prettyFmt("<cyan>[Function]<r>", enable_ansi_colors), .{});
                    } else {
                        writer.print(comptime Output.prettyFmt("<cyan>[Function: {}]<r>", enable_ansi_colors), .{printable});
                    }
                },
                .Array => {
                    const len = @as(u32, @truncate(value.getLength(this.globalThis)));
                    if (len == 0) {
                        writer.writeAll("[]");
                        this.addForNewLine(2);
                        return;
                    }

                    if (this.indent == 0) {
                        writer.writeAll("\n");
                    }

                    var was_good_time = this.always_newline_scope;
                    {
                        this.indent += 1;
                        defer this.indent -|= 1;

                        this.addForNewLine(2);

                        const ref = value.asObjectRef();

                        const prev_quote_strings = this.quote_strings;
                        this.quote_strings = true;
                        defer this.quote_strings = prev_quote_strings;

                        {
                            const element = JSValue.fromRef(CAPI.JSObjectGetPropertyAtIndex(this.globalThis, ref, 0, null));
                            const tag = Tag.get(element, this.globalThis);

                            was_good_time = was_good_time or !tag.tag.isPrimitive() or this.goodTimeForANewLine();

                            this.resetLine();
                            writer.writeAll("[");
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch unreachable;
                            this.addForNewLine(1);

                            this.format(tag, Writer, writer_, element, this.globalThis, enable_ansi_colors);

                            if (tag.cell.isStringLike()) {
                                if (comptime enable_ansi_colors) {
                                    writer.writeAll(comptime Output.prettyFmt("<r>", true));
                                }
                            }

                            if (len == 1) {
                                this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                            }
                        }

                        var i: u32 = 1;
                        while (i < len) : (i += 1) {
                            this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;

                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch unreachable;

                            const element = JSValue.fromRef(CAPI.JSObjectGetPropertyAtIndex(this.globalThis, ref, i, null));
                            const tag = Tag.get(element, this.globalThis);

                            this.format(tag, Writer, writer_, element, this.globalThis, enable_ansi_colors);

                            if (tag.cell.isStringLike()) {
                                if (comptime enable_ansi_colors) {
                                    writer.writeAll(comptime Output.prettyFmt("<r>", true));
                                }
                            }

                            if (i == len - 1) {
                                this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;
                            }
                        }
                    }

                    this.resetLine();
                    writer.writeAll("\n");
                    this.writeIndent(Writer, writer_) catch {};
                    writer.writeAll("]");
                    if (this.indent == 0) {
                        writer.writeAll("\n");
                    }
                    this.resetLine();
                    this.addForNewLine(1);
                },
                .Private => {
                    if (value.as(JSC.WebCore.Response)) |response| {
                        response.writeFormat(Formatter, this, writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.WebCore.Request)) |request| {
                        request.writeFormat(Formatter, this, writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.API.BuildArtifact)) |build| {
                        build.writeFormat(Formatter, this, writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.WebCore.Blob)) |blob| {
                        blob.writeFormat(Formatter, this, writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(JSC.DOMFormData) != null) {
                        const toJSONFunction = value.get(this.globalThis, "toJSON").?;

                        this.addForNewLine("FormData (entries) ".len);
                        writer.writeAll(comptime Output.prettyFmt("<r><blue>FormData<r> <d>(entries)<r> ", enable_ansi_colors));

                        return this.printAs(
                            .Object,
                            Writer,
                            writer_,
                            toJSONFunction.callWithThis(this.globalThis, value, &.{}),
                            .Object,
                            enable_ansi_colors,
                        );
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
                    } else if (printAsymmetricMatcher(this, Format, &writer, writer_, name_buf, value, enable_ansi_colors)) {
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
                    if (this.goodTimeForANewLine()) {
                        writer.writeAll("\n");
                        this.writeIndent(Writer, writer_) catch {};
                    }
                    writer.writeAll("Promise {}");
                },
                .Boolean => {
                    if (value.isCell()) {
                        this.printAs(.Object, Writer, writer_, value, .Object, enable_ansi_colors);
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
                    const fmt = "[this.globalThis]";
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

                    writer.print("\n{s} {{\n", .{map_name});
                    {
                        this.indent += 1;
                        defer this.indent -|= 1;
                        var iter = MapIterator(Writer, enable_ansi_colors){
                            .formatter = this,
                            .writer = writer_,
                        };
                        value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                    }
                    this.writeIndent(Writer, writer_) catch {};
                    writer.writeAll("}");
                    writer.writeAll("\n");
                },
                .Set => {
                    const length_value = value.get(this.globalThis, "size") orelse JSC.JSValue.jsNumberFromInt32(0);
                    const length = length_value.toInt32();

                    const prev_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = prev_quote_strings;

                    this.writeIndent(Writer, writer_) catch {};

                    const set_name = if (value.jsType() == .JSWeakSet) "WeakSet" else "Set";

                    if (length == 0) {
                        return writer.print("{s} {{}}", .{set_name});
                    }

                    writer.print("\n{s} {{\n", .{set_name});
                    {
                        this.indent += 1;
                        defer this.indent -|= 1;
                        var iter = SetIterator(Writer, enable_ansi_colors){
                            .formatter = this,
                            .writer = writer_,
                        };
                        value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                    }
                    this.writeIndent(Writer, writer_) catch {};
                    writer.writeAll("}");
                    writer.writeAll("\n");
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
                        if (out_buf.len > 2) {
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
                        defer this.indent -|= 1;
                        const old_quote_strings = this.quote_strings;
                        this.quote_strings = true;
                        defer this.quote_strings = old_quote_strings;
                        this.writeIndent(Writer, writer_) catch unreachable;

                        writer.print(
                            comptime Output.prettyFmt("<r>type: <green>\"{s}\"<r><d>,<r>\n", enable_ansi_colors),
                            .{
                                event_type.label(),
                            },
                        );
                        this.writeIndent(Writer, writer_) catch unreachable;

                        switch (event_type) {
                            .MessageEvent => {
                                writer.print(
                                    comptime Output.prettyFmt("<r><blue>data<d>:<r> ", enable_ansi_colors),
                                    .{},
                                );
                                const data = value.get(this.globalThis, "data").?;
                                const tag = Tag.get(data, this.globalThis);
                                if (tag.cell.isStringLike()) {
                                    this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                                } else {
                                    this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                                }
                            },
                            .ErrorEvent => {
                                writer.print(
                                    comptime Output.prettyFmt("<r><blue>error<d>:<r>\n", enable_ansi_colors),
                                    .{},
                                );

                                const data = value.get(this.globalThis, "error").?;
                                const tag = Tag.get(data, this.globalThis);
                                this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                            },
                            else => unreachable,
                        }
                        writer.writeAll("\n");
                    }

                    this.writeIndent(Writer, writer_) catch unreachable;
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
                        const _tag = Tag.get(type_value, this.globalThis);

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

                            this.format(Tag.get(key_value, this.globalThis), Writer, writer_, key_value, this.globalThis, enable_ansi_colors);

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
                                    const tag = Tag.get(property_value, this.globalThis);

                                    if (tag.cell.isHidden()) continue;

                                    if (needs_space) writer.writeAll(" ");
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

                                    if (
                                    // count_without_children is necessary to prevent printing an extra newline
                                    // if there are children and one prop and the child prop is the last prop
                                    props_iter.i + 1 < count_without_children and
                                        // 3 is arbitrary but basically
                                        //  <input type="text" value="foo" />
                                        //  ^ should be one line
                                        // <input type="text" value="foo" bar="true" baz={false} />
                                        //  ^ should be multiple lines
                                        props_iter.i > 3)
                                    {
                                        writer.writeAll("\n");
                                        this.writeIndent(Writer, writer_) catch unreachable;
                                    } else if (props_iter.i + 1 < count_without_children) {
                                        writer.writeAll(" ");
                                    }
                                }
                            }

                            if (children_prop) |children| {
                                const tag = Tag.get(children, this.globalThis);

                                const print_children = switch (tag.tag) {
                                    .String, .JSX, .Array => true,
                                    else => false,
                                };

                                if (print_children) {
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
                                                        this.format(Tag.get(child, this.globalThis), Writer, writer_, child, this.globalThis, enable_ansi_colors);
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
                        .always_newline = this.always_newline_scope or this.goodTimeForANewLine(),
                        .parent = value,
                    };

                    value.forEachPropertyOrdered(this.globalThis, &iter, Iterator.forEach);

                    if (iter.i == 0) {
                        var object_name = ZigString.Empty;
                        value.getClassName(this.globalThis, &object_name);

                        if (!object_name.eqlComptime("Object")) {
                            writer.print("{s} {{}}", .{object_name});
                        } else {
                            // don't write "Object"
                            writer.writeAll("{}");
                        }
                    } else {
                        this.printComma(Writer, writer_, enable_ansi_colors) catch unreachable;

                        if (iter.always_newline) {
                            this.indent -|= 1;
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch {};
                            writer.writeAll("}");
                            this.estimated_line_length += 1;
                        } else {
                            this.estimated_line_length += 2;
                            writer.writeAll(" }");
                        }

                        if (this.indent == 0) {
                            writer.writeAll("\n");
                        }
                    }
                },
                .TypedArray => {
                    const arrayBuffer = value.asArrayBuffer(this.globalThis).?;
                    const slice = arrayBuffer.byteSlice();

                    if (this.indent == 0 and slice.len > 0) {
                        writer.writeAll("\n");
                    }

                    if (jsType == .Uint8Array) {
                        var buffer_name = ZigString.Empty;
                        value.getClassName(this.globalThis, &buffer_name);
                        if (strings.eqlComptime(buffer_name.slice(), "Buffer")) {
                            // special formatting for 'Buffer' snapshots only
                            if (slice.len == 0 and this.indent == 0) writer.writeAll("\n");
                            writer.writeAll("{\n");
                            this.indent += 1;
                            this.writeIndent(Writer, writer_) catch {};
                            writer.writeAll("\"data\": [");

                            this.indent += 1;
                            for (slice) |el| {
                                writer.writeAll("\n");
                                this.writeIndent(Writer, writer_) catch {};
                                writer.print("{d},", .{el});
                            }
                            this.indent -|= 1;

                            if (slice.len > 0) {
                                writer.writeAll("\n");
                                this.writeIndent(Writer, writer_) catch {};
                                writer.writeAll("],\n");
                            } else {
                                writer.writeAll("],\n");
                            }

                            this.writeIndent(Writer, writer_) catch {};
                            writer.writeAll("\"type\": \"Buffer\",\n");

                            this.indent -|= 1;
                            this.writeIndent(Writer, writer_) catch {};
                            writer.writeAll("}");

                            if (this.indent == 0) {
                                writer.writeAll("\n");
                            }

                            return;
                        }
                        writer.writeAll(bun.asByteSlice(@tagName(arrayBuffer.typed_array_type)));
                    } else {
                        writer.writeAll(bun.asByteSlice(@tagName(arrayBuffer.typed_array_type)));
                    }

                    writer.writeAll(" [");

                    if (slice.len > 0) {
                        switch (jsType) {
                            .Int8Array => {
                                const slice_with_type: []align(std.meta.alignment([]i8)) i8 = @alignCast(std.mem.bytesAsSlice(i8, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                            .Int16Array => {
                                const slice_with_type: []align(std.meta.alignment([]i16)) i16 = @alignCast(std.mem.bytesAsSlice(i16, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                            .Uint16Array => {
                                const slice_with_type: []align(std.meta.alignment([]u16)) u16 = @alignCast(std.mem.bytesAsSlice(u16, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                            .Int32Array => {
                                const slice_with_type: []align(std.meta.alignment([]i32)) i32 = @alignCast(std.mem.bytesAsSlice(i32, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                            .Uint32Array => {
                                const slice_with_type: []align(std.meta.alignment([]u32)) u32 = @alignCast(std.mem.bytesAsSlice(u32, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                            .Float32Array => {
                                const slice_with_type: []align(std.meta.alignment([]f32)) f32 = @alignCast(std.mem.bytesAsSlice(f32, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                            .Float64Array => {
                                const slice_with_type: []align(std.meta.alignment([]f64)) f64 = @alignCast(std.mem.bytesAsSlice(f64, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                            .BigInt64Array => {
                                const slice_with_type: []align(std.meta.alignment([]i64)) i64 = @alignCast(std.mem.bytesAsSlice(i64, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                            .BigUint64Array => {
                                const slice_with_type: []align(std.meta.alignment([]u64)) u64 = @alignCast(std.mem.bytesAsSlice(u64, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },

                            // Uint8Array, Uint8ClampedArray, DataView, ArrayBuffer
                            else => {
                                const slice_with_type: []align(std.meta.alignment([]u8)) u8 = @alignCast(std.mem.bytesAsSlice(u8, slice));
                                this.indent += 1;
                                defer this.indent -|= 1;
                                for (slice_with_type) |el| {
                                    writer.writeAll("\n");
                                    this.writeIndent(Writer, writer_) catch {};
                                    writer.print("{d},", .{el});
                                }
                            },
                        }
                    }

                    if (slice.len > 0) {
                        writer.writeAll("\n");
                        this.writeIndent(Writer, writer_) catch {};
                        writer.writeAll("]");
                        if (this.indent == 0) {
                            writer.writeAll("\n");
                        }
                    } else {
                        writer.writeAll("]");
                    }
                },
                else => {},
            }
        }

        pub fn format(this: *JestPrettyFormat.Formatter, result: Tag.Result, comptime Writer: type, writer: Writer, value: JSValue, globalThis: *JSGlobalObject, comptime enable_ansi_colors: bool) void {
            if (comptime is_bindgen) {
                return;
            }
            const prevGlobalThis = this.globalThis;
            defer this.globalThis = prevGlobalThis;
            this.globalThis = globalThis;

            // This looks incredibly redundant. We make the JestPrettyFormat.Formatter.Tag a
            // comptime var so we have to repeat it here. The rationale there is
            // it _should_ limit the stack usage because each version of the
            // function will be relatively small
            return switch (result.tag) {
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
                .Set => this.printAs(.Set, Writer, writer, value, result.cell, enable_ansi_colors),
                .Symbol => this.printAs(.Symbol, Writer, writer, value, result.cell, enable_ansi_colors),
                .BigInt => this.printAs(.BigInt, Writer, writer, value, result.cell, enable_ansi_colors),
                .GlobalObject => this.printAs(.GlobalObject, Writer, writer, value, result.cell, enable_ansi_colors),
                .Private => this.printAs(.Private, Writer, writer, value, result.cell, enable_ansi_colors),
                .Promise => this.printAs(.Promise, Writer, writer, value, result.cell, enable_ansi_colors),
                .JSON => this.printAs(.JSON, Writer, writer, value, result.cell, enable_ansi_colors),
                .NativeCode => this.printAs(.NativeCode, Writer, writer, value, result.cell, enable_ansi_colors),
                .JSX => this.printAs(.JSX, Writer, writer, value, result.cell, enable_ansi_colors),
                .Event => this.printAs(.Event, Writer, writer, value, result.cell, enable_ansi_colors),
            };
        }
    };

    fn printAsymmetricMatcherPromisePrefix(flags: expect.Expect.Flags, matcher: anytype, writer: anytype) void {
        if (flags.promise != .none) {
            switch (flags.promise) {
                .resolves => {
                    matcher.addForNewLine("promise resolved to ".len);
                    writer.writeAll("promise resolved to ");
                },
                .rejects => {
                    matcher.addForNewLine("promise rejected to ".len);
                    writer.writeAll("promise rejected to ");
                },
                else => {},
            }
        }
    }

    pub fn printAsymmetricMatcher(
        // the Formatter instance
        this: anytype,
        comptime Format: anytype,
        /// The WrappedWriter
        writer: anytype,
        /// The raw writer
        writer_: anytype,
        /// Buf used to print strings
        name_buf: [512]u8,
        value: JSValue,
        comptime enable_ansi_colors: bool,
    ) bool {
        _ = Format;

        if (value.as(expect.ExpectAnything)) |matcher| {
            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("NotAnything".len);
                writer.writeAll("NotAnything");
            } else {
                this.addForNewLine("Anything".len);
                writer.writeAll("Anything");
            }
        } else if (value.as(expect.ExpectAny)) |matcher| {
            const constructor_value = expect.ExpectAny.constructorValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("NotAny<".len);
                writer.writeAll("NotAny<");
            } else {
                this.addForNewLine("Any<".len);
                writer.writeAll("Any<");
            }

            var class_name = ZigString.init(&name_buf);
            constructor_value.getClassName(this.globalThis, &class_name);
            this.addForNewLine(class_name.len);
            writer.print(comptime Output.prettyFmt("<cyan>{}<r>", enable_ansi_colors), .{class_name});
            this.addForNewLine(1);
            writer.writeAll(">");
        } else if (value.as(expect.ExpectCloseTo)) |matcher| {
            const number_value = expect.ExpectCloseTo.numberValueGetCached(value) orelse return true;
            const digits_value = expect.ExpectCloseTo.digitsValueGetCached(value) orelse return true;

            const number = number_value.toInt32();
            const digits = digits_value.toInt32();

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("NumberNotCloseTo".len);
                writer.writeAll("NumberNotCloseTo");
            } else {
                this.addForNewLine("NumberCloseTo ".len);
                writer.writeAll("NumberCloseTo ");
            }
            writer.print("{d} ({d} digit{s})", .{ number, digits, if (digits == 1) "" else "s" });
        } else if (value.as(expect.ExpectObjectContaining)) |matcher| {
            const object_value = expect.ExpectObjectContaining.objectValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("ObjectNotContaining ".len);
                writer.writeAll("ObjectNotContaining ");
            } else {
                this.addForNewLine("ObjectContaining ".len);
                writer.writeAll("ObjectContaining ");
            }
            this.printAs(.Object, @TypeOf(writer_), writer_, object_value, .Object, enable_ansi_colors);
        } else if (value.as(expect.ExpectStringContaining)) |matcher| {
            const substring_value = expect.ExpectStringContaining.stringValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("StringNotContaining ".len);
                writer.writeAll("StringNotContaining ");
            } else {
                this.addForNewLine("StringContaining ".len);
                writer.writeAll("StringContaining ");
            }
            this.printAs(.String, @TypeOf(writer_), writer_, substring_value, .String, enable_ansi_colors);
        } else if (value.as(expect.ExpectStringMatching)) |matcher| {
            const test_value = expect.ExpectStringMatching.testValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("StringNotMatching ".len);
                writer.writeAll("StringNotMatching ");
            } else {
                this.addForNewLine("StringMatching ".len);
                writer.writeAll("StringMatching ");
            }

            const original_quote_strings = this.quote_strings;
            if (test_value.isRegExp()) this.quote_strings = false;
            this.printAs(.String, @TypeOf(writer_), writer_, test_value, .String, enable_ansi_colors);
            this.quote_strings = original_quote_strings;
        } else if (value.as(expect.ExpectCustomAsymmetricMatcher)) |instance| {
            const printed = instance.customPrint(value, this.globalThis, writer_, true) catch unreachable;
            if (!printed) { // default print (non-overriden by user)
                const flags = instance.flags;
                const args_value = expect.ExpectCustomAsymmetricMatcher.capturedArgsGetCached(value) orelse return true;
                const matcher_fn = expect.ExpectCustomAsymmetricMatcher.matcherFnGetCached(value) orelse return true;
                const matcher_name = matcher_fn.getName(this.globalThis);

                printAsymmetricMatcherPromisePrefix(flags, this, writer);
                if (flags.not) {
                    this.addForNewLine("not ".len);
                    writer.writeAll("not ");
                }
                this.addForNewLine(matcher_name.length() + 1);
                writer.print("{s}", .{matcher_name});
                writer.writeAll(" ");
                this.printAs(.Array, @TypeOf(writer_), writer_, args_value, .Array, enable_ansi_colors);
            }
        } else {
            return false;
        }
        return true;
    }
};
