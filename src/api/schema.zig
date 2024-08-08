const std = @import("std");
const bun = @import("root").bun;
const js_ast = bun.JSAst;

pub const Reader = struct {
    const Self = @This();
    pub const ReadError = error{EOF};

    buf: []u8,
    remain: []u8,
    allocator: std.mem.Allocator,

    pub fn init(buf: []u8, allocator: std.mem.Allocator) Reader {
        return Reader{
            .buf = buf,
            .remain = buf,
            .allocator = allocator,
        };
    }

    pub fn read(this: *Self, count: usize) ![]u8 {
        const read_count = @min(count, this.remain.len);
        if (read_count < count) {
            return error.EOF;
        }

        const slice = this.remain[0..read_count];

        this.remain = this.remain[read_count..];

        return slice;
    }

    pub inline fn readAs(this: *Self, comptime T: type) !T {
        if (!std.meta.hasUniqueRepresentation(T)) {
            @compileError(@typeName(T) ++ " must have unique representation.");
        }

        return std.mem.bytesAsValue(T, try this.read(@sizeOf(T)));
    }

    pub inline fn readByte(this: *Self) !u8 {
        return (try this.read(1))[0];
    }

    pub fn readEnum(this: *Self, comptime Enum: type) !Enum {
        const E = error{
            /// An integer was read, but it did not match any of the tags in the supplied enum.
            InvalidValue,
        };
        const type_info = @typeInfo(Enum).Enum;
        const tag = try this.readInt(type_info.tag_type);

        inline for (std.meta.fields(Enum)) |field| {
            if (tag == field.value) {
                return @field(Enum, field.name);
            }
        }

        return E.InvalidValue;
    }

    pub fn readArray(this: *Self, comptime T: type) ![]const T {
        const length = try this.readInt(u32);
        if (length == 0) {
            return &([_]T{});
        }

        switch (comptime T) {
            u8 => {
                return try this.read(length);
            },
            u16, u32, i8, i16, i32 => {
                return std.mem.readIntSliceNative(T, this.read(length * @sizeOf(T)));
            },
            [:0]const u8, []const u8 => {
                const array = try this.allocator.alloc(T, length);
                for (array) |*a| a.* = try this.readArray(u8);
                return array;
            },
            else => {
                switch (comptime @typeInfo(T)) {
                    .Struct => |Struct| {
                        switch (Struct.layout) {
                            .Packed => {
                                const sizeof = @sizeOf(T);
                                const slice = try this.read(sizeof * length);
                                return std.mem.bytesAsSlice(T, slice);
                            },
                            else => {},
                        }
                    },
                    .Enum => |type_info| {
                        const enum_values = try this.read(length * @sizeOf(type_info.tag_type));
                        return @as([*]T, @ptrCast(enum_values.ptr))[0..length];
                    },
                    else => {},
                }

                const array = try this.allocator.alloc(T, length);
                for (array) |*v| v.* = try this.readValue(T);
                return array;
            },
        }
    }

    pub inline fn readByteArray(this: *Self) ![]u8 {
        const length = try this.readInt(u32);
        if (length == 0) {
            return &([_]u8{});
        }

        return try this.read(@as(usize, length));
    }

    pub inline fn readInt(this: *Self, comptime T: type) !T {
        const slice = try this.read(@sizeOf(T));

        return std.mem.readIntSliceNative(T, slice);
    }

    pub inline fn readBool(this: *Self) !bool {
        return (try this.readByte()) > 0;
    }

    pub inline fn readValue(this: *Self, comptime T: type) !T {
        switch (comptime T) {
            bool => {
                return try this.readBool();
            },
            u8 => {
                return try this.readByte();
            },
            [*:0]const u8, [:0]const u8, []const u8 => {
                return try this.readArray(u8);
            },

            []const [:0]const u8, []const [*:0]const u8, []const []const u8 => {
                return try this.readArray([]const u8);
            },
            []u8, [:0]u8, [*:0]u8 => {
                return try this.readArray([]u8);
            },
            u16, u32, i8, i16, i32 => {
                return std.mem.readIntSliceNative(T, try this.read(@sizeOf(T)));
            },
            else => {
                switch (comptime @typeInfo(T)) {
                    .Struct => |Struct| {
                        switch (Struct.layout) {
                            .Packed => {
                                const sizeof = @sizeOf(T);
                                var slice = try this.read(sizeof);
                                return @as(*align(1) T, @ptrCast(slice[0..sizeof])).*;
                            },
                            else => {},
                        }
                    },
                    .Enum => {
                        return try this.readEnum(T);
                    },
                    else => {},
                }

                return try T.decode(this);
            },
        }

        @compileError("Invalid type passed to readValue");
    }
};

pub fn Writer(comptime WritableStream: type) type {
    return struct {
        const Self = @This();
        writable: WritableStream,

        pub fn init(writable: WritableStream) Self {
            return Self{ .writable = writable };
        }

        pub inline fn write(this: *Self, bytes: anytype) !void {
            _ = try this.writable.write(bytes);
        }

        pub inline fn writeByte(this: *Self, byte: u8) !void {
            _ = try this.writable.write(&[1]u8{byte});
        }

        pub inline fn writeInt(this: *Self, int: anytype) !void {
            try this.write(std.mem.asBytes(&int));
        }

        pub inline fn writeFieldID(this: *Self, comptime id: comptime_int) !void {
            try this.writeByte(id);
        }

        pub inline fn writeEnum(this: *Self, val: anytype) !void {
            try this.writeInt(@intFromEnum(val));
        }

        pub fn writeValue(this: *Self, comptime SliceType: type, slice: SliceType) !void {
            switch (SliceType) {
                []u16,
                []u32,
                []i16,
                []i32,
                []i8,
                []const u16,
                []const u32,
                []const i16,
                []const i32,
                []const i8,
                [:0]u16,
                [:0]u32,
                [:0]i16,
                [:0]i32,
                [:0]i8,
                [:0]const u16,
                [:0]const u32,
                [:0]const i16,
                [:0]const i32,
                [:0]const i8,
                [*:0]u16,
                [*:0]u32,
                [*:0]i16,
                [*:0]i32,
                [*:0]i8,
                [*:0]const u16,
                [*:0]const u32,
                [*:0]const i16,
                [*:0]const i32,
                [*:0]const i8,
                => {
                    try this.writeArray(SliceType, slice);
                },

                []u8,
                []const u8,
                [:0]u8,
                [:0]const u8,
                [*:0]u8,
                [*:0]const u8,
                => {
                    try this.writeArray(u8, slice);
                },

                u8 => {
                    try this.write(slice);
                },
                u16, u32, i16, i32, i8 => {
                    try this.write(std.mem.asBytes(slice));
                },

                else => {
                    try slice.encode(this);
                },
            }
        }

        pub fn writeArray(this: *Self, comptime T: type, slice: anytype) !void {
            try this.writeInt(@as(u32, @truncate(slice.len)));

            switch (T) {
                u8 => {
                    try this.write(slice);
                },
                u16, u32, i16, i32, i8 => {
                    try this.write(std.mem.asBytes(slice));
                },
                [:0]u8,
                []u8,
                []u16,
                []u32,
                []i16,
                []i32,
                []i8,
                []const u8,
                [:0]const u8,
                []const u16,
                []const u32,
                []const i16,
                []const i32,
                []const i8,
                [:0]u16,
                [:0]u32,
                [:0]i16,
                [:0]i32,
                [:0]i8,
                [:0]const u16,
                [:0]const u32,
                [:0]const i16,
                [:0]const i32,
                [:0]const i8,
                [*:0]u16,
                [*:0]u32,
                [*:0]i16,
                [*:0]i32,
                [*:0]i8,
                [*:0]const u16,
                [*:0]const u32,
                [*:0]const i16,
                [*:0]const i32,
                [*:0]const i8,
                => {
                    for (slice) |num_slice| {
                        try this.writeArray(std.meta.Child(@TypeOf(num_slice)), num_slice);
                    }
                },
                else => {
                    for (slice) |val| {
                        try val.encode(this);
                    }
                },
            }
        }

        pub inline fn endMessage(this: *Self) !void {
            try this.writeByte(0);
        }
    };
}

pub const ByteWriter = Writer(*std.io.FixedBufferStream([]u8));
pub const FileWriter = Writer(std.fs.File);

