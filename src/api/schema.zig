const std = @import("std");

pub const Api = struct {
    pub const Loader = enum(u8) {
        _none,
        /// jsx
        jsx,

        /// js
        js,

        /// ts
        ts,

        /// tsx
        tsx,

        /// css
        css,

        /// file
        file,

        /// json
        json,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const JsxRuntime = enum(u8) {
        _none,
        /// automatic
        automatic,

        /// classic
        classic,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const Jsx = struct {
        /// factory
        factory: []u8,

        /// runtime
        runtime: JsxRuntime,

        /// fragment
        fragment: []u8,

        /// production
        production: bool = false,

        /// import_source
        import_source: []u8,

        /// react_fast_refresh
        react_fast_refresh: bool = false,

        /// loader_keys
        loader_keys: [][]u8,

        /// loader_values
        loader_values: []Loader,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Jsx {
            var obj = std.mem.zeroes(Jsx);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Jsx, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = try reader.readIntNative(u32);
            if (result.factory.len != length) {
                result.factory = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.factory);
            result.runtime = try reader.readEnum(JsxRuntime, .Little);
            length = try reader.readIntNative(u32);
            if (result.fragment.len != length) {
                result.fragment = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.fragment);
            result.production = (try reader.readByte()) == @as(u8, 1);
            length = try reader.readIntNative(u32);
            if (result.import_source.len != length) {
                result.import_source = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.import_source);
            result.react_fast_refresh = (try reader.readByte()) == @as(u8, 1);
            {
                var array_count = try reader.readIntNative(u32);
                if (array_count != result.loader_keys.len) {
                    result.loader_keys = try allocator.alloc([]u8, array_count);
                }
                length = try reader.readIntNative(u32);
                for (result.loader_keys) |content, j| {
                    if (result.loader_keys[j].len != length and length > 0) {
                        result.loader_keys[j] = try allocator.alloc(u8, length);
                    }
                    _ = try reader.readAll(result.loader_keys[j]);
                }
            }
            length = try reader.readIntNative(u32);
            result.loader_values = try allocator.alloc(Loader, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.loader_values[j] = try reader.readEnum(Loader, .Little);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try writer.writeIntNative(u32, @intCast(u32, result.factory.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.factory));

            try writer.writeIntNative(@TypeOf(@enumToInt(result.runtime)), @enumToInt(result.runtime));

            try writer.writeIntNative(u32, @intCast(u32, result.fragment.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.fragment));

            try writer.writeByte(@boolToInt(result.production));

            try writer.writeIntNative(u32, @intCast(u32, result.import_source.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.import_source));

            try writer.writeByte(@boolToInt(result.react_fast_refresh));

            n = result.loader_keys.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    _ = try writer.writeIntNative(u32, @intCast(u32, result.loader_keys[j].len));
                    try writer.writeAll(std.mem.sliceAsBytes(result.loader_keys[j]));
                }
            }

            n = result.loader_values.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try writer.writeByte(@enumToInt(result.loader_values[j]));
                }
            }
            return;
        }
    };

    pub const TransformOptions = struct {
        /// jsx
        jsx: Jsx,

        /// ts
        ts: bool = false,

        /// base_path
        base_path: []u8,

        /// define_keys
        define_keys: [][]u8,

        /// define_values
        define_values: [][]u8,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!TransformOptions {
            var obj = std.mem.zeroes(TransformOptions);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *TransformOptions, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            result.jsx = try Jsx.decode(allocator, reader);
            result.ts = (try reader.readByte()) == @as(u8, 1);
            length = try reader.readIntNative(u32);
            if (result.base_path.len != length) {
                result.base_path = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.base_path);
            {
                var array_count = try reader.readIntNative(u32);
                if (array_count != result.define_keys.len) {
                    result.define_keys = try allocator.alloc([]u8, array_count);
                }
                length = try reader.readIntNative(u32);
                for (result.define_keys) |content, j| {
                    if (result.define_keys[j].len != length and length > 0) {
                        result.define_keys[j] = try allocator.alloc(u8, length);
                    }
                    _ = try reader.readAll(result.define_keys[j]);
                }
            }
            {
                var array_count = try reader.readIntNative(u32);
                if (array_count != result.define_values.len) {
                    result.define_values = try allocator.alloc([]u8, array_count);
                }
                length = try reader.readIntNative(u32);
                for (result.define_values) |content, j| {
                    if (result.define_values[j].len != length and length > 0) {
                        result.define_values[j] = try allocator.alloc(u8, length);
                    }
                    _ = try reader.readAll(result.define_values[j]);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try result.jsx.encode(writer);

            try writer.writeByte(@boolToInt(result.ts));

            try writer.writeIntNative(u32, @intCast(u32, result.base_path.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.base_path));

            n = result.define_keys.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    _ = try writer.writeIntNative(u32, @intCast(u32, result.define_keys[j].len));
                    try writer.writeAll(std.mem.sliceAsBytes(result.define_keys[j]));
                }
            }

            n = result.define_values.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    _ = try writer.writeIntNative(u32, @intCast(u32, result.define_values[j].len));
                    try writer.writeAll(std.mem.sliceAsBytes(result.define_values[j]));
                }
            }
            return;
        }
    };

    pub const FileHandle = struct {
        /// path
        path: []u8,

        /// size
        size: u32 = 0,

        /// fd
        fd: u32 = 0,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!FileHandle {
            var obj = std.mem.zeroes(FileHandle);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *FileHandle, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = try reader.readIntNative(u32);
            if (result.path.len != length) {
                result.path = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.path);
            _ = try reader.readAll(std.mem.asBytes(&result.size));
            _ = try reader.readAll(std.mem.asBytes(&result.fd));
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(u32, @intCast(u32, result.path.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.path));

            try writer.writeIntNative(u32, result.size);

            try writer.writeIntNative(u32, result.fd);
            return;
        }
    };

    pub const Transform = struct {
        /// handle
        handle: ?FileHandle = null,

        /// path
        path: ?[]u8 = null,

        /// contents
        contents: []u8,

        /// loader
        loader: ?Loader = null,

        /// options
        options: ?TransformOptions = null,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Transform {
            var obj = std.mem.zeroes(Transform);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Transform, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            while (true) {
                const field_type: u8 = try reader.readByte();
                switch (field_type) {
                    0 => {
                        return;
                    },

                    1 => {
                        result.handle = try FileHandle.decode(allocator, reader);
                    },
                    2 => {
                        length = try reader.readIntNative(u32);
                        if ((result.path orelse &([_]u8{})).len != length) {
                            result.path = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.path.?);
                    },
                    3 => {
                        length = @intCast(usize, try reader.readIntNative(u32));
                        if (result.contents.len != length) {
                            result.contents = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.contents);
                    },
                    4 => {
                        result.loader = try reader.readEnum(Loader, .Little);
                    },
                    5 => {
                        result.options = try TransformOptions.decode(allocator, reader);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            if (result.handle) |handle| {
                try writer.writeByte(1);
                try handle.encode(writer);
            }

            if (result.path) |path| {
                try writer.writeByte(2);
                try writer.writeIntNative(u32, @intCast(u32, path.len));
                try writer.writeAll(std.mem.sliceAsBytes(path));
            }

            if (result.contents) |contents| {
                try writer.writeByte(3);
                try writer.writeIntNative(u32, @intCast(u32, contents.len));
                try writer.writeAll(contents);
            }

            if (result.loader) |loader| {
                try writer.writeByte(4);
                try writer.writeIntNative(@TypeOf(@enumToInt(result.loader orelse unreachable)), @enumToInt(result.loader orelse unreachable));
            }

            if (result.options) |options| {
                try writer.writeByte(5);
                try options.encode(writer);
            }
            try writer.writeByte(0);
            return;
        }
    };

    pub const TransformResponseStatus = enum(u32) {
        _none,
        /// success
        success,

        /// fail
        fail,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const OutputFile = struct {
        /// data
        data: []u8,

        /// path
        path: []u8,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!OutputFile {
            var obj = std.mem.zeroes(OutputFile);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *OutputFile, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = @intCast(usize, try reader.readIntNative(u32));
            if (result.data != length) {
                result.data = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.data);
            length = try reader.readIntNative(u32);
            if (result.path.len != length) {
                result.path = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.path);
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(u32, @intCast(u32, result.data.len));
            try writer.writeAll(result.data);

            try writer.writeIntNative(u32, @intCast(u32, result.path.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.path));
            return;
        }
    };

    pub const TransformResponse = struct {
        /// status
        status: TransformResponseStatus,

        /// files
        files: []OutputFile,

        /// errors
        errors: []Message,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!TransformResponse {
            var obj = std.mem.zeroes(TransformResponse);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *TransformResponse, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            result.status = try reader.readEnum(TransformResponseStatus, .Little);
            length = try reader.readIntNative(u32);
            result.files = try allocator.alloc(OutputFile, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.files[j] = try OutputFile.decode(allocator, reader);
                }
            }
            length = try reader.readIntNative(u32);
            result.errors = try allocator.alloc(Message, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.errors[j] = try Message.decode(allocator, reader);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try writer.writeIntNative(@TypeOf(@enumToInt(result.status)), @enumToInt(result.status));

            n = result.files.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.files[j].encode(writer);
                }
            }

            n = result.errors.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.errors[j].encode(writer);
                }
            }
            return;
        }
    };

    pub const MessageKind = enum(u32) {
        _none,
        /// err
        err,

        /// warn
        warn,

        /// note
        note,

        /// debug
        debug,

        _,

        pub fn jsonStringify(self: *const @This(), opts: anytype, o: anytype) !void {
            return try std.json.stringify(@tagName(self), opts, o);
        }
    };

    pub const Location = struct {
        /// file
        file: []u8,

        /// namespace
        namespace: []u8,

        /// line
        line: i32 = 0,

        /// column
        column: i32 = 0,

        /// line_text
        line_text: []u8,

        /// suggestion
        suggestion: []u8,

        /// offset
        offset: u32 = 0,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Location {
            var obj = std.mem.zeroes(Location);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Location, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            length = try reader.readIntNative(u32);
            if (result.file.len != length) {
                result.file = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.file);
            length = try reader.readIntNative(u32);
            if (result.namespace.len != length) {
                result.namespace = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.namespace);
            _ = try reader.readAll(std.mem.asBytes(&result.line));
            _ = try reader.readAll(std.mem.asBytes(&result.column));
            length = try reader.readIntNative(u32);
            if (result.line_text.len != length) {
                result.line_text = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.line_text);
            length = try reader.readIntNative(u32);
            if (result.suggestion.len != length) {
                result.suggestion = try allocator.alloc(u8, length);
            }
            _ = try reader.readAll(result.suggestion);
            _ = try reader.readAll(std.mem.asBytes(&result.offset));
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            try writer.writeIntNative(u32, @intCast(u32, result.file.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.file));

            try writer.writeIntNative(u32, @intCast(u32, result.namespace.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.namespace));

            try writer.writeIntNative(i32, result.line);

            try writer.writeIntNative(i32, result.column);

            try writer.writeIntNative(u32, @intCast(u32, result.line_text.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.line_text));

            try writer.writeIntNative(u32, @intCast(u32, result.suggestion.len));
            try writer.writeAll(std.mem.sliceAsBytes(result.suggestion));

            try writer.writeIntNative(u32, result.offset);
            return;
        }
    };

    pub const MessageData = struct {
        /// text
        text: ?[]u8 = null,

        /// location
        location: ?Location = null,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!MessageData {
            var obj = std.mem.zeroes(MessageData);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *MessageData, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            while (true) {
                const field_type: u8 = try reader.readByte();
                switch (field_type) {
                    0 => {
                        return;
                    },

                    1 => {
                        length = try reader.readIntNative(u32);
                        if ((result.text orelse &([_]u8{})).len != length) {
                            result.text = try allocator.alloc(u8, length);
                        }
                        _ = try reader.readAll(result.text.?);
                    },
                    2 => {
                        result.location = try Location.decode(allocator, reader);
                    },
                    else => {
                        return error.InvalidMessage;
                    },
                }
            }
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            if (result.text) |text| {
                try writer.writeByte(1);
                try writer.writeIntNative(u32, @intCast(u32, text.len));
                try writer.writeAll(std.mem.sliceAsBytes(text));
            }

            if (result.location) |location| {
                try writer.writeByte(2);
                try location.encode(writer);
            }
            try writer.writeByte(0);
            return;
        }
    };

    pub const Message = struct {
        /// kind
        kind: MessageKind,

        /// data
        data: MessageData,

        /// notes
        notes: []MessageData,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Message {
            var obj = std.mem.zeroes(Message);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Message, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            result.kind = try reader.readEnum(MessageKind, .Little);
            result.data = try MessageData.decode(allocator, reader);
            length = try reader.readIntNative(u32);
            result.notes = try allocator.alloc(MessageData, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.notes[j] = try MessageData.decode(allocator, reader);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try writer.writeIntNative(@TypeOf(@enumToInt(result.kind)), @enumToInt(result.kind));

            try result.data.encode(writer);

            n = result.notes.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.notes[j].encode(writer);
                }
            }
            return;
        }
    };

    pub const Log = struct {
        /// warnings
        warnings: u32 = 0,

        /// errors
        errors: u32 = 0,

        /// msgs
        msgs: []Message,

        pub fn decode(allocator: *std.mem.Allocator, reader: anytype) anyerror!Log {
            var obj = std.mem.zeroes(Log);
            try update(&obj, allocator, reader);
            return obj;
        }
        pub fn update(result: *Log, allocator: *std.mem.Allocator, reader: anytype) anyerror!void {
            var length: usize = 0;
            _ = try reader.readAll(std.mem.asBytes(&result.warnings));
            _ = try reader.readAll(std.mem.asBytes(&result.errors));
            length = try reader.readIntNative(u32);
            result.msgs = try allocator.alloc(Message, length);
            {
                var j: usize = 0;
                while (j < length) : (j += 1) {
                    result.msgs[j] = try Message.decode(allocator, reader);
                }
            }
            return;
        }

        pub fn encode(result: *const @This(), writer: anytype) anyerror!void {
            var n: usize = 0;
            try writer.writeIntNative(u32, result.warnings);

            try writer.writeIntNative(u32, result.errors);

            n = result.msgs.len;
            _ = try writer.writeIntNative(u32, @intCast(u32, n));
            {
                var j: usize = 0;
                while (j < n) : (j += 1) {
                    try result.msgs[j].encode(writer);
                }
            }
            return;
        }
    };
};
