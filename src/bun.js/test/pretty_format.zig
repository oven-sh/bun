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
        writer: *std.Io.Writer,
        options: FormatOptions,
    ) bun.JSError!void {
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
            const tag = try JestPrettyFormat.Formatter.Tag.get(vals[0], global);

            if (tag.tag == .String) {
                if (options.enable_colors) {
                    if (level == .Error) {
                        writer.writeAll(comptime Output.prettyFmt("<r><red>", true)) catch unreachable;
                    }
                    try fmt.format(
                        tag,
                        @TypeOf(writer),
                        writer,
                        vals[0],
                        global,
                        true,
                    );
                    if (level == .Error) {
                        writer.writeAll(comptime Output.prettyFmt("<r>", true)) catch unreachable;
                    }
                } else {
                    try fmt.format(
                        tag,
                        @TypeOf(writer),
                        writer,
                        vals[0],
                        global,
                        false,
                    );
                }
                if (options.add_newline) writer.writeAll("\n") catch {};
            } else {
                defer {
                    if (options.flush) writer.flush() catch {};
                }
                if (options.enable_colors) {
                    try fmt.format(
                        tag,
                        *std.Io.Writer,
                        writer,
                        vals[0],
                        global,
                        true,
                    );
                } else {
                    try fmt.format(
                        tag,
                        *std.Io.Writer,
                        writer,
                        vals[0],
                        global,
                        false,
                    );
                }
                if (options.add_newline) _ = writer.write("\n") catch 0;
            }

            writer.flush() catch {};

            return;
        }

        defer {
            if (options.flush) writer.flush() catch {};
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

                tag = try JestPrettyFormat.Formatter.Tag.get(this_value, global);
                if (tag.tag == .String and fmt.remaining_values.len > 0) {
                    tag.tag = .StringPossiblyFormatted;
                }

                try fmt.format(tag, *std.Io.Writer, writer, this_value, global, true);
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
                tag = try JestPrettyFormat.Formatter.Tag.get(this_value, global);
                if (tag.tag == .String and fmt.remaining_values.len > 0) {
                    tag.tag = .StringPossiblyFormatted;
                }

                try fmt.format(tag, *std.Io.Writer, writer, this_value, global, false);
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
            pub fn format(self: ZigFormatter, writer: *std.Io.Writer) !void {
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
            pub const Map = std.AutoHashMap(JSValue, void);
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
                cell: JSValue.JSType = .Cell,
            };

            pub fn get(value: JSValue, globalThis: *JSGlobalObject) bun.JSError!Result {
                switch (value) {
                    .zero, .js_undefined => return Result{
                        .tag = .Undefined,
                    },
                    .null => return Result{
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

                // If we check an Object has a method table and it does not
                // it will crash
                if (js_type != .Object and value.isCallable()) {
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
                        jsc.JSValue.c(jsc.C.JSObjectGetProxyTarget(value.asObjectRef())),
                        globalThis,
                    );
                }

                // Is this a react element?
                if (js_type.isObject() and js_type != .ProxyObject) {
                    if (try value.getOwnTruthy(globalThis, "$$typeof")) |typeof_symbol| {
                        var reactElement = ZigString.init("react.element");
                        var react_fragment = ZigString.init("react.fragment");

                        if (try typeof_symbol.isSameValue(.symbolFor(globalThis, &reactElement), globalThis) or try typeof_symbol.isSameValue(.symbolFor(globalThis, &react_fragment), globalThis)) {
                            return .{ .tag = .JSX, .cell = js_type };
                        }
                    }
                }

                return .{
                    .tag = switch (js_type) {
                        .ErrorInstance => .Error,
                        .NumberObject => .Double,
                        .DerivedArray, .Array => .Array,
                        .DerivedStringObject, .String, .StringObject => .String,
                        .RegExpObject => .String,
                        .Symbol => .Symbol,
                        .BooleanObject => .Boolean,
                        .JSFunction => .Function,
                        .WeakMap, .Map => .Map,
                        .WeakSet, .Set => .Set,
                        .JSDate => .JSON,
                        .JSPromise => .Promise,
                        .Object,
                        .FinalObject,
                        .ModuleNamespaceObject,
                        .GlobalObject,
                        => .Object,

                        .ArrayBuffer,
                        .Int8Array,
                        .Uint8Array,
                        .Uint8ClampedArray,
                        .Int16Array,
                        .Uint16Array,
                        .Int32Array,
                        .Uint32Array,
                        .Float16Array,
                        .Float32Array,
                        .Float64Array,
                        .BigInt64Array,
                        .BigUint64Array,
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
                        .JSCellButterfly,
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
                            Tag.String => this.printAs(Tag.String, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors) catch return,
                            Tag.Double => this.printAs(Tag.Double, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors) catch return,
                            Tag.Object => this.printAs(Tag.Object, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors) catch return,
                            Tag.Integer => this.printAs(Tag.Integer, Writer, writer_, next_value, next_value.jsType(), enable_ansi_colors) catch return,

                            // undefined is overloaded to mean the '%o" field
                            Tag.Undefined => this.format(Tag.get(next_value, globalThis) catch return, Writer, writer_, next_value, globalThis, enable_ansi_colors) catch return,

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
                    self.print("{f}", .{str});
                }

                pub inline fn write16Bit(self: *@This(), input: []const u16) void {
                    bun.fmt.formatUTF16Type(input, self.ctx) catch {
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
                const written: usize = @min(32, total_remain);
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
                pub fn forEach(_: *jsc.VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.c) void {
                    var this: *@This() = bun.cast(*@This(), ctx orelse return);
                    if (this.formatter.failed) return;
                    const key = jsc.JSObject.getIndex(nextValue, globalObject, 0) catch return;
                    const value = jsc.JSObject.getIndex(nextValue, globalObject, 1) catch return;
                    this.formatter.writeIndent(Writer, this.writer) catch return;
                    const key_tag = Tag.get(key, globalObject) catch return;

                    this.formatter.format(
                        key_tag,
                        Writer,
                        this.writer,
                        key,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    ) catch return;
                    this.writer.writeAll(" => ") catch return;
                    const value_tag = Tag.get(value, globalObject) catch return;
                    this.formatter.format(
                        value_tag,
                        Writer,
                        this.writer,
                        value,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    ) catch return;
                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch return;
                    this.writer.writeAll("\n") catch return;
                }
            };
        }

        pub fn SetIterator(comptime Writer: type, comptime enable_ansi_colors: bool) type {
            return struct {
                formatter: *JestPrettyFormat.Formatter,
                writer: Writer,
                pub fn forEach(_: *jsc.VM, globalObject: *JSGlobalObject, ctx: ?*anyopaque, nextValue: JSValue) callconv(.c) void {
                    var this: *@This() = bun.cast(*@This(), ctx orelse return);
                    if (this.formatter.failed) return;
                    this.formatter.writeIndent(Writer, this.writer) catch return;
                    const key_tag = Tag.get(nextValue, globalObject) catch return;
                    this.formatter.format(
                        key_tag,
                        Writer,
                        this.writer,
                        nextValue,
                        this.formatter.globalThis,
                        enable_ansi_colors,
                    ) catch return;
                    this.formatter.printComma(Writer, this.writer, enable_ansi_colors) catch return;
                    this.writer.writeAll("\n") catch return;
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
                pub fn handleFirstProperty(this: *@This(), globalThis: *jsc.JSGlobalObject, value: JSValue) bun.JSError!void {
                    if (!value.jsType().isFunction()) {
                        var writer = WrappedWriter(Writer){
                            .ctx = this.writer,
                            .failed = false,
                        };
                        var name_str = ZigString.init("");

                        try value.getNameProperty(globalThis, &name_str);
                        if (name_str.len > 0 and !name_str.eqlComptime("Object")) {
                            writer.print("{f} ", .{name_str});
                        } else {
                            try value.getPrototype(globalThis).getNameProperty(globalThis, &name_str);
                            if (name_str.len > 0 and !name_str.eqlComptime("Object")) {
                                writer.print("{f} ", .{name_str});
                            }
                        }
                    }

                    this.always_newline = true;
                    this.formatter.estimated_line_length = this.formatter.indent * 2 + 1;

                    if (this.formatter.indent == 0) this.writer.writeAll("\n") catch {};
                    var classname = ZigString.Empty;
                    try value.getClassName(globalThis, &classname);
                    if (!classname.isEmpty() and !classname.eqlComptime("Object")) {
                        this.writer.print("{f} ", .{classname}) catch {};
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
                ) callconv(.c) void {
                    if (is_private_symbol) return;

                    const key = key_.?[0];
                    if (key.eqlComptime("constructor")) return;

                    var ctx: *@This() = bun.cast(*@This(), ctx_ptr orelse return);
                    var this = ctx.formatter;
                    const writer_ = ctx.writer;
                    if (this.failed) return;

                    var writer = WrappedWriter(Writer){
                        .ctx = writer_,
                        .failed = false,
                    };

                    const tag = Tag.get(value, globalThis) catch return;

                    if (tag.cell.isHidden()) return;
                    if (ctx.i == 0) {
                        handleFirstProperty(ctx, globalThis, ctx.parent) catch return;
                    } else {
                        this.printComma(Writer, writer_, enable_ansi_colors) catch return;
                    }

                    defer ctx.i += 1;
                    if (ctx.i > 0) {
                        if (ctx.always_newline or this.always_newline_scope or this.goodTimeForANewLine()) {
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch return;
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
                                comptime Output.prettyFmt("<r>\"{f}\"<d>:<r> ", enable_ansi_colors),
                                .{key},
                            );
                        } else if (key.is16Bit() and JSLexer.isLatin1Identifier(@TypeOf(key.utf16SliceAligned()), key.utf16SliceAligned())) {
                            this.addForNewLine(key.len + 2);

                            writer.print(
                                comptime Output.prettyFmt("<r>\"{f}\"<d>:<r> ", enable_ansi_colors),
                                .{key},
                            );
                        } else if (key.is16Bit()) {
                            const utf16Slice = key.utf16SliceAligned();

                            this.addForNewLine(utf16Slice.len + 2);

                            if (comptime enable_ansi_colors) {
                                writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                            }

                            writer.writeAll("\"");
                            writer.write16Bit(utf16Slice);
                            writer.print(
                                comptime Output.prettyFmt("\"<r><d>:<r> ", enable_ansi_colors),
                                .{},
                            );
                        } else {
                            this.addForNewLine(key.len + 2);

                            writer.print(
                                comptime Output.prettyFmt("<r><green>{f}<r><d>:<r> ", enable_ansi_colors),
                                .{bun.fmt.formatJSONStringLatin1(key.slice())},
                            );
                        }
                    } else {
                        this.addForNewLine(1 + "[Symbol()]:".len + key.len);
                        writer.print(
                            comptime Output.prettyFmt("<r><d>[<r><blue>Symbol({f})<r><d>]:<r> ", enable_ansi_colors),
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

                    this.format(tag, Writer, ctx.writer, value, globalThis, enable_ansi_colors) catch return;

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
            writer_: *std.Io.Writer,
            value: JSValue,
            jsType: JSValue.JSType,
            comptime enable_ansi_colors: bool,
        ) bun.JSError!void {
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

                const entry = this.map.getOrPut(value) catch unreachable;
                if (entry.found_existing) {
                    writer.writeAll(comptime Output.prettyFmt("<r><cyan>[Circular]<r>", enable_ansi_colors));
                    return;
                }
            }

            defer {
                if (comptime Format.canHaveCircularReferences()) {
                    _ = this.map.remove(value);
                }
            }

            switch (comptime Format) {
                .StringPossiblyFormatted => {
                    var str = try value.toSlice(this.globalThis, bun.default_allocator);
                    defer str.deinit();
                    this.addForNewLine(str.len);
                    const slice = str.slice();
                    this.writeWithFormatting(Writer, writer_, @TypeOf(slice), slice, this.globalThis, enable_ansi_colors);
                },
                .String => {
                    var str = ZigString.init("");
                    try value.toZigString(&str, this.globalThis);
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
                                    writer.print("{f}\\", .{remaining.substringWithLen(0, i)});
                                    remaining = remaining.substring(i + 1);
                                },
                                '\r' => {
                                    if (i + 1 < remaining.len and remaining.charAt(i + 1) == '\n') {
                                        writer.print("{f}", .{remaining.substringWithLen(0, i)});
                                    } else {
                                        writer.print("{f}\n", .{remaining.substringWithLen(0, i)});
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
                        writer.print("{f}", .{str});
                    } else if (strings.isAllASCII(str.slice())) {
                        // fast path
                        writer.writeAll(str.slice());
                    } else if (str.len > 0) {
                        // slow path
                        const buf = strings.allocateLatin1IntoUTF8(bun.default_allocator, str.slice()) catch &[_]u8{};
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
                        this.addForNewLine(std.fmt.count("{d}", .{int}));
                    }
                    writer.print(comptime Output.prettyFmt("<r><yellow>{d}<r>", enable_ansi_colors), .{int});
                },
                .BigInt => {
                    const out_str = (try value.getZigString(this.globalThis)).slice();
                    this.addForNewLine(out_str.len);

                    writer.print(comptime Output.prettyFmt("<r><yellow>{s}n<r>", enable_ansi_colors), .{out_str});
                },
                .Double => {
                    if (value.isCell()) {
                        try this.printAs(.Object, Writer, writer_, value, .Object, enable_ansi_colors);
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
                        writer.print(comptime Output.prettyFmt("<r><blue>Symbol({f})<r>", enable_ansi_colors), .{description});
                    } else {
                        writer.print(comptime Output.prettyFmt("<r><blue>Symbol<r>", enable_ansi_colors), .{});
                    }
                },
                .Error => {
                    var classname = ZigString.Empty;
                    try value.getClassName(this.globalThis, &classname);
                    var message_string = bun.String.empty;
                    defer message_string.deref();

                    if (try value.fastGet(this.globalThis, .message)) |message_prop| {
                        message_string = try message_prop.toBunString(this.globalThis);
                    }

                    if (message_string.isEmpty()) {
                        writer.print("[{f}]", .{classname});
                        return;
                    }
                    writer.print("[{f}: {f}]", .{ classname, message_string });
                    return;
                },
                .Class => {
                    var printable = ZigString.init(&name_buf);
                    try value.getClassName(this.globalThis, &printable);
                    this.addForNewLine(printable.len);

                    if (printable.len == 0) {
                        writer.print(comptime Output.prettyFmt("<cyan>[class]<r>", enable_ansi_colors), .{});
                    } else {
                        writer.print(comptime Output.prettyFmt("<cyan>[class {f}]<r>", enable_ansi_colors), .{printable});
                    }
                },
                .Function => {
                    var printable = ZigString.init(&name_buf);
                    try value.getNameProperty(this.globalThis, &printable);

                    if (printable.len == 0) {
                        writer.print(comptime Output.prettyFmt("<cyan>[Function]<r>", enable_ansi_colors), .{});
                    } else {
                        writer.print(comptime Output.prettyFmt("<cyan>[Function: {f}]<r>", enable_ansi_colors), .{printable});
                    }
                },
                .Array => {
                    const len: u32 = @truncate(try value.getLength(this.globalThis));
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
                            const tag = try Tag.get(element, this.globalThis);

                            was_good_time = was_good_time or !tag.tag.isPrimitive() or this.goodTimeForANewLine();

                            this.resetLine();
                            writer.writeAll("[");
                            writer.writeAll("\n");
                            this.writeIndent(Writer, writer_) catch unreachable;
                            this.addForNewLine(1);

                            try this.format(tag, Writer, writer_, element, this.globalThis, enable_ansi_colors);

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
                            const tag = try Tag.get(element, this.globalThis);

                            try this.format(tag, Writer, writer_, element, this.globalThis, enable_ansi_colors);

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
                    if (value.as(jsc.WebCore.Response)) |response| {
                        response.writeFormat(Formatter, this, writer_, enable_ansi_colors) catch |err| {
                            this.failed = true;
                            // TODO: make this better
                            if (!this.globalThis.hasException()) {
                                return this.globalThis.throwError(err, "failed to print Response");
                            }
                            return error.JSError;
                        };
                    } else if (value.as(jsc.WebCore.Request)) |request| {
                        request.writeFormat(value, Formatter, this, writer_, enable_ansi_colors) catch |err| {
                            this.failed = true;
                            // TODO: make this better
                            if (!this.globalThis.hasException()) {
                                return this.globalThis.throwError(err, "failed to print Request");
                            }
                            return error.JSError;
                        };
                        return;
                    } else if (value.as(jsc.API.BuildArtifact)) |build| {
                        build.writeFormat(Formatter, this, writer_, enable_ansi_colors) catch |err| {
                            this.failed = true;
                            // TODO: make this better
                            if (!this.globalThis.hasException()) {
                                return this.globalThis.throwError(err, "failed to print BuildArtifact");
                            }
                            return error.JSError;
                        };
                    } else if (value.as(jsc.WebCore.Blob)) |blob| {
                        blob.writeFormat(Formatter, this, writer_, enable_ansi_colors) catch |err| {
                            this.failed = true;
                            // TODO: make this better
                            if (!this.globalThis.hasException()) {
                                return this.globalThis.throwError(err, "failed to print Blob");
                            }
                            return error.JSError;
                        };
                        return;
                    } else if (value.as(jsc.DOMFormData) != null) {
                        const toJSONFunction = (try value.get(this.globalThis, "toJSON")).?;

                        this.addForNewLine("FormData (entries) ".len);
                        writer.writeAll(comptime Output.prettyFmt("<r><blue>FormData<r> <d>(entries)<r> ", enable_ansi_colors));

                        return try this.printAs(
                            .Object,
                            Writer,
                            writer_,
                            try toJSONFunction.call(this.globalThis, value, &.{}),
                            .Object,
                            enable_ansi_colors,
                        );
                    } else if (value.as(bun.api.Timer.TimeoutObject)) |timer| {
                        this.addForNewLine("Timeout(# ) ".len + bun.fmt.fastDigitCount(@as(u64, @intCast(@max(timer.internals.id, 0)))));
                        if (timer.internals.flags.kind == .setInterval) {
                            this.addForNewLine("repeats ".len + bun.fmt.fastDigitCount(@as(u64, @intCast(@max(timer.internals.id, 0)))));
                            writer.print(comptime Output.prettyFmt("<r><blue>Timeout<r> <d>(#<yellow>{d}<r><d>, repeats)<r>", enable_ansi_colors), .{
                                timer.internals.id,
                            });
                        } else {
                            writer.print(comptime Output.prettyFmt("<r><blue>Timeout<r> <d>(#<yellow>{d}<r><d>)<r>", enable_ansi_colors), .{
                                timer.internals.id,
                            });
                        }

                        return;
                    } else if (value.as(bun.api.Timer.ImmediateObject)) |immediate| {
                        this.addForNewLine("Immediate(# ) ".len + bun.fmt.fastDigitCount(@as(u64, @intCast(@max(immediate.internals.id, 0)))));
                        writer.print(comptime Output.prettyFmt("<r><blue>Immediate<r> <d>(#<yellow>{d}<r><d>)<r>", enable_ansi_colors), .{
                            immediate.internals.id,
                        });

                        return;
                    } else if (value.as(bun.api.BuildMessage)) |build_log| {
                        build_log.msg.writeFormat(writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (value.as(bun.api.ResolveMessage)) |resolve_log| {
                        resolve_log.msg.writeFormat(writer_, enable_ansi_colors) catch {};
                        return;
                    } else if (try printAsymmetricMatcher(this, Format, &writer, writer_, name_buf, value, enable_ansi_colors)) {
                        return;
                    } else if (jsType != .DOMWrapper) {
                        if (value.isCallable()) {
                            return try this.printAs(.Function, Writer, writer_, value, jsType, enable_ansi_colors);
                        }

                        return try this.printAs(.Object, Writer, writer_, value, jsType, enable_ansi_colors);
                    }
                    return try this.printAs(.Object, Writer, writer_, value, .Event, enable_ansi_colors);
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
                        try this.printAs(.Object, Writer, writer_, value, .Object, enable_ansi_colors);
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
                    const length_value = try value.get(this.globalThis, "size") orelse jsc.JSValue.jsNumberFromInt32(0);
                    const length = length_value.toInt32();

                    const prev_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = prev_quote_strings;

                    const map_name = if (value.jsType() == .WeakMap) "WeakMap" else "Map";

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
                        try value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                    }
                    this.writeIndent(Writer, writer_) catch {};
                    writer.writeAll("}");
                    writer.writeAll("\n");
                },
                .Set => {
                    const length_value = try value.get(this.globalThis, "size") orelse jsc.JSValue.jsNumberFromInt32(0);
                    const length = length_value.toInt32();

                    const prev_quote_strings = this.quote_strings;
                    this.quote_strings = true;
                    defer this.quote_strings = prev_quote_strings;

                    this.writeIndent(Writer, writer_) catch {};

                    const set_name = if (value.jsType() == .WeakSet) "WeakSet" else "Set";

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
                        try value.forEach(this.globalThis, &iter, @TypeOf(iter).forEach);
                    }
                    this.writeIndent(Writer, writer_) catch {};
                    writer.writeAll("}");
                    writer.writeAll("\n");
                },
                .JSON => {
                    var str = bun.String.empty;
                    defer str.deref();

                    try value.jsonStringify(this.globalThis, this.indent, &str);
                    this.addForNewLine(str.length());
                    if (jsType == .JSDate) {
                        // in the code for printing dates, it never exceeds this amount
                        var iso_string_buf: [36]u8 = undefined;
                        var out_buf: []const u8 = std.fmt.bufPrint(&iso_string_buf, "{f}", .{str}) catch "";
                        if (out_buf.len > 2) {
                            // trim the quotes
                            out_buf = out_buf[1 .. out_buf.len - 1];
                        }

                        writer.print(comptime Output.prettyFmt("<r><magenta>{s}<r>", enable_ansi_colors), .{out_buf});
                        return;
                    }

                    writer.print("{f}", .{str});
                },
                .Event => {
                    const event_type_value: JSValue = brk: {
                        const value_: JSValue = try value.get(this.globalThis, "type") orelse break :brk .js_undefined;
                        if (value_.isString()) {
                            break :brk value_;
                        }

                        break :brk .js_undefined;
                    };

                    const event_type = switch (try EventType.map.fromJS(this.globalThis, event_type_value) orelse .unknown) {
                        .MessageEvent, .ErrorEvent => |evt| evt,
                        else => {
                            return try this.printAs(.Object, Writer, writer_, value, .Event, enable_ansi_colors);
                        },
                    };

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

                        if (try value.fastGet(this.globalThis, .message)) |message_value| {
                            if (message_value.isString()) {
                                this.writeIndent(Writer, writer_) catch unreachable;
                                writer.print(
                                    comptime Output.prettyFmt("<r><blue>message<d>:<r> ", enable_ansi_colors),
                                    .{},
                                );

                                const tag = try Tag.get(message_value, this.globalThis);
                                try this.format(tag, Writer, writer_, message_value, this.globalThis, enable_ansi_colors);
                                writer.writeAll(", \n");
                            }
                        }

                        switch (event_type) {
                            .MessageEvent => {
                                this.writeIndent(Writer, writer_) catch unreachable;
                                writer.print(
                                    comptime Output.prettyFmt("<r><blue>data<d>:<r> ", enable_ansi_colors),
                                    .{},
                                );
                                const data: JSValue = (try value.fastGet(this.globalThis, .data)) orelse .js_undefined;
                                const tag = try Tag.get(data, this.globalThis);

                                if (tag.cell.isStringLike()) {
                                    try this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                                } else {
                                    try this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                                }
                                writer.writeAll(", \n");
                            },
                            .ErrorEvent => {
                                if (try value.fastGet(this.globalThis, .@"error")) |data| {
                                    this.writeIndent(Writer, writer_) catch unreachable;
                                    writer.print(
                                        comptime Output.prettyFmt("<r><blue>error<d>:<r> ", enable_ansi_colors),
                                        .{},
                                    );

                                    const tag = try Tag.get(data, this.globalThis);
                                    try this.format(tag, Writer, writer_, data, this.globalThis, enable_ansi_colors);
                                    writer.writeAll("\n");
                                }
                            },
                            else => unreachable,
                        }
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

                    if (try value.get(this.globalThis, "type")) |type_value| {
                        const _tag = try Tag.get(type_value, this.globalThis);

                        if (_tag.cell == .Symbol) {} else if (_tag.cell.isStringLike()) {
                            try type_value.toZigString(&tag_name_str, this.globalThis);
                            is_tag_kind_primitive = true;
                        } else if (_tag.cell.isObject() or type_value.isCallable()) {
                            try type_value.getNameProperty(this.globalThis, &tag_name_str);
                            if (tag_name_str.len == 0) {
                                tag_name_str = ZigString.init("NoName");
                            }
                        } else {
                            try type_value.toZigString(&tag_name_str, this.globalThis);
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

                    if (try value.get(this.globalThis, "key")) |key_value| {
                        if (!key_value.isUndefinedOrNull()) {
                            if (needs_space)
                                writer.writeAll(" key=")
                            else
                                writer.writeAll("key=");

                            const old_quote_strings = this.quote_strings;
                            this.quote_strings = true;
                            defer this.quote_strings = old_quote_strings;

                            try this.format(try Tag.get(key_value, this.globalThis), Writer, writer_, key_value, this.globalThis, enable_ansi_colors);

                            needs_space = true;
                        }
                    }

                    if (try value.get(this.globalThis, "props")) |props| {
                        const prev_quote_strings = this.quote_strings;
                        defer this.quote_strings = prev_quote_strings;
                        this.quote_strings = true;

                        // SAFETY: JSX props are always an object.
                        const props_obj = props.getObject().?;
                        var props_iter = try jsc.JSPropertyIterator(.{
                            .skip_empty_name = true,
                            .include_value = true,
                        }).init(this.globalThis, props_obj);
                        defer props_iter.deinit();

                        const children_prop = try props.get(this.globalThis, "children");
                        if (props_iter.len > 0) {
                            {
                                this.indent += 1;
                                defer this.indent -|= 1;
                                const count_without_children = props_iter.len - @as(usize, @intFromBool(children_prop != null));

                                while (try props_iter.next()) |prop| {
                                    if (prop.eqlComptime("children"))
                                        continue;

                                    const property_value = props_iter.value;
                                    const tag = try Tag.get(property_value, this.globalThis);

                                    if (tag.cell.isHidden()) continue;

                                    if (needs_space) writer.writeAll(" ");
                                    needs_space = false;

                                    writer.print(
                                        comptime Output.prettyFmt("<r><blue>{f}<d>=<r>", enable_ansi_colors),
                                        .{prop.trunc(128)},
                                    );

                                    if (tag.cell.isStringLike()) {
                                        if (comptime enable_ansi_colors) {
                                            writer.writeAll(comptime Output.prettyFmt("<r><green>", true));
                                        }
                                    }

                                    try this.format(tag, Writer, writer_, property_value, this.globalThis, enable_ansi_colors);

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
                                const tag = try Tag.get(children, this.globalThis);

                                const print_children = switch (tag.tag) {
                                    .String, .JSX, .Array => true,
                                    else => false,
                                };

                                if (print_children) {
                                    print_children: {
                                        switch (tag.tag) {
                                            .String => {
                                                const children_string = try children.getZigString(this.globalThis);
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
                                                    try this.format(try Tag.get(children, this.globalThis), Writer, writer_, children, this.globalThis, enable_ansi_colors);
                                                }

                                                writer.writeAll("\n");
                                                this.writeIndent(Writer, writer_) catch unreachable;
                                            },
                                            .Array => {
                                                const length = try children.getLength(this.globalThis);
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
                                                        const child = try jsc.JSObject.getIndex(children, this.globalThis, @as(u32, @intCast(j)));
                                                        try this.format(try Tag.get(child, this.globalThis), Writer, writer_, child, this.globalThis, enable_ansi_colors);
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

                    try value.forEachPropertyOrdered(this.globalThis, &iter, Iterator.forEach);

                    if (iter.i == 0) {
                        var object_name = ZigString.Empty;
                        try value.getClassName(this.globalThis, &object_name);

                        if (!object_name.eqlComptime("Object")) {
                            writer.print("{f} {{}}", .{object_name});
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
                        try value.getClassName(this.globalThis, &buffer_name);
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
                            .Float16Array => {
                                const slice_with_type: []align(std.meta.alignment([]f16)) f16 = @alignCast(std.mem.bytesAsSlice(f16, slice));
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

        pub fn format(this: *JestPrettyFormat.Formatter, result: Tag.Result, comptime Writer: type, writer: *std.Io.Writer, value: JSValue, globalThis: *JSGlobalObject, comptime enable_ansi_colors: bool) bun.JSError!void {
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
    ) bun.JSError!bool {
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
            const constructor_value = expect.ExpectAny.js.constructorValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("NotAny<".len);
                writer.writeAll("NotAny<");
            } else {
                this.addForNewLine("Any<".len);
                writer.writeAll("Any<");
            }

            var class_name = ZigString.init(&name_buf);
            try constructor_value.getClassName(this.globalThis, &class_name);
            this.addForNewLine(class_name.len);
            writer.print(comptime Output.prettyFmt("<cyan>{f}<r>", enable_ansi_colors), .{class_name});
            this.addForNewLine(1);
            writer.writeAll(">");
        } else if (value.as(expect.ExpectCloseTo)) |matcher| {
            const number_value = expect.ExpectCloseTo.js.numberValueGetCached(value) orelse return true;
            const digits_value = expect.ExpectCloseTo.js.digitsValueGetCached(value) orelse return true;

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
            const object_value = expect.ExpectObjectContaining.js.objectValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("ObjectNotContaining ".len);
                writer.writeAll("ObjectNotContaining ");
            } else {
                this.addForNewLine("ObjectContaining ".len);
                writer.writeAll("ObjectContaining ");
            }
            try this.printAs(.Object, @TypeOf(writer_), writer_, object_value, .Object, enable_ansi_colors);
        } else if (value.as(expect.ExpectStringContaining)) |matcher| {
            const substring_value = expect.ExpectStringContaining.js.stringValueGetCached(value) orelse return true;

            printAsymmetricMatcherPromisePrefix(matcher.flags, this, writer);
            if (matcher.flags.not) {
                this.addForNewLine("StringNotContaining ".len);
                writer.writeAll("StringNotContaining ");
            } else {
                this.addForNewLine("StringContaining ".len);
                writer.writeAll("StringContaining ");
            }
            try this.printAs(.String, @TypeOf(writer_), writer_, substring_value, .String, enable_ansi_colors);
        } else if (value.as(expect.ExpectStringMatching)) |matcher| {
            const test_value = expect.ExpectStringMatching.js.testValueGetCached(value) orelse return true;

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
            try this.printAs(.String, @TypeOf(writer_), writer_, test_value, .String, enable_ansi_colors);
            this.quote_strings = original_quote_strings;
        } else if (value.as(expect.ExpectCustomAsymmetricMatcher)) |instance| {
            const printed = instance.customPrint(value, this.globalThis, writer_, true) catch unreachable;
            if (!printed) { // default print (non-overridden by user)
                const flags = instance.flags;
                const args_value = expect.ExpectCustomAsymmetricMatcher.js.capturedArgsGetCached(value) orelse return true;
                const matcher_fn = expect.ExpectCustomAsymmetricMatcher.js.matcherFnGetCached(value) orelse return true;
                const matcher_name = try matcher_fn.getName(this.globalThis);

                printAsymmetricMatcherPromisePrefix(flags, this, writer);
                if (flags.not) {
                    this.addForNewLine("not ".len);
                    writer.writeAll("not ");
                }
                this.addForNewLine(matcher_name.length() + 1);
                writer.print("{f}", .{matcher_name});
                writer.writeAll(" ");
                try this.printAs(.Array, @TypeOf(writer_), writer_, args_value, .Array, enable_ansi_colors);
            }
        } else {
            return false;
        }
        return true;
    }
};

const string = []const u8;

const expect = @import("./expect.zig");
const std = @import("std");

const bun = @import("bun");
const JSLexer = bun.js_lexer;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const strings = bun.strings;

const jsc = bun.jsc;
const CAPI = jsc.C;
const JSGlobalObject = jsc.JSGlobalObject;
const JSPromise = jsc.JSPromise;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