pub const Api = struct {
    pub const Loader = enum(u8) {
        _none,
        jsx,
        js,
        ts,
        tsx,
        css,
        file,
        json,
        toml,
        wasm,
        napi,
        base64,
        dataurl,
        text,
        sqlite,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const FrameworkEntryPointType = enum(u8) {
        _none,
        /// client
        client,

        /// server
        server,

        /// fallback
        fallback,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const StackFrameScope = enum(u8) {
        _none,
        /// Eval
        eval,

        /// Module
        module,

        /// Function
        function,

        /// Global
        global,

        /// Wasm
        wasm,

        /// Constructor
        constructor,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const StackFrame = struct {
        /// function_name
        function_name: []const u8,

        /// file
        file: []const u8,

        /// position
        position: StackFramePosition,

        /// scope
        scope: StackFrameScope,

        pub fn decode(reader: anytype) anyerror!StackFrame {
            var this = std.mem.zeroes(StackFrame);

            this.function_name = try reader.readValue([]const u8);
            this.file = try reader.readValue([]const u8);
            this.position = try reader.readValue(StackFramePosition);
            this.scope = try reader.readValue(StackFrameScope);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.function_name), this.function_name);
            try writer.writeValue(@TypeOf(this.file), this.file);
            try writer.writeValue(@TypeOf(this.position), this.position);
            try writer.writeEnum(this.scope);
        }
    };

    pub const StackFramePosition = bun.JSC.ZigStackFramePosition;

    pub const SourceLine = struct {
        /// line
        line: i32 = 0,

        /// text
        text: []const u8,

        pub fn decode(reader: anytype) anyerror!SourceLine {
            var this = std.mem.zeroes(SourceLine);

            this.line = try reader.readValue(i32);
            this.text = try reader.readValue([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.line);
            try writer.writeValue(@TypeOf(this.text), this.text);
        }
    };

    pub const StackTrace = struct {
        /// source_lines
        source_lines: []const SourceLine,

        /// frames
        frames: []const StackFrame,

        pub fn decode(reader: anytype) anyerror!StackTrace {
            var this = std.mem.zeroes(StackTrace);

            this.source_lines = try reader.readArray(SourceLine);
            this.frames = try reader.readArray(StackFrame);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray(SourceLine, this.source_lines);
            try writer.writeArray(StackFrame, this.frames);
        }
    };

    pub const JsException = struct {
        /// name
        name: ?[]const u8 = null,

        /// message
        message: ?[]const u8 = null,

        /// runtime_type
        runtime_type: ?u16 = null,

        /// code
        code: ?u8 = null,

        /// stack
        stack: ?StackTrace = null,

        pub fn decode(reader: anytype) anyerror!JsException {
            var this = std.mem.zeroes(JsException);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.name = try reader.readValue([]const u8);
                    },
                    2 => {
                        this.message = try reader.readValue([]const u8);
                    },
                    3 => {
                        this.runtime_type = try reader.readValue(u16);
                    },
                    4 => {
                        this.code = try reader.readValue(u8);
                    },
                    5 => {
                        this.stack = try reader.readValue(StackTrace);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.name) |name| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(name), name);
            }
            if (this.message) |message| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(message), message);
            }
            if (this.runtime_type) |runtime_type| {
                try writer.writeFieldID(3);
                try writer.writeInt(runtime_type);
            }
            if (this.code) |code| {
                try writer.writeFieldID(4);
                try writer.writeInt(code);
            }
            if (this.stack) |stack| {
                try writer.writeFieldID(5);
                try writer.writeValue(@TypeOf(stack), stack);
            }
            try writer.endMessage();
        }
    };

    pub const FallbackStep = enum(u8) {
        _none,
        /// ssr_disabled
        ssr_disabled,

        /// create_vm
        create_vm,

        /// configure_router
        configure_router,

        /// configure_defines
        configure_defines,

        /// resolve_entry_point
        resolve_entry_point,

        /// load_entry_point
        load_entry_point,

        /// eval_entry_point
        eval_entry_point,

        /// fetch_event_handler
        fetch_event_handler,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const Problems = struct {
        /// code
        code: u16 = 0,

        /// name
        name: []const u8,

        /// exceptions
        exceptions: []const JsException,

        /// build
        build: Log,

        pub fn decode(reader: anytype) anyerror!Problems {
            var this = std.mem.zeroes(Problems);

            this.code = try reader.readValue(u16);
            this.name = try reader.readValue([]const u8);
            this.exceptions = try reader.readArray(JsException);
            this.build = try reader.readValue(Log);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.code);
            try writer.writeValue(@TypeOf(this.name), this.name);
            try writer.writeArray(JsException, this.exceptions);
            try writer.writeValue(@TypeOf(this.build), this.build);
        }
    };

    pub const Router = struct {
        /// routes
        routes: StringMap,

        /// route
        route: i32 = 0,

        /// params
        params: StringMap,

        pub fn decode(reader: anytype) anyerror!Router {
            var this = std.mem.zeroes(Router);

            this.routes = try reader.readValue(StringMap);
            this.route = try reader.readValue(i32);
            this.params = try reader.readValue(StringMap);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.routes), this.routes);
            try writer.writeInt(this.route);
            try writer.writeValue(@TypeOf(this.params), this.params);
        }
    };

    pub const FallbackMessageContainer = struct {
        /// message
        message: ?[]const u8 = null,

        /// router
        router: ?Router = null,

        /// reason
        reason: ?FallbackStep = null,

        /// problems
        problems: ?Problems = null,

        /// cwd
        cwd: ?[]const u8 = null,

        pub fn decode(reader: anytype) anyerror!FallbackMessageContainer {
            var this = std.mem.zeroes(FallbackMessageContainer);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.message = try reader.readValue([]const u8);
                    },
                    2 => {
                        this.router = try reader.readValue(Router);
                    },
                    3 => {
                        this.reason = try reader.readValue(FallbackStep);
                    },
                    4 => {
                        this.problems = try reader.readValue(Problems);
                    },
                    5 => {
                        this.cwd = try reader.readValue([]const u8);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.message) |message| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(message), message);
            }
            if (this.router) |router| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(router), router);
            }
            if (this.reason) |reason| {
                try writer.writeFieldID(3);
                try writer.writeEnum(reason);
            }
            if (this.problems) |problems| {
                try writer.writeFieldID(4);
                try writer.writeValue(@TypeOf(problems), problems);
            }
            if (this.cwd) |cwd| {
                try writer.writeFieldID(5);
                try writer.writeValue(@TypeOf(cwd), cwd);
            }
            try writer.endMessage();
        }
    };

    pub const ResolveMode = enum(u8) {
        _none,
        /// disable
        disable,

        /// lazy
        lazy,

        /// dev
        dev,

        /// bundle
        bundle,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const Target = enum(u8) {
        _none,
        /// browser
        browser,

        /// node
        node,

        /// bun
        bun,

        /// bun_macro
        bun_macro,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const CssInJsBehavior = enum(u8) {
        _none,
        /// facade
        facade,

        /// facade_onimportcss
        facade_onimportcss,

        /// auto_onimportcss
        auto_onimportcss,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const JsxRuntime = enum(u8) {
        _none,
        /// automatic
        automatic,

        /// classic
        classic,

        /// solid
        solid,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const Jsx = struct {
        /// factory
        factory: []const u8,

        /// runtime
        runtime: JsxRuntime,

        /// fragment
        fragment: []const u8,

        /// development
        development: bool = false,

        /// import_source
        import_source: []const u8,

        /// react_fast_refresh
        react_fast_refresh: bool = false,

        pub fn decode(reader: anytype) anyerror!Jsx {
            var this = std.mem.zeroes(Jsx);

            this.factory = try reader.readValue([]const u8);
            this.runtime = try reader.readValue(JsxRuntime);
            this.fragment = try reader.readValue([]const u8);
            this.development = try reader.readValue(bool);
            this.import_source = try reader.readValue([]const u8);
            this.react_fast_refresh = try reader.readValue(bool);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.factory), this.factory);
            try writer.writeEnum(this.runtime);
            try writer.writeValue(@TypeOf(this.fragment), this.fragment);
            try writer.writeInt(@as(u8, @intFromBool(this.development)));
            try writer.writeValue(@TypeOf(this.import_source), this.import_source);
            try writer.writeInt(@as(u8, @intFromBool(this.react_fast_refresh)));
        }
    };

    /// Represents a slice stored within an externally stored buffer. Safe to serialize.
    /// Must be an extern struct to match with `headers-handwritten.h`.
    pub const StringPointer = extern struct {
        /// offset
        offset: u32 = 0,

        /// length
        length: u32 = 0,

        comptime {
            bun.assert(@alignOf(StringPointer) == @alignOf(u32));
            bun.assert(@sizeOf(StringPointer) == @sizeOf(u64));
        }

        pub fn decode(reader: anytype) anyerror!StringPointer {
            var this = std.mem.zeroes(StringPointer);

            this.offset = try reader.readValue(u32);
            this.length = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.offset);
            try writer.writeInt(this.length);
        }

        pub fn slice(this: @This(), bytes: []const u8) []const u8 {
            return bytes[this.offset .. this.offset + this.length];
        }
    };

    pub const JavascriptBundledModule = struct {
        /// path
        path: StringPointer,

        /// code
        code: StringPointer,

        /// package_id
        package_id: u32 = 0,

        /// id
        id: u32 = 0,

        /// path_extname_length
        path_extname_length: u8 = 0,

        pub fn decode(reader: anytype) anyerror!JavascriptBundledModule {
            var this = std.mem.zeroes(JavascriptBundledModule);

            this.path = try reader.readValue(StringPointer);
            this.code = try reader.readValue(StringPointer);
            this.package_id = try reader.readValue(u32);
            this.id = try reader.readValue(u32);
            this.path_extname_length = try reader.readValue(u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.path), this.path);
            try writer.writeValue(@TypeOf(this.code), this.code);
            try writer.writeInt(this.package_id);
            try writer.writeInt(this.id);
            try writer.writeInt(this.path_extname_length);
        }
    };

    pub const JavascriptBundledPackage = struct {
        /// name
        name: StringPointer,

        /// version
        version: StringPointer,

        /// hash
        hash: u32 = 0,

        /// modules_offset
        modules_offset: u32 = 0,

        /// modules_length
        modules_length: u32 = 0,

        pub fn decode(reader: anytype) anyerror!JavascriptBundledPackage {
            var this = std.mem.zeroes(JavascriptBundledPackage);

            this.name = try reader.readValue(StringPointer);
            this.version = try reader.readValue(StringPointer);
            this.hash = try reader.readValue(u32);
            this.modules_offset = try reader.readValue(u32);
            this.modules_length = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.name), this.name);
            try writer.writeValue(@TypeOf(this.version), this.version);
            try writer.writeInt(this.hash);
            try writer.writeInt(this.modules_offset);
            try writer.writeInt(this.modules_length);
        }
    };

    pub const JavascriptBundle = struct {
        /// modules
        modules: []const JavascriptBundledModule,

        /// packages
        packages: []const JavascriptBundledPackage,

        /// etag
        etag: []const u8,

        /// generated_at
        generated_at: u32 = 0,

        /// app_package_json_dependencies_hash
        app_package_json_dependencies_hash: []const u8,

        /// import_from_name
        import_from_name: []const u8,

        /// manifest_string
        manifest_string: []const u8,

        pub fn decode(reader: anytype) anyerror!JavascriptBundle {
            var this = std.mem.zeroes(JavascriptBundle);

            this.modules = try reader.readArray(JavascriptBundledModule);
            this.packages = try reader.readArray(JavascriptBundledPackage);
            this.etag = try reader.readArray(u8);
            this.generated_at = try reader.readValue(u32);
            this.app_package_json_dependencies_hash = try reader.readArray(u8);
            this.import_from_name = try reader.readArray(u8);
            this.manifest_string = try reader.readArray(u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray(JavascriptBundledModule, this.modules);
            try writer.writeArray(JavascriptBundledPackage, this.packages);
            try writer.writeArray(u8, this.etag);
            try writer.writeInt(this.generated_at);
            try writer.writeArray(u8, this.app_package_json_dependencies_hash);
            try writer.writeArray(u8, this.import_from_name);
            try writer.writeArray(u8, this.manifest_string);
        }
    };

    pub const JavascriptBundleContainer = struct {
        /// bundle_format_version
        bundle_format_version: ?u32 = null,

        /// routes
        routes: ?LoadedRouteConfig = null,

        /// framework
        framework: ?LoadedFramework = null,

        /// bundle
        bundle: ?JavascriptBundle = null,

        /// code_length
        code_length: ?u32 = null,

        pub fn decode(reader: anytype) anyerror!JavascriptBundleContainer {
            var this = std.mem.zeroes(JavascriptBundleContainer);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.bundle_format_version = try reader.readValue(u32);
                    },
                    2 => {
                        this.routes = try reader.readValue(LoadedRouteConfig);
                    },
                    3 => {
                        this.framework = try reader.readValue(LoadedFramework);
                    },
                    4 => {
                        this.bundle = try reader.readValue(JavascriptBundle);
                    },
                    5 => {
                        this.code_length = try reader.readValue(u32);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.bundle_format_version) |bundle_format_version| {
                try writer.writeFieldID(1);
                try writer.writeInt(bundle_format_version);
            }
            if (this.routes) |routes| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(routes), routes);
            }
            if (this.framework) |framework| {
                try writer.writeFieldID(3);
                try writer.writeValue(@TypeOf(framework), framework);
            }
            if (this.bundle) |bundle| {
                try writer.writeFieldID(4);
                try writer.writeValue(@TypeOf(bundle), bundle);
            }
            if (this.code_length) |code_length| {
                try writer.writeFieldID(5);
                try writer.writeInt(code_length);
            }
            try writer.endMessage();
        }
    };

    pub const ScanDependencyMode = enum(u8) {
        _none,
        /// app
        app,

        /// all
        all,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const ModuleImportType = enum(u8) {
        _none,
        /// import
        import,

        /// require
        require,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const ModuleImportRecord = struct {
        /// kind
        kind: ModuleImportType,

        /// path
        path: []const u8,

        /// dynamic
        dynamic: bool = false,

        pub fn decode(reader: anytype) anyerror!ModuleImportRecord {
            var this = std.mem.zeroes(ModuleImportRecord);

            this.kind = try reader.readValue(ModuleImportType);
            this.path = try reader.readValue([]const u8);
            this.dynamic = try reader.readValue(bool);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeEnum(this.kind);
            try writer.writeValue(@TypeOf(this.path), this.path);
            try writer.writeInt(@as(u8, @intFromBool(this.dynamic)));
        }
    };

    pub const Module = struct {
        /// path
        path: []const u8,

        /// imports
        imports: []const ModuleImportRecord,

        pub fn decode(reader: anytype) anyerror!Module {
            var this = std.mem.zeroes(Module);

            this.path = try reader.readValue([]const u8);
            this.imports = try reader.readArray(ModuleImportRecord);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.path), this.path);
            try writer.writeArray(ModuleImportRecord, this.imports);
        }
    };

    pub const StringMap = struct {
        /// keys
        keys: []const []const u8,

        /// values
        values: []const []const u8,

        pub fn decode(reader: anytype) anyerror!StringMap {
            var this = std.mem.zeroes(StringMap);

            this.keys = try reader.readArray([]const u8);
            this.values = try reader.readArray([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray([]const u8, this.keys);
            try writer.writeArray([]const u8, this.values);
        }
    };

    pub const LoaderMap = struct {
        /// extensions
        extensions: []const []const u8,

        /// loaders
        loaders: []const Loader,

        pub fn decode(reader: anytype) anyerror!LoaderMap {
            var this = std.mem.zeroes(LoaderMap);

            this.extensions = try reader.readArray([]const u8);
            this.loaders = try reader.readArray(Loader);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray([]const u8, this.extensions);
            try writer.writeArray(Loader, this.loaders);
        }
    };

    pub const DotEnvBehavior = enum(u32) {
        _none,
        /// disable
        disable,

        /// prefix
        prefix,

        /// load_all
        load_all,

        /// load_all_without_inlining
        load_all_without_inlining,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const EnvConfig = struct {
        /// prefix
        prefix: ?[]const u8 = null,

        /// defaults
        defaults: ?StringMap = null,

        pub fn decode(reader: anytype) anyerror!EnvConfig {
            var this = std.mem.zeroes(EnvConfig);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.prefix = try reader.readValue([]const u8);
                    },
                    2 => {
                        this.defaults = try reader.readValue(StringMap);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.prefix) |prefix| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(prefix), prefix);
            }
            if (this.defaults) |defaults| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(defaults), defaults);
            }
            try writer.endMessage();
        }
    };

    pub const LoadedEnvConfig = struct {
        /// dotenv
        dotenv: DotEnvBehavior,

        /// defaults
        defaults: StringMap,

        /// prefix
        prefix: []const u8,

        pub fn decode(reader: anytype) anyerror!LoadedEnvConfig {
            var this = std.mem.zeroes(LoadedEnvConfig);

            this.dotenv = try reader.readValue(DotEnvBehavior);
            this.defaults = try reader.readValue(StringMap);
            this.prefix = try reader.readValue([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeEnum(this.dotenv);
            try writer.writeValue(@TypeOf(this.defaults), this.defaults);
            try writer.writeValue(@TypeOf(this.prefix), this.prefix);
        }
    };

    pub const FrameworkConfig = struct {
        /// package
        package: ?[]const u8 = null,

        /// client
        client: ?FrameworkEntryPointMessage = null,

        /// server
        server: ?FrameworkEntryPointMessage = null,

        /// fallback
        fallback: ?FrameworkEntryPointMessage = null,

        /// development
        development: ?bool = null,

        /// client_css_in_js
        client_css_in_js: ?CssInJsBehavior = null,

        /// display_name
        display_name: ?[]const u8 = null,

        /// overrideModules
        override_modules: ?StringMap = null,

        pub fn decode(reader: anytype) anyerror!FrameworkConfig {
            var this = std.mem.zeroes(FrameworkConfig);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.package = try reader.readValue([]const u8);
                    },
                    2 => {
                        this.client = try reader.readValue(FrameworkEntryPointMessage);
                    },
                    3 => {
                        this.server = try reader.readValue(FrameworkEntryPointMessage);
                    },
                    4 => {
                        this.fallback = try reader.readValue(FrameworkEntryPointMessage);
                    },
                    5 => {
                        this.development = try reader.readValue(bool);
                    },
                    6 => {
                        this.client_css_in_js = try reader.readValue(CssInJsBehavior);
                    },
                    7 => {
                        this.display_name = try reader.readValue([]const u8);
                    },
                    8 => {
                        this.override_modules = try reader.readValue(StringMap);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.package) |package| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(package), package);
            }
            if (this.client) |client| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(client), client);
            }
            if (this.server) |server| {
                try writer.writeFieldID(3);
                try writer.writeValue(@TypeOf(server), server);
            }
            if (this.fallback) |fallback| {
                try writer.writeFieldID(4);
                try writer.writeValue(@TypeOf(fallback), fallback);
            }
            if (this.development) |development| {
                try writer.writeFieldID(5);
                try writer.writeInt(@as(u8, @intFromBool(development)));
            }
            if (this.client_css_in_js) |client_css_in_js| {
                try writer.writeFieldID(6);
                try writer.writeEnum(client_css_in_js);
            }
            if (this.display_name) |display_name| {
                try writer.writeFieldID(7);
                try writer.writeValue(@TypeOf(display_name), display_name);
            }
            if (this.override_modules) |override_modules| {
                try writer.writeFieldID(8);
                try writer.writeValue(@TypeOf(override_modules), override_modules);
            }
            try writer.endMessage();
        }
    };

    pub const FrameworkEntryPoint = struct {
        /// kind
        kind: FrameworkEntryPointType,

        /// path
        path: []const u8,

        /// env
        env: LoadedEnvConfig,

        pub fn decode(reader: anytype) anyerror!FrameworkEntryPoint {
            var this = std.mem.zeroes(FrameworkEntryPoint);

            this.kind = try reader.readValue(FrameworkEntryPointType);
            this.path = try reader.readValue([]const u8);
            this.env = try reader.readValue(LoadedEnvConfig);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeEnum(this.kind);
            try writer.writeValue(@TypeOf(this.path), this.path);
            try writer.writeValue(@TypeOf(this.env), this.env);
        }
    };

    pub const FrameworkEntryPointMap = struct {
        /// client
        client: ?FrameworkEntryPoint = null,

        /// server
        server: ?FrameworkEntryPoint = null,

        /// fallback
        fallback: ?FrameworkEntryPoint = null,

        pub fn decode(reader: anytype) anyerror!FrameworkEntryPointMap {
            var this = std.mem.zeroes(FrameworkEntryPointMap);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.client = try reader.readValue(FrameworkEntryPoint);
                    },
                    2 => {
                        this.server = try reader.readValue(FrameworkEntryPoint);
                    },
                    3 => {
                        this.fallback = try reader.readValue(FrameworkEntryPoint);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.client) |client| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(client), client);
            }
            if (this.server) |server| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(server), server);
            }
            if (this.fallback) |fallback| {
                try writer.writeFieldID(3);
                try writer.writeValue(@TypeOf(fallback), fallback);
            }
            try writer.endMessage();
        }
    };

    pub const FrameworkEntryPointMessage = struct {
        /// path
        path: ?[]const u8 = null,

        /// env
        env: ?EnvConfig = null,

        pub fn decode(reader: anytype) anyerror!FrameworkEntryPointMessage {
            var this = std.mem.zeroes(FrameworkEntryPointMessage);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.path = try reader.readValue([]const u8);
                    },
                    2 => {
                        this.env = try reader.readValue(EnvConfig);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.path) |path| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(path), path);
            }
            if (this.env) |env| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(env), env);
            }
            try writer.endMessage();
        }
    };

    pub const LoadedFramework = struct {
        /// package
        package: []const u8,

        /// display_name
        display_name: []const u8,

        /// development
        development: bool = false,

        /// entry_points
        entry_points: FrameworkEntryPointMap,

        /// client_css_in_js
        client_css_in_js: CssInJsBehavior,

        /// overrideModules
        override_modules: StringMap,

        pub fn decode(reader: anytype) anyerror!LoadedFramework {
            var this = std.mem.zeroes(LoadedFramework);

            this.package = try reader.readValue([]const u8);
            this.display_name = try reader.readValue([]const u8);
            this.development = try reader.readValue(bool);
            this.entry_points = try reader.readValue(FrameworkEntryPointMap);
            this.client_css_in_js = try reader.readValue(CssInJsBehavior);
            this.override_modules = try reader.readValue(StringMap);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.package), this.package);
            try writer.writeValue(@TypeOf(this.display_name), this.display_name);
            try writer.writeInt(@as(u8, @intFromBool(this.development)));
            try writer.writeValue(@TypeOf(this.entry_points), this.entry_points);
            try writer.writeEnum(this.client_css_in_js);
            try writer.writeValue(@TypeOf(this.override_modules), this.override_modules);
        }
    };

    pub const LoadedRouteConfig = struct {
        /// dir
        dir: []const u8,

        /// extensions
        extensions: []const []const u8,

        /// static_dir
        static_dir: []const u8,

        /// asset_prefix
        asset_prefix: []const u8,

        pub fn decode(reader: anytype) anyerror!LoadedRouteConfig {
            var this = std.mem.zeroes(LoadedRouteConfig);

            this.dir = try reader.readValue([]const u8);
            this.extensions = try reader.readArray([]const u8);
            this.static_dir = try reader.readValue([]const u8);
            this.asset_prefix = try reader.readValue([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.dir), this.dir);
            try writer.writeArray([]const u8, this.extensions);
            try writer.writeValue(@TypeOf(this.static_dir), this.static_dir);
            try writer.writeValue(@TypeOf(this.asset_prefix), this.asset_prefix);
        }
    };

    pub const RouteConfig = struct {
        /// dir
        dir: []const []const u8,

        /// extensions
        extensions: []const []const u8,

        /// static_dir
        static_dir: ?[]const u8 = null,

        /// asset_prefix
        asset_prefix: ?[]const u8 = null,

        pub fn decode(reader: anytype) anyerror!RouteConfig {
            var this = std.mem.zeroes(RouteConfig);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.dir = try reader.readArray([]const u8);
                    },
                    2 => {
                        this.extensions = try reader.readArray([]const u8);
                    },
                    3 => {
                        this.static_dir = try reader.readValue([]const u8);
                    },
                    4 => {
                        this.asset_prefix = try reader.readValue([]const u8);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.dir) |dir| {
                try writer.writeFieldID(1);
                try writer.writeArray([]const u8, dir);
            }
            if (this.extensions) |extensions| {
                try writer.writeFieldID(2);
                try writer.writeArray([]const u8, extensions);
            }
            if (this.static_dir) |static_dir| {
                try writer.writeFieldID(3);
                try writer.writeValue(@TypeOf(static_dir), static_dir);
            }
            if (this.asset_prefix) |asset_prefix| {
                try writer.writeFieldID(4);
                try writer.writeValue(@TypeOf(asset_prefix), asset_prefix);
            }
            try writer.endMessage();
        }
    };

    pub const TransformOptions = struct {
        /// jsx
        jsx: ?Jsx = null,

        /// tsconfig_override
        tsconfig_override: ?[]const u8 = null,

        /// resolve
        resolve: ?ResolveMode = null,

        /// origin
        origin: ?[]const u8 = null,

        /// absolute_working_dir
        absolute_working_dir: ?[]const u8 = null,

        /// define
        define: ?StringMap = null,

        /// preserve_symlinks
        preserve_symlinks: ?bool = null,

        /// entry_points
        entry_points: []const []const u8,

        /// write
        write: ?bool = null,

        /// inject
        inject: []const []const u8,

        /// output_dir
        output_dir: ?[]const u8 = null,

        /// external
        external: []const []const u8,

        /// loaders
        loaders: ?LoaderMap = null,

        /// main_fields
        main_fields: []const []const u8,

        /// target
        target: ?Target = null,

        /// serve
        serve: ?bool = null,

        /// env_files
        env_files: []const []const u8,

        /// extension_order
        extension_order: []const []const u8,

        /// framework
        framework: ?FrameworkConfig = null,

        /// router
        router: ?RouteConfig = null,

        /// no_summary
        no_summary: ?bool = null,

        /// disable_hmr
        disable_hmr: ?bool = null,

        /// port
        port: ?u16 = null,

        /// logLevel
        log_level: ?MessageLevel = null,

        /// source_map
        source_map: ?SourceMapMode = null,

        /// conditions
        conditions: []const []const u8,

        /// packages
        packages: ?PackagesMode = null,

        /// ignore_dce_annotations
        ignore_dce_annotations: bool,

        pub fn decode(reader: anytype) anyerror!TransformOptions {
            var this = std.mem.zeroes(TransformOptions);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.jsx = try reader.readValue(Jsx);
                    },
                    2 => {
                        this.tsconfig_override = try reader.readValue([]const u8);
                    },
                    3 => {
                        this.resolve = try reader.readValue(ResolveMode);
                    },
                    4 => {
                        this.origin = try reader.readValue([]const u8);
                    },
                    5 => {
                        this.absolute_working_dir = try reader.readValue([]const u8);
                    },
                    6 => {
                        this.define = try reader.readValue(StringMap);
                    },
                    7 => {
                        this.preserve_symlinks = try reader.readValue(bool);
                    },
                    8 => {
                        this.entry_points = try reader.readArray([]const u8);
                    },
                    9 => {
                        this.write = try reader.readValue(bool);
                    },
                    10 => {
                        this.inject = try reader.readArray([]const u8);
                    },
                    11 => {
                        this.output_dir = try reader.readValue([]const u8);
                    },
                    12 => {
                        this.external = try reader.readArray([]const u8);
                    },
                    13 => {
                        this.loaders = try reader.readValue(LoaderMap);
                    },
                    14 => {
                        this.main_fields = try reader.readArray([]const u8);
                    },
                    15 => {
                        this.target = try reader.readValue(Target);
                    },
                    16 => {
                        this.serve = try reader.readValue(bool);
                    },
                    17 => {
                        this.env_files = try reader.readArray([]const u8);
                    },
                    18 => {
                        this.extension_order = try reader.readArray([]const u8);
                    },
                    19 => {
                        this.framework = try reader.readValue(FrameworkConfig);
                    },
                    20 => {
                        this.router = try reader.readValue(RouteConfig);
                    },
                    21 => {
                        this.no_summary = try reader.readValue(bool);
                    },
                    22 => {
                        this.disable_hmr = try reader.readValue(bool);
                    },
                    23 => {
                        this.port = try reader.readValue(u16);
                    },
                    24 => {
                        this.log_level = try reader.readValue(MessageLevel);
                    },
                    25 => {
                        this.source_map = try reader.readValue(SourceMapMode);
                    },
                    26 => {
                        this.conditions = try reader.readArray([]const u8);
                    },
                    27 => {
                        this.packages = try reader.readValue(PackagesMode);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.jsx) |jsx| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(jsx), jsx);
            }
            if (this.tsconfig_override) |tsconfig_override| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(tsconfig_override), tsconfig_override);
            }
            if (this.resolve) |resolve| {
                try writer.writeFieldID(3);
                try writer.writeEnum(resolve);
            }
            if (this.origin) |origin| {
                try writer.writeFieldID(4);
                try writer.writeValue(@TypeOf(origin), origin);
            }
            if (this.absolute_working_dir) |absolute_working_dir| {
                try writer.writeFieldID(5);
                try writer.writeValue(@TypeOf(absolute_working_dir), absolute_working_dir);
            }
            if (this.define) |define| {
                try writer.writeFieldID(6);
                try writer.writeValue(@TypeOf(define), define);
            }
            if (this.preserve_symlinks) |preserve_symlinks| {
                try writer.writeFieldID(7);
                try writer.writeInt(@as(u8, @intFromBool(preserve_symlinks)));
            }
            if (this.entry_points) |entry_points| {
                try writer.writeFieldID(8);
                try writer.writeArray([]const u8, entry_points);
            }
            if (this.write) |write| {
                try writer.writeFieldID(9);
                try writer.writeInt(@as(u8, @intFromBool(write)));
            }
            if (this.inject) |inject| {
                try writer.writeFieldID(10);
                try writer.writeArray([]const u8, inject);
            }
            if (this.output_dir) |output_dir| {
                try writer.writeFieldID(11);
                try writer.writeValue(@TypeOf(output_dir), output_dir);
            }
            if (this.external) |external| {
                try writer.writeFieldID(12);
                try writer.writeArray([]const u8, external);
            }
            if (this.loaders) |loaders| {
                try writer.writeFieldID(13);
                try writer.writeValue(@TypeOf(loaders), loaders);
            }
            if (this.main_fields) |main_fields| {
                try writer.writeFieldID(14);
                try writer.writeArray([]const u8, main_fields);
            }
            if (this.target) |target| {
                try writer.writeFieldID(15);
                try writer.writeEnum(target);
            }
            if (this.serve) |serve| {
                try writer.writeFieldID(16);
                try writer.writeInt(@as(u8, @intFromBool(serve)));
            }
            if (this.env_files) |env_files| {
                try writer.writeFieldID(17);
                try writer.writeArray([]const u8, env_files);
            }
            if (this.extension_order) |extension_order| {
                try writer.writeFieldID(18);
                try writer.writeArray([]const u8, extension_order);
            }
            if (this.framework) |framework| {
                try writer.writeFieldID(19);
                try writer.writeValue(@TypeOf(framework), framework);
            }
            if (this.router) |router| {
                try writer.writeFieldID(20);
                try writer.writeValue(@TypeOf(router), router);
            }
            if (this.no_summary) |no_summary| {
                try writer.writeFieldID(21);
                try writer.writeInt(@as(u8, @intFromBool(no_summary)));
            }
            if (this.disable_hmr) |disable_hmr| {
                try writer.writeFieldID(22);
                try writer.writeInt(@as(u8, @intFromBool(disable_hmr)));
            }
            if (this.port) |port| {
                try writer.writeFieldID(23);
                try writer.writeInt(port);
            }
            if (this.log_level) |log_level| {
                try writer.writeFieldID(24);
                try writer.writeEnum(log_level);
            }
            if (this.source_map) |source_map| {
                try writer.writeFieldID(25);
                try writer.writeEnum(source_map);
            }

            if (this.conditions) |conditions| {
                try writer.writeFieldID(26);
                try writer.writeArray([]const u8, conditions);
            }

            if (this.packages) |packages| {
                try writer.writeFieldID(27);
                try writer.writeValue([]const u8, packages);
            }

            try writer.endMessage();
        }
    };

    pub const SourceMapMode = enum(u8) {
        none,

        /// inline
        @"inline",

        /// external
        external,

        linked,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const PackagesMode = enum(u8) {
        /// bundle
        bundle,

        /// external
        external,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const FileHandle = struct {
        /// path
        path: []const u8,

        /// size
        size: u32 = 0,

        /// fd
        fd: u32 = 0,

        pub fn decode(reader: anytype) anyerror!FileHandle {
            var this = std.mem.zeroes(FileHandle);

            this.path = try reader.readValue([]const u8);
            this.size = try reader.readValue(u32);
            this.fd = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.path), this.path);
            try writer.writeInt(this.size);
            try writer.writeInt(this.fd);
        }
    };

    pub const Transform = struct {
        /// handle
        handle: ?FileHandle = null,

        /// path
        path: ?[]const u8 = null,

        /// contents
        contents: []const u8,

        /// loader
        loader: ?Loader = null,

        /// options
        options: ?TransformOptions = null,

        pub fn decode(reader: anytype) anyerror!Transform {
            var this = std.mem.zeroes(Transform);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.handle = try reader.readValue(FileHandle);
                    },
                    2 => {
                        this.path = try reader.readValue([]const u8);
                    },
                    3 => {
                        this.contents = try reader.readArray(u8);
                    },
                    4 => {
                        this.loader = try reader.readValue(Loader);
                    },
                    5 => {
                        this.options = try reader.readValue(TransformOptions);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.handle) |handle| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(handle), handle);
            }
            if (this.path) |path| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(path), path);
            }
            if (this.contents) |contents| {
                try writer.writeFieldID(3);
                try writer.writeArray(u8, contents);
            }
            if (this.loader) |loader| {
                try writer.writeFieldID(4);
                try writer.writeEnum(loader);
            }
            if (this.options) |options| {
                try writer.writeFieldID(5);
                try writer.writeValue(@TypeOf(options), options);
            }
            try writer.endMessage();
        }
    };

    pub const Scan = struct {
        /// path
        path: ?[]const u8 = null,

        /// contents
        contents: []const u8,

        /// loader
        loader: ?Loader = null,

        pub fn decode(reader: anytype) anyerror!Scan {
            var this = std.mem.zeroes(Scan);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.path = try reader.readValue([]const u8);
                    },
                    2 => {
                        this.contents = try reader.readArray(u8);
                    },
                    3 => {
                        this.loader = try reader.readValue(Loader);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.path) |path| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(path), path);
            }
            if (this.contents) |contents| {
                try writer.writeFieldID(2);
                try writer.writeArray(u8, contents);
            }
            if (this.loader) |loader| {
                try writer.writeFieldID(3);
                try writer.writeEnum(loader);
            }
            try writer.endMessage();
        }
    };

    pub const ScanResult = struct {
        /// exports
        exports: []const []const u8,

        /// imports
        imports: []const ScannedImport,

        /// errors
        errors: []const Message,

        pub fn decode(reader: anytype) anyerror!ScanResult {
            var this = std.mem.zeroes(ScanResult);

            this.exports = try reader.readArray([]const u8);
            this.imports = try reader.readArray(ScannedImport);
            this.errors = try reader.readArray(Message);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray([]const u8, this.exports);
            try writer.writeArray(ScannedImport, this.imports);
            try writer.writeArray(Message, this.errors);
        }
    };

    pub const ScannedImport = struct {
        /// path
        path: []const u8,

        /// kind
        kind: ImportKind,

        pub fn decode(reader: anytype) anyerror!ScannedImport {
            var this = std.mem.zeroes(ScannedImport);

            this.path = try reader.readValue([]const u8);
            this.kind = try reader.readValue(ImportKind);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.path), this.path);
            try writer.writeEnum(this.kind);
        }
    };

    pub const ImportKind = enum(u8) {
        _none,
        /// entry_point
        entry_point,

        /// stmt
        stmt,

        /// require
        require,

        /// dynamic
        dynamic,

        /// require_resolve
        require_resolve,

        /// at
        at,

        /// url
        url,

        /// internal
        internal,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const TransformResponseStatus = enum(u32) {
        _none,
        /// success
        success,

        /// fail
        fail,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const OutputFile = struct {
        /// data
        data: []const u8,

        /// path
        path: []const u8,

        pub fn decode(reader: anytype) anyerror!OutputFile {
            var this = std.mem.zeroes(OutputFile);

            this.data = try reader.readArray(u8);
            this.path = try reader.readValue([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray(u8, this.data);
            try writer.writeValue(@TypeOf(this.path), this.path);
        }
    };

    pub const TransformResponse = struct {
        /// status
        status: TransformResponseStatus,

        /// files
        files: []const OutputFile,

        /// errors
        errors: []const Message,

        pub fn decode(reader: anytype) anyerror!TransformResponse {
            var this = std.mem.zeroes(TransformResponse);

            this.status = try reader.readValue(TransformResponseStatus);
            this.files = try reader.readArray(OutputFile);
            this.errors = try reader.readArray(Message);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeEnum(this.status);
            try writer.writeArray(OutputFile, this.files);
            try writer.writeArray(Message, this.errors);
        }
    };

    pub const MessageLevel = enum(u32) {
        _none,
        /// err
        err,

        /// warn
        warn,

        /// note
        note,

        /// info
        info,

        /// debug
        debug,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const Location = struct {
        /// file
        file: []const u8,

        /// namespace
        namespace: []const u8,

        /// line
        line: i32 = 0,

        /// column
        column: i32 = 0,

        /// line_text
        line_text: []const u8,

        /// suggestion
        suggestion: []const u8,

        /// offset
        offset: u32 = 0,

        pub fn decode(reader: anytype) anyerror!Location {
            var this = std.mem.zeroes(Location);

            this.file = try reader.readValue([]const u8);
            this.namespace = try reader.readValue([]const u8);
            this.line = try reader.readValue(i32);
            this.column = try reader.readValue(i32);
            this.line_text = try reader.readValue([]const u8);
            this.suggestion = try reader.readValue([]const u8);
            this.offset = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.file), this.file);
            try writer.writeValue(@TypeOf(this.namespace), this.namespace);
            try writer.writeInt(this.line);
            try writer.writeInt(this.column);
            try writer.writeValue(@TypeOf(this.line_text), this.line_text);
            try writer.writeValue(@TypeOf(this.suggestion), this.suggestion);
            try writer.writeInt(this.offset);
        }
    };

    pub const MessageData = struct {
        /// text
        text: ?[]const u8 = null,

        /// location
        location: ?Location = null,

        pub fn decode(reader: anytype) anyerror!MessageData {
            var this = std.mem.zeroes(MessageData);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.text = try reader.readValue([]const u8);
                    },
                    2 => {
                        this.location = try reader.readValue(Location);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.text) |text| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(text), text);
            }
            if (this.location) |location| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(location), location);
            }
            try writer.endMessage();
        }
    };

    pub const MessageMeta = struct {
        /// resolve
        resolve: ?[]const u8 = null,

        /// build
        build: ?bool = null,

        pub fn decode(reader: anytype) anyerror!MessageMeta {
            var this = std.mem.zeroes(MessageMeta);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.resolve = try reader.readValue([]const u8);
                    },
                    2 => {
                        this.build = try reader.readValue(bool);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.resolve) |resolve| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(resolve), resolve);
            }
            if (this.build) |build| {
                try writer.writeFieldID(2);
                try writer.writeInt(@as(u8, @intFromBool(build)));
            }
            try writer.endMessage();
        }
    };

    pub const Message = struct {
        /// level
        level: MessageLevel,

        /// data
        data: MessageData,

        /// notes
        notes: []const MessageData,

        /// on
        on: MessageMeta,

        pub fn decode(reader: anytype) anyerror!Message {
            var this = std.mem.zeroes(Message);

            this.level = try reader.readValue(MessageLevel);
            this.data = try reader.readValue(MessageData);
            this.notes = try reader.readArray(MessageData);
            this.on = try reader.readValue(MessageMeta);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeEnum(this.level);
            try writer.writeValue(@TypeOf(this.data), this.data);
            try writer.writeArray(MessageData, this.notes);
            try writer.writeValue(@TypeOf(this.on), this.on);
        }
    };

    pub const Log = struct {
        /// warnings
        warnings: u32 = 0,

        /// errors
        errors: u32 = 0,

        /// msgs
        msgs: []const Message,

        pub fn decode(reader: anytype) anyerror!Log {
            var this = std.mem.zeroes(Log);

            this.warnings = try reader.readValue(u32);
            this.errors = try reader.readValue(u32);
            this.msgs = try reader.readArray(Message);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.warnings);
            try writer.writeInt(this.errors);
            try writer.writeArray(Message, this.msgs);
        }
    };

    pub const Reloader = enum(u8) {
        _none,
        /// disable
        disable,

        /// live
        live,

        /// fast_refresh
        fast_refresh,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const WebsocketMessageKind = enum(u8) {
        _none,
        /// welcome
        welcome,

        /// file_change_notification
        file_change_notification,

        /// build_success
        build_success,

        /// build_fail
        build_fail,

        /// manifest_success
        manifest_success,

        /// manifest_fail
        manifest_fail,

        /// resolve_file
        resolve_file,

        /// file_change_notification_with_hint
        file_change_notification_with_hint,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const WebsocketCommandKind = enum(u8) {
        _none,
        /// build
        build,

        /// manifest
        manifest,

        /// build_with_file_path
        build_with_file_path,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const WebsocketMessage = struct {
        /// timestamp
        timestamp: u32 = 0,

        /// kind
        kind: WebsocketMessageKind,

        pub fn decode(reader: anytype) anyerror!WebsocketMessage {
            var this = std.mem.zeroes(WebsocketMessage);

            this.timestamp = try reader.readValue(u32);
            this.kind = try reader.readValue(WebsocketMessageKind);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.timestamp);
            try writer.writeEnum(this.kind);
        }
    };

    pub const WebsocketMessageWelcome = struct {
        /// epoch
        epoch: u32 = 0,

        /// javascriptReloader
        javascript_reloader: Reloader,

        /// cwd
        cwd: []const u8,

        /// assetPrefix
        asset_prefix: []const u8,

        pub fn decode(reader: anytype) anyerror!WebsocketMessageWelcome {
            var this = std.mem.zeroes(WebsocketMessageWelcome);

            this.epoch = try reader.readValue(u32);
            this.javascript_reloader = try reader.readValue(Reloader);
            this.cwd = try reader.readValue([]const u8);
            this.asset_prefix = try reader.readValue([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.epoch);
            try writer.writeEnum(this.javascript_reloader);
            try writer.writeValue(@TypeOf(this.cwd), this.cwd);
            try writer.writeValue(@TypeOf(this.asset_prefix), this.asset_prefix);
        }
    };

    pub const WebsocketMessageFileChangeNotification = struct {
        /// id
        id: u32 = 0,

        /// loader
        loader: Loader,

        pub fn decode(reader: anytype) anyerror!WebsocketMessageFileChangeNotification {
            var this = std.mem.zeroes(WebsocketMessageFileChangeNotification);

            this.id = try reader.readValue(u32);
            this.loader = try reader.readValue(Loader);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.id);
            try writer.writeEnum(this.loader);
        }
    };

    pub const WebsocketCommand = struct {
        /// kind
        kind: WebsocketCommandKind,

        /// timestamp
        timestamp: u32 = 0,

        pub fn decode(reader: anytype) anyerror!WebsocketCommand {
            var this = std.mem.zeroes(WebsocketCommand);

            this.kind = try reader.readValue(WebsocketCommandKind);
            this.timestamp = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeEnum(this.kind);
            try writer.writeInt(this.timestamp);
        }
    };

    pub const WebsocketCommandBuild = packed struct {
        /// id
        id: u32 = 0,

        pub fn decode(reader: anytype) anyerror!WebsocketCommandBuild {
            var this = std.mem.zeroes(WebsocketCommandBuild);

            this.id = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.id);
        }
    };

    pub const WebsocketCommandManifest = packed struct {
        /// id
        id: u32 = 0,

        pub fn decode(reader: anytype) anyerror!WebsocketCommandManifest {
            var this = std.mem.zeroes(WebsocketCommandManifest);

            this.id = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.id);
        }
    };

    pub const WebsocketMessageBuildSuccess = struct {
        /// id
        id: u32 = 0,

        /// from_timestamp
        from_timestamp: u32 = 0,

        /// loader
        loader: Loader,

        /// module_path
        module_path: []const u8,

        /// blob_length
        blob_length: u32 = 0,

        pub fn decode(reader: anytype) anyerror!WebsocketMessageBuildSuccess {
            var this = std.mem.zeroes(WebsocketMessageBuildSuccess);

            this.id = try reader.readValue(u32);
            this.from_timestamp = try reader.readValue(u32);
            this.loader = try reader.readValue(Loader);
            this.module_path = try reader.readValue([]const u8);
            this.blob_length = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.id);
            try writer.writeInt(this.from_timestamp);
            try writer.writeEnum(this.loader);
            try writer.writeValue(@TypeOf(this.module_path), this.module_path);
            try writer.writeInt(this.blob_length);
        }
    };

    pub const WebsocketMessageBuildFailure = struct {
        /// id
        id: u32 = 0,

        /// from_timestamp
        from_timestamp: u32 = 0,

        /// loader
        loader: Loader,

        /// module_path
        module_path: []const u8,

        /// log
        log: Log,

        pub fn decode(reader: anytype) anyerror!WebsocketMessageBuildFailure {
            var this = std.mem.zeroes(WebsocketMessageBuildFailure);

            this.id = try reader.readValue(u32);
            this.from_timestamp = try reader.readValue(u32);
            this.loader = try reader.readValue(Loader);
            this.module_path = try reader.readValue([]const u8);
            this.log = try reader.readValue(Log);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.id);
            try writer.writeInt(this.from_timestamp);
            try writer.writeEnum(this.loader);
            try writer.writeValue(@TypeOf(this.module_path), this.module_path);
            try writer.writeValue(@TypeOf(this.log), this.log);
        }
    };

    pub const WebsocketCommandBuildWithFilePath = struct {
        /// id
        id: u32 = 0,

        /// file_path
        file_path: []const u8,

        pub fn decode(reader: anytype) anyerror!WebsocketCommandBuildWithFilePath {
            var this = std.mem.zeroes(WebsocketCommandBuildWithFilePath);

            this.id = try reader.readValue(u32);
            this.file_path = try reader.readValue([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.id);
            try writer.writeValue(@TypeOf(this.file_path), this.file_path);
        }
    };

    pub const WebsocketMessageResolveId = packed struct {
        /// id
        id: u32 = 0,

        pub fn decode(reader: anytype) anyerror!WebsocketMessageResolveId {
            var this = std.mem.zeroes(WebsocketMessageResolveId);

            this.id = try reader.readValue(u32);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.id);
        }
    };

    pub const NpmRegistry = struct {
        /// url
        url: []const u8,

        /// username
        username: []const u8,

        /// password
        password: []const u8,

        /// token
        token: []const u8,

        pub fn dupe(this: NpmRegistry, allocator: std.mem.Allocator) NpmRegistry {
            const buf = allocator.alloc(u8, this.url.len + this.username.len + this.password.len + this.token.len) catch bun.outOfMemory();

            var out: NpmRegistry = .{
                .url = "",
                .username = "",
                .password = "",
                .token = "",
            };

            var i: usize = 0;
            inline for (std.meta.fields(NpmRegistry)) |field| {
                const field_value = @field(this, field.name);
                @memcpy(buf[i .. i + field_value.len], field_value);
                @field(&out, field.name) = buf[i .. i + field_value.len];
                i += field_value.len;
            }

            return out;
        }

        pub fn decode(reader: anytype) anyerror!NpmRegistry {
            var this = std.mem.zeroes(NpmRegistry);

            this.url = try reader.readValue([]const u8);
            this.username = try reader.readValue([]const u8);
            this.password = try reader.readValue([]const u8);
            this.token = try reader.readValue([]const u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.url), this.url);
            try writer.writeValue(@TypeOf(this.username), this.username);
            try writer.writeValue(@TypeOf(this.password), this.password);
            try writer.writeValue(@TypeOf(this.token), this.token);
        }

        pub const Parser = struct {
            log: *bun.logger.Log,
            source: *const bun.logger.Source,
            allocator: std.mem.Allocator,

            fn addError(this: *Parser, loc: bun.logger.Loc, comptime text: []const u8) !void {
                this.log.addError(this.source, loc, text) catch unreachable;
                return error.ParserError;
            }

            fn expectString(this: *Parser, expr: js_ast.Expr) !void {
                switch (expr.data) {
                    .e_string, .e_utf8_string => {},
                    else => {
                        this.log.addErrorFmt(this.source, expr.loc, this.allocator, "expected string but received {}", .{
                            @as(js_ast.Expr.Tag, expr.data),
                        }) catch unreachable;
                        return error.ParserError;
                    },
                }
            }

            pub fn parseRegistryURLString(this: *Parser, str: *js_ast.E.String) !Api.NpmRegistry {
                return try this.parseRegistryURLStringImpl(str.data);
            }

            pub fn parseRegistryURLStringImpl(this: *Parser, str: []const u8) !Api.NpmRegistry {
                const url = bun.URL.parse(str);
                var registry = std.mem.zeroes(Api.NpmRegistry);

                // Token
                if (url.username.len == 0 and url.password.len > 0) {
                    registry.token = url.password;
                    registry.url = try std.fmt.allocPrint(this.allocator, "{s}://{}/{s}/", .{ url.displayProtocol(), url.displayHost(), std.mem.trim(u8, url.pathname, "/") });
                } else if (url.username.len > 0 and url.password.len > 0) {
                    registry.username = url.username;
                    registry.password = url.password;

                    registry.url = try std.fmt.allocPrint(this.allocator, "{s}://{}/{s}/", .{ url.displayProtocol(), url.displayHost(), std.mem.trim(u8, url.pathname, "/") });
                } else {
                    // Do not include a trailing slash. There might be parameters at the end.
                    registry.url = url.href;
                }

                return registry;
            }

            fn parseRegistryObject(this: *Parser, obj: *js_ast.E.Object) !Api.NpmRegistry {
                var registry = std.mem.zeroes(Api.NpmRegistry);

                if (obj.get("url")) |url| {
                    try this.expectString(url);
                    const href = url.asString(this.allocator).?;
                    // Do not include a trailing slash. There might be parameters at the end.
                    registry.url = href;
                }

                if (obj.get("username")) |username| {
                    try this.expectString(username);
                    registry.username = username.asString(this.allocator).?;
                }

                if (obj.get("password")) |password| {
                    try this.expectString(password);
                    registry.password = password.asString(this.allocator).?;
                }

                if (obj.get("token")) |token| {
                    try this.expectString(token);
                    registry.token = token.asString(this.allocator).?;
                }

                return registry;
            }

            pub fn parseRegistry(this: *Parser, expr: js_ast.Expr) !Api.NpmRegistry {
                switch (expr.data) {
                    .e_string => |str| {
                        return this.parseRegistryURLString(str);
                    },
                    .e_object => |obj| {
                        return this.parseRegistryObject(obj);
                    },
                    else => {
                        try this.addError(expr.loc, "Expected registry to be a URL string or an object");
                        return std.mem.zeroes(Api.NpmRegistry);
                    },
                }
            }
        };
    };

    pub const NpmRegistryMap = struct {
        scopes: bun.StringArrayHashMapUnmanaged(NpmRegistry) = .{},

        pub fn decode(reader: anytype) anyerror!NpmRegistryMap {
            var this = std.mem.zeroes(NpmRegistryMap);

            this.scopes = try reader.readArray([]const u8);
            this.registries = try reader.readArray(NpmRegistry);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray([]const u8, this.scopes.keys());
            try writer.writeArray(NpmRegistry, this.scopes.values());
        }
    };

    pub const BunInstall = struct {
        /// default_registry
        default_registry: ?NpmRegistry = null,

        /// scoped
        scoped: ?NpmRegistryMap = null,

        /// lockfile_path
        lockfile_path: ?[]const u8 = null,

        /// save_lockfile_path
        save_lockfile_path: ?[]const u8 = null,

        /// cache_directory
        cache_directory: ?[]const u8 = null,

        /// dry_run
        dry_run: ?bool = null,

        /// force
        force: ?bool = null,

        /// save_dev
        save_dev: ?bool = null,

        /// save_optional
        save_optional: ?bool = null,

        /// save_peer
        save_peer: ?bool = null,

        /// save_lockfile
        save_lockfile: ?bool = null,

        /// production
        production: ?bool = null,

        /// save_yarn_lockfile
        save_yarn_lockfile: ?bool = null,

        /// native_bin_links
        native_bin_links: []const []const u8,

        /// disable_cache
        disable_cache: ?bool = null,

        /// disable_manifest_cache
        disable_manifest_cache: ?bool = null,

        /// global_dir
        global_dir: ?[]const u8 = null,

        /// global_bin_dir
        global_bin_dir: ?[]const u8 = null,

        /// frozen_lockfile
        frozen_lockfile: ?bool = null,

        /// exact
        exact: ?bool = null,

        /// concurrent_scripts
        concurrent_scripts: ?u32 = null,

        pub fn decode(reader: anytype) anyerror!BunInstall {
            var this = std.mem.zeroes(BunInstall);

            while (true) {
                switch (try reader.readByte()) {
                    0 => {
                        return this;
                    },

                    1 => {
                        this.default_registry = try reader.readValue(NpmRegistry);
                    },
                    2 => {
                        this.scoped = try reader.readValue(NpmRegistryMap);
                    },
                    3 => {
                        this.lockfile_path = try reader.readValue([]const u8);
                    },
                    4 => {
                        this.save_lockfile_path = try reader.readValue([]const u8);
                    },
                    5 => {
                        this.cache_directory = try reader.readValue([]const u8);
                    },
                    6 => {
                        this.dry_run = try reader.readValue(bool);
                    },
                    7 => {
                        this.force = try reader.readValue(bool);
                    },
                    8 => {
                        this.save_dev = try reader.readValue(bool);
                    },
                    9 => {
                        this.save_optional = try reader.readValue(bool);
                    },
                    10 => {
                        this.save_peer = try reader.readValue(bool);
                    },
                    11 => {
                        this.save_lockfile = try reader.readValue(bool);
                    },
                    12 => {
                        this.production = try reader.readValue(bool);
                    },
                    13 => {
                        this.save_yarn_lockfile = try reader.readValue(bool);
                    },
                    14 => {
                        this.native_bin_links = try reader.readArray([]const u8);
                    },
                    15 => {
                        this.disable_cache = try reader.readValue(bool);
                    },
                    16 => {
                        this.disable_manifest_cache = try reader.readValue(bool);
                    },
                    17 => {
                        this.global_dir = try reader.readValue([]const u8);
                    },
                    18 => {
                        this.global_bin_dir = try reader.readValue([]const u8);
                    },
                    19 => {
                        this.frozen_lockfile = try reader.readValue(bool);
                    },
                    20 => {
                        this.exact = try reader.readValue(bool);
                    },
                    21 => {
                        this.concurrent_scripts = try reader.readValue(u32);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
            unreachable;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            if (this.default_registry) |default_registry| {
                try writer.writeFieldID(1);
                try writer.writeValue(@TypeOf(default_registry), default_registry);
            }
            if (this.scoped) |scoped| {
                try writer.writeFieldID(2);
                try writer.writeValue(@TypeOf(scoped), scoped);
            }
            if (this.lockfile_path) |lockfile_path| {
                try writer.writeFieldID(3);
                try writer.writeValue(@TypeOf(lockfile_path), lockfile_path);
            }
            if (this.save_lockfile_path) |save_lockfile_path| {
                try writer.writeFieldID(4);
                try writer.writeValue(@TypeOf(save_lockfile_path), save_lockfile_path);
            }
            if (this.cache_directory) |cache_directory| {
                try writer.writeFieldID(5);
                try writer.writeValue(@TypeOf(cache_directory), cache_directory);
            }
            if (this.dry_run) |dry_run| {
                try writer.writeFieldID(6);
                try writer.writeInt(@as(u8, @intFromBool(dry_run)));
            }
            if (this.force) |force| {
                try writer.writeFieldID(7);
                try writer.writeInt(@as(u8, @intFromBool(force)));
            }
            if (this.save_dev) |save_dev| {
                try writer.writeFieldID(8);
                try writer.writeInt(@as(u8, @intFromBool(save_dev)));
            }
            if (this.save_optional) |save_optional| {
                try writer.writeFieldID(9);
                try writer.writeInt(@as(u8, @intFromBool(save_optional)));
            }
            if (this.save_peer) |save_peer| {
                try writer.writeFieldID(10);
                try writer.writeInt(@as(u8, @intFromBool(save_peer)));
            }
            if (this.save_lockfile) |save_lockfile| {
                try writer.writeFieldID(11);
                try writer.writeInt(@as(u8, @intFromBool(save_lockfile)));
            }
            if (this.production) |production| {
                try writer.writeFieldID(12);
                try writer.writeInt(@as(u8, @intFromBool(production)));
            }
            if (this.save_yarn_lockfile) |save_yarn_lockfile| {
                try writer.writeFieldID(13);
                try writer.writeInt(@as(u8, @intFromBool(save_yarn_lockfile)));
            }
            if (this.native_bin_links) |native_bin_links| {
                try writer.writeFieldID(14);
                try writer.writeArray([]const u8, native_bin_links);
            }
            if (this.disable_cache) |disable_cache| {
                try writer.writeFieldID(15);
                try writer.writeInt(@as(u8, @intFromBool(disable_cache)));
            }
            if (this.disable_manifest_cache) |disable_manifest_cache| {
                try writer.writeFieldID(16);
                try writer.writeInt(@as(u8, @intFromBool(disable_manifest_cache)));
            }
            if (this.global_dir) |global_dir| {
                try writer.writeFieldID(17);
                try writer.writeValue(@TypeOf(global_dir), global_dir);
            }
            if (this.global_bin_dir) |global_bin_dir| {
                try writer.writeFieldID(18);
                try writer.writeValue(@TypeOf(global_bin_dir), global_bin_dir);
            }
            if (this.frozen_lockfile) |frozen_lockfile| {
                try writer.writeFieldID(19);
                try writer.writeInt(@as(u8, @intFromBool(frozen_lockfile)));
            }
            if (this.exact) |exact| {
                try writer.writeFieldID(20);
                try writer.writeInt(@as(u8, @intFromBool(exact)));
            }
            if (this.concurrent_scripts) |concurrent_scripts| {
                try writer.writeFieldID(21);
                try writer.writeInt(concurrent_scripts);
            }
            try writer.endMessage();
        }
    };

    pub const ClientServerModule = struct {
        /// moduleId
        module_id: u32 = 0,

        /// inputName
        input_name: StringPointer,

        /// assetName
        asset_name: StringPointer,

        /// exportNames
        export_names: StringPointer,

        pub fn decode(reader: anytype) anyerror!ClientServerModule {
            var this = std.mem.zeroes(ClientServerModule);

            this.module_id = try reader.readValue(u32);
            this.input_name = try reader.readValue(StringPointer);
            this.asset_name = try reader.readValue(StringPointer);
            this.export_names = try reader.readValue(StringPointer);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.module_id);
            try writer.writeValue(@TypeOf(this.input_name), this.input_name);
            try writer.writeValue(@TypeOf(this.asset_name), this.asset_name);
            try writer.writeValue(@TypeOf(this.export_names), this.export_names);
        }
    };

    pub const ClientServerModuleManifest = struct {
        /// version
        version: u32 = 0,

        /// clientModules
        client_modules: []const ClientServerModule,

        /// serverModules
        server_modules: []const ClientServerModule,

        /// ssrModules
        ssr_modules: []const ClientServerModule,

        /// exportNames
        export_names: []const StringPointer,

        /// contents
        contents: []const u8,

        pub fn decode(reader: anytype) anyerror!ClientServerModuleManifest {
            var this = std.mem.zeroes(ClientServerModuleManifest);

            this.version = try reader.readValue(u32);
            this.client_modules = try reader.readArray(ClientServerModule);
            this.server_modules = try reader.readArray(ClientServerModule);
            this.ssr_modules = try reader.readArray(ClientServerModule);
            this.export_names = try reader.readArray(StringPointer);
            this.contents = try reader.readArray(u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.version);
            try writer.writeArray(ClientServerModule, this.client_modules);
            try writer.writeArray(ClientServerModule, this.server_modules);
            try writer.writeArray(ClientServerModule, this.ssr_modules);
            try writer.writeArray(StringPointer, this.export_names);
            try writer.writeArray(u8, this.contents);
        }
    };

    pub const GetTestsRequest = struct {
        /// path
        path: []const u8,

        /// contents
        contents: []const u8,

        pub fn decode(reader: anytype) anyerror!GetTestsRequest {
            var this = std.mem.zeroes(GetTestsRequest);

            this.path = try reader.readValue([]const u8);
            this.contents = try reader.readArray(u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeValue(@TypeOf(this.path), this.path);
            try writer.writeArray(u8, this.contents);
        }
    };

    pub const TestKind = enum(u8) {
        _none,
        /// test_fn
        test_fn,

        /// describe_fn
        describe_fn,

        _,

        pub fn jsonStringify(self: @This(), writer: anytype) !void {
            return try writer.write(@tagName(self));
        }
    };

    pub const TestResponseItem = struct {
        /// byteOffset
        byte_offset: i32 = 0,

        /// label
        label: StringPointer,

        /// kind
        kind: TestKind,

        pub fn decode(reader: anytype) anyerror!TestResponseItem {
            var this = std.mem.zeroes(TestResponseItem);

            this.byte_offset = try reader.readValue(i32);
            this.label = try reader.readValue(StringPointer);
            this.kind = try reader.readValue(TestKind);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeInt(this.byte_offset);
            try writer.writeValue(@TypeOf(this.label), this.label);
            try writer.writeEnum(this.kind);
        }
    };

    pub const GetTestsResponse = struct {
        /// tests
        tests: []const TestResponseItem,

        /// contents
        contents: []const u8,

        pub fn decode(reader: anytype) anyerror!GetTestsResponse {
            var this = std.mem.zeroes(GetTestsResponse);

            this.tests = try reader.readArray(TestResponseItem);
            this.contents = try reader.readArray(u8);
            return this;
        }

        pub fn encode(this: *const @This(), writer: anytype) anyerror!void {
            try writer.writeArray(TestResponseItem, this.tests);
            try writer.writeArray(u8, this.contents);
        }
    };
};
