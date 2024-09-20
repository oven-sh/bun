const uws = @import("../deps/uws.zig");
const bun = @import("root").bun;
const Environment = bun.Environment;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const MutableString = bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

const node_cluster_binding = @import("./node/node_cluster_binding.zig");

pub const log = Output.scoped(.IPC, false);

/// Mode of Inter-Process Communication.
pub const Mode = enum {
    /// Uses SerializedScriptValue to send data. Only valid for bun <--> bun communication.
    /// The first packet sent here is a version packet so that the version of the other end is known.
    advanced,
    /// Uses JSON messages, one message per line.
    /// This must match the behavior of node.js, and supports bun <--> node.js/etc communication.
    json,

    const Map = bun.ComptimeStringMap(Mode, .{
        .{ "advanced", .advanced },
        .{ "json", .json },
    });

    pub fn fromString(s: []const u8) ?Mode {
        return Map.get(s);
    }
};

pub const DecodedIPCMessage = union(enum) {
    version: u32,
    data: JSValue,
    internal: JSValue,
};

pub const DecodeIPCMessageResult = struct {
    bytes_consumed: u32,
    message: DecodedIPCMessage,
};

pub const IPCDecodeError = error{
    /// There werent enough bytes, recall this function again when new data is available.
    NotEnoughBytes,
    /// Format could not be recognized. Report an error and close the socket.
    InvalidFormat,
};

pub const IPCSerializationError = error{
    /// Value could not be serialized.
    SerializationFailed,
    /// Out of memory
    OutOfMemory,
};

const advanced = struct {
    pub const header_length = @sizeOf(IPCMessageType) + @sizeOf(u32);
    pub const version: u32 = 1;

    pub const IPCMessageType = enum(u8) {
        Version = 1,
        SerializedMessage = 2,
        SerializedInternalMessage = 3,
        _,
    };

    const VersionPacket = extern struct {
        type: IPCMessageType align(1) = .Version,
        version: u32 align(1) = version,
    };

    pub fn decodeIPCMessage(data: []const u8, global: *JSC.JSGlobalObject) IPCDecodeError!DecodeIPCMessageResult {
        if (data.len < header_length) {
            log("Not enough bytes to decode IPC message header, have {d} bytes", .{data.len});
            return IPCDecodeError.NotEnoughBytes;
        }

        const message_type: IPCMessageType = @enumFromInt(data[0]);
        const message_len: u32 = @as(*align(1) const u32, @ptrCast(data[1 .. @sizeOf(u32) + 1])).*;

        log("Received IPC message type {d} ({s}) len {d}", .{
            @intFromEnum(message_type),
            bun.tagName(IPCMessageType, message_type) orelse "unknown",
            message_len,
        });

        switch (message_type) {
            .Version => {
                return .{
                    .bytes_consumed = header_length,
                    .message = .{ .version = message_len },
                };
            },
            .SerializedMessage => {
                if (data.len < (header_length + message_len)) {
                    log("Not enough bytes to decode IPC message body of len {d}, have {d} bytes", .{ message_len, data.len });
                    return IPCDecodeError.NotEnoughBytes;
                }

                const message = data[header_length .. header_length + message_len];
                const deserialized = JSValue.deserialize(message, global);

                if (deserialized == .zero) {
                    return IPCDecodeError.InvalidFormat;
                }

                return .{
                    .bytes_consumed = header_length + message_len,
                    .message = .{ .data = deserialized },
                };
            },
            .SerializedInternalMessage => {
                if (data.len < (header_length + message_len)) {
                    log("Not enough bytes to decode IPC message body of len {d}, have {d} bytes", .{ message_len, data.len });
                    return IPCDecodeError.NotEnoughBytes;
                }

                const message = data[header_length .. header_length + message_len];
                const deserialized = JSValue.deserialize(message, global);

                if (deserialized == .zero) {
                    return IPCDecodeError.InvalidFormat;
                }

                return .{
                    .bytes_consumed = header_length + message_len,
                    .message = .{ .internal = deserialized },
                };
            },
            _ => {
                return IPCDecodeError.InvalidFormat;
            },
        }
    }

    pub inline fn getVersionPacket() []const u8 {
        return comptime std.mem.asBytes(&VersionPacket{});
    }

    pub fn serialize(_: *IPCData, writer: anytype, global: *JSC.JSGlobalObject, value: JSValue) !usize {
        const serialized = value.serialize(global) orelse
            return IPCSerializationError.SerializationFailed;
        defer serialized.deinit();

        const size: u32 = @intCast(serialized.data.len);

        const payload_length: usize = @sizeOf(IPCMessageType) + @sizeOf(u32) + size;

        try writer.ensureUnusedCapacity(payload_length);

        writer.writeTypeAsBytesAssumeCapacity(IPCMessageType, .SerializedMessage);
        writer.writeTypeAsBytesAssumeCapacity(u32, size);
        writer.writeAssumeCapacity(serialized.data);

        return payload_length;
    }

    pub fn serializeInternal(_: *IPCData, writer: anytype, global: *JSC.JSGlobalObject, value: JSValue) !usize {
        const serialized = value.serialize(global) orelse
            return IPCSerializationError.SerializationFailed;
        defer serialized.deinit();

        const size: u32 = @intCast(serialized.data.len);

        const payload_length: usize = @sizeOf(IPCMessageType) + @sizeOf(u32) + size;

        try writer.ensureUnusedCapacity(payload_length);

        writer.writeTypeAsBytesAssumeCapacity(IPCMessageType, .SerializedInternalMessage);
        writer.writeTypeAsBytesAssumeCapacity(u32, size);
        writer.writeAssumeCapacity(serialized.data);

        return payload_length;
    }
};

const json = struct {
    fn jsonIPCDataStringFreeCB(context: *anyopaque, _: *anyopaque, _: u32) callconv(.C) void {
        @as(*bool, @ptrCast(context)).* = true;
    }

    pub fn getVersionPacket() []const u8 {
        return &.{};
    }

    // In order to not have to do a property lookup json messages sent from Bun will have a single u8 prepended to them
    // to be able to distinguish whether it is a regular json message or an internal one for cluster ipc communication.
    // 1 is regular
    // 2 is internal

    pub fn decodeIPCMessage(
        data: []const u8,
        globalThis: *JSC.JSGlobalObject,
    ) IPCDecodeError!DecodeIPCMessageResult {
        if (bun.strings.indexOfChar(data, '\n')) |idx| {
            var kind = data[0];
            var json_data = data[1..idx];

            switch (kind) {
                1, 2 => {},
                else => {
                    // if the message being recieved is from a node process then it wont have the leading marker byte
                    // assume full message will be json
                    kind = 1;
                    json_data = data[0..idx];
                },
            }

            const is_ascii = bun.strings.isAllASCII(json_data);
            var was_ascii_string_freed = false;

            // Use ExternalString to avoid copying data if possible.
            // This is only possible for ascii data, as that fits into latin1
            // otherwise we have to convert it utf-8 into utf16-le.
            var str = if (is_ascii)
                bun.String.createExternal(json_data, true, &was_ascii_string_freed, jsonIPCDataStringFreeCB)
            else
                bun.String.fromUTF8(json_data);
            defer {
                str.deref();
                if (is_ascii and !was_ascii_string_freed) {
                    @panic("Expected ascii string to be freed by ExternalString, but it wasn't. This is a bug in Bun.");
                }
            }

            const deserialized = str.toJSByParseJSON(globalThis);

            return switch (kind) {
                1 => .{
                    .bytes_consumed = idx + 1,
                    .message = .{ .data = deserialized },
                },
                2 => .{
                    .bytes_consumed = idx + 1,
                    .message = .{ .internal = deserialized },
                },
                else => @panic("invalid ipc json message kind this is a bug in Bun."),
            };
        }
        return IPCDecodeError.NotEnoughBytes;
    }

    pub fn serialize(_: *IPCData, writer: anytype, global: *JSC.JSGlobalObject, value: JSValue) !usize {
        var out: bun.String = undefined;
        value.jsonStringify(global, 0, &out);
        defer out.deref();

        if (out.tag == .Dead) return IPCSerializationError.SerializationFailed;

        // TODO: it would be cool to have a 'toUTF8Into' which can write directly into 'ipc_data.outgoing.list'
        const str = out.toUTF8(bun.default_allocator);
        defer str.deinit();

        const slice = str.slice();

        try writer.ensureUnusedCapacity(1 + slice.len + 1);

        writer.writeAssumeCapacity(&.{1});
        writer.writeAssumeCapacity(slice);
        writer.writeAssumeCapacity("\n");

        return 1 + slice.len + 1;
    }

    pub fn serializeInternal(_: *IPCData, writer: anytype, global: *JSC.JSGlobalObject, value: JSValue) !usize {
        var out: bun.String = undefined;
        value.jsonStringify(global, 0, &out);
        defer out.deref();

        if (out.tag == .Dead) return IPCSerializationError.SerializationFailed;

        // TODO: it would be cool to have a 'toUTF8Into' which can write directly into 'ipc_data.outgoing.list'
        const str = out.toUTF8(bun.default_allocator);
        defer str.deinit();

        const slice = str.slice();

        try writer.ensureUnusedCapacity(1 + slice.len + 1);

        writer.writeAssumeCapacity(&.{2});
        writer.writeAssumeCapacity(slice);
        writer.writeAssumeCapacity("\n");

        return 1 + slice.len + 1;
    }
};

/// Given potentially unfinished buffer `data`, attempt to decode and process a message from it.
pub fn decodeIPCMessage(mode: Mode, data: []const u8, global: *JSC.JSGlobalObject) IPCDecodeError!DecodeIPCMessageResult {
    return switch (mode) {
        inline else => |t| @field(@This(), @tagName(t)).decodeIPCMessage(data, global),
    };
}

/// Returns the initialization packet for the given mode. Can be zero-length.
pub fn getVersionPacket(mode: Mode) []const u8 {
    return switch (mode) {
        inline else => |t| @field(@This(), @tagName(t)).getVersionPacket(),
    };
}

/// Given a writer interface, serialize and write a value.
/// Returns true if the value was written, false if it was not.
pub fn serialize(data: *IPCData, writer: anytype, global: *JSC.JSGlobalObject, value: JSValue) !usize {
    return switch (data.mode) {
        inline else => |t| @field(@This(), @tagName(t)).serialize(data, writer, global, value),
    };
}

/// Given a writer interface, serialize and write a value.
/// Returns true if the value was written, false if it was not.
pub fn serializeInternal(data: *IPCData, writer: anytype, global: *JSC.JSGlobalObject, value: JSValue) !usize {
    return switch (data.mode) {
        inline else => |t| @field(@This(), @tagName(t)).serializeInternal(data, writer, global, value),
    };
}

pub const Socket = uws.NewSocketHandler(false);

/// Used on POSIX
const SocketIPCData = struct {
    socket: Socket,
    mode: Mode,

    incoming: bun.ByteList = .{}, // Maybe we should use StreamBuffer here as well
    outgoing: bun.io.StreamBuffer = .{},
    has_written_version: if (Environment.allow_assert) u1 else u0 = 0,
    internal_msg_queue: node_cluster_binding.InternalMsgHolder = .{},
    disconnected: bool = false,
    is_server: bool = false,
    pub fn writeVersionPacket(this: *SocketIPCData) void {
        if (Environment.allow_assert) {
            bun.assert(this.has_written_version == 0);
        }
        const bytes = getVersionPacket(this.mode);
        if (bytes.len > 0) {
            const n = this.socket.write(bytes, false);
            if (n != bytes.len) {
                this.outgoing.write(bytes[@intCast(n)..]) catch bun.outOfMemory();
            }
        }
        if (Environment.allow_assert) {
            this.has_written_version = 1;
        }
    }

    pub fn serializeAndSend(ipc_data: *SocketIPCData, global: *JSGlobalObject, value: JSValue) bool {
        if (Environment.allow_assert) {
            bun.assert(ipc_data.has_written_version == 1);
        }

        // TODO: probably we should not direct access ipc_data.outgoing.list.items here
        const start_offset = ipc_data.outgoing.list.items.len;

        const payload_length = serialize(ipc_data, &ipc_data.outgoing, global, value) catch return false;

        bun.assert(ipc_data.outgoing.list.items.len == start_offset + payload_length);

        if (start_offset == 0) {
            bun.assert(ipc_data.outgoing.cursor == 0);
            const n = ipc_data.socket.write(ipc_data.outgoing.list.items.ptr[start_offset..payload_length], false);
            if (n == payload_length) {
                ipc_data.outgoing.reset();
            } else if (n > 0) {
                ipc_data.outgoing.cursor = @intCast(n);
            }
        }

        return true;
    }

    pub fn serializeAndSendInternal(ipc_data: *SocketIPCData, global: *JSGlobalObject, value: JSValue) bool {
        if (Environment.allow_assert) {
            bun.assert(ipc_data.has_written_version == 1);
        }

        // TODO: probably we should not direct access ipc_data.outgoing.list.items here
        const start_offset = ipc_data.outgoing.list.items.len;

        const payload_length = serializeInternal(ipc_data, &ipc_data.outgoing, global, value) catch return false;

        bun.assert(ipc_data.outgoing.list.items.len == start_offset + payload_length);

        if (start_offset == 0) {
            bun.assert(ipc_data.outgoing.cursor == 0);
            const n = ipc_data.socket.write(ipc_data.outgoing.list.items.ptr[start_offset..payload_length], false);
            if (n == payload_length) {
                ipc_data.outgoing.reset();
            } else if (n > 0) {
                ipc_data.outgoing.cursor = @intCast(n);
            }
        }

        return true;
    }

    pub fn close(this: *SocketIPCData, nextTick: bool) void {
        log("SocketIPCData#close", .{});
        if (this.disconnected) return;
        this.disconnected = true;
        if (nextTick) {
            JSC.VirtualMachine.get().enqueueTask(JSC.ManagedTask.New(SocketIPCData, closeTask).init(this));
        } else {
            this.closeTask();
        }
    }

    pub fn closeTask(this: *SocketIPCData) void {
        log("SocketIPCData#closeTask", .{});
        if (this.disconnected) {
            this.socket.close(.normal);
        }
    }
};

/// Used on Windows
const NamedPipeIPCData = struct {
    const uv = bun.windows.libuv;

    mode: Mode,

    // we will use writer pipe as Duplex
    writer: bun.io.StreamingWriter(NamedPipeIPCData, onWrite, onError, null, onPipeClose) = .{},

    incoming: bun.ByteList = .{}, // Maybe we should use IPCBuffer here as well
    disconnected: bool = false,
    is_server: bool = false,
    connect_req: uv.uv_connect_t = std.mem.zeroes(uv.uv_connect_t),
    onClose: ?CloseHandler = null,
    has_written_version: if (Environment.allow_assert) u1 else u0 = 0,
    internal_msg_queue: node_cluster_binding.InternalMsgHolder = .{},

    const CloseHandler = struct {
        callback: *const fn (*anyopaque) void,
        context: *anyopaque,
    };

    fn onServerPipeClose(this: *uv.Pipe) callconv(.C) void {
        // safely free the pipes
        bun.default_allocator.destroy(this);
    }

    fn detach(this: *NamedPipeIPCData) void {
        log("NamedPipeIPCData#detach: is_server {}", .{this.is_server});
        const source = this.writer.source.?;
        // unref because we are closing the pipe
        source.pipe.unref();
        this.writer.source = null;

        if (this.is_server) {
            source.pipe.data = source.pipe;
            source.pipe.close(onServerPipeClose);
            this.onPipeClose();
            return;
        }
        // server will be destroyed by the process that created it
        defer bun.default_allocator.destroy(source.pipe);
        this.writer.source = null;
        this.onPipeClose();
    }

    fn onWrite(this: *NamedPipeIPCData, amount: usize, status: bun.io.WriteStatus) void {
        log("onWrite {d} {}", .{ amount, status });

        switch (status) {
            .pending => {},
            .drained => {
                // unref after sending all data
                this.writer.source.?.pipe.unref();
            },
            .end_of_file => {
                this.detach();
            },
        }
    }

    fn onError(this: *NamedPipeIPCData, err: bun.sys.Error) void {
        log("Failed to write outgoing data {}", .{err});
        this.detach();
    }

    fn onPipeClose(this: *NamedPipeIPCData) void {
        log("onPipeClose", .{});
        if (this.onClose) |handler| {
            this.onClose = null;
            handler.callback(handler.context);
            // deinit dont free the instance of IPCData we should call it before the onClose callback actually frees it
            this.deinit();
        }
    }

    pub fn writeVersionPacket(this: *NamedPipeIPCData) void {
        if (Environment.allow_assert) {
            bun.assert(this.has_written_version == 0);
        }
        const bytes = getVersionPacket(this.mode);
        if (bytes.len > 0) {
            if (this.disconnected) {
                // enqueue to be sent after connecting
                this.writer.outgoing.write(bytes) catch bun.outOfMemory();
            } else {
                _ = this.writer.write(bytes);
            }
        }
        if (Environment.allow_assert) {
            this.has_written_version = 1;
        }
    }

    pub fn serializeAndSend(this: *NamedPipeIPCData, global: *JSGlobalObject, value: JSValue) bool {
        if (Environment.allow_assert) {
            bun.assert(this.has_written_version == 1);
        }
        if (this.disconnected) {
            return false;
        }
        // ref because we have pending data
        this.writer.source.?.pipe.ref();
        const start_offset = this.writer.outgoing.list.items.len;

        const payload_length: usize = serialize(this, &this.writer.outgoing, global, value) catch return false;

        bun.assert(this.writer.outgoing.list.items.len == start_offset + payload_length);

        if (start_offset == 0) {
            bun.assert(this.writer.outgoing.cursor == 0);
            _ = this.writer.flush();
        }

        return true;
    }

    pub fn serializeAndSendInternal(this: *NamedPipeIPCData, global: *JSGlobalObject, value: JSValue) bool {
        if (Environment.allow_assert) {
            bun.assert(this.has_written_version == 1);
        }
        if (this.disconnected) {
            return false;
        }
        // ref because we have pending data
        this.writer.source.?.pipe.ref();
        const start_offset = this.writer.outgoing.list.items.len;

        const payload_length: usize = serializeInternal(this, &this.writer.outgoing, global, value) catch return false;

        bun.assert(this.writer.outgoing.list.items.len == start_offset + payload_length);

        if (start_offset == 0) {
            bun.assert(this.writer.outgoing.cursor == 0);
            _ = this.writer.flush();
        }

        return true;
    }

    pub fn close(this: *NamedPipeIPCData, nextTick: bool) void {
        log("NamedPipeIPCData#close", .{});
        if (this.disconnected) return;
        this.disconnected = true;
        if (nextTick) {
            JSC.VirtualMachine.get().enqueueTask(JSC.ManagedTask.New(NamedPipeIPCData, closeTask).init(this));
        } else {
            this.closeTask();
        }
    }

    pub fn closeTask(this: *NamedPipeIPCData) void {
        log("NamedPipeIPCData#closeTask is_server {}", .{this.is_server});
        if (this.disconnected) {
            _ = this.writer.flush();
            this.writer.end();
            if (this.writer.getStream()) |stream| {
                stream.readStop();
            }
            if (!this.writer.hasPendingData()) {
                this.detach();
            }
        }
    }

    pub fn configureServer(this: *NamedPipeIPCData, comptime Context: type, instance: *Context, ipc_pipe: *uv.Pipe) JSC.Maybe(void) {
        log("configureServer", .{});
        ipc_pipe.data = @ptrCast(instance);
        this.onClose = .{
            .callback = @ptrCast(&NewNamedPipeIPCHandler(Context).onClose),
            .context = @ptrCast(instance),
        };
        ipc_pipe.unref();
        this.is_server = true;
        this.writer.setParent(this);
        this.writer.owns_fd = false;
        const startPipeResult = this.writer.startWithPipe(ipc_pipe);
        if (startPipeResult == .err) {
            this.close(false);
            return startPipeResult;
        }

        const stream = this.writer.getStream() orelse {
            this.close(false);
            return JSC.Maybe(void).errno(bun.C.E.PIPE, .pipe);
        };

        const readStartResult = stream.readStart(instance, NewNamedPipeIPCHandler(Context).onReadAlloc, NewNamedPipeIPCHandler(Context).onReadError, NewNamedPipeIPCHandler(Context).onRead);
        if (readStartResult == .err) {
            this.close(false);
            return readStartResult;
        }
        return .{ .result = {} };
    }

    pub fn configureClient(this: *NamedPipeIPCData, comptime Context: type, instance: *Context, pipe_fd: bun.FileDescriptor) !void {
        log("configureClient", .{});
        const ipc_pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory();
        ipc_pipe.init(uv.Loop.get(), true).unwrap() catch |err| {
            bun.default_allocator.destroy(ipc_pipe);
            return err;
        };
        ipc_pipe.open(pipe_fd).unwrap() catch |err| {
            bun.default_allocator.destroy(ipc_pipe);
            return err;
        };
        ipc_pipe.unref();
        this.writer.owns_fd = false;
        this.writer.setParent(this);
        this.writer.startWithPipe(ipc_pipe).unwrap() catch |err| {
            this.close(false);
            return err;
        };
        this.connect_req.data = @ptrCast(instance);
        this.onClose = .{
            .callback = @ptrCast(&NewNamedPipeIPCHandler(Context).onClose),
            .context = @ptrCast(instance),
        };

        const stream = this.writer.getStream() orelse {
            this.close(false);
            return error.FailedToConnectIPC;
        };

        stream.readStart(instance, NewNamedPipeIPCHandler(Context).onReadAlloc, NewNamedPipeIPCHandler(Context).onReadError, NewNamedPipeIPCHandler(Context).onRead).unwrap() catch |err| {
            this.close(false);
            return err;
        };
    }

    fn deinit(this: *NamedPipeIPCData) void {
        log("deinit", .{});
        this.writer.deinit();
        this.incoming.deinitWithAllocator(bun.default_allocator);
    }
};

pub const IPCData = if (Environment.isWindows) NamedPipeIPCData else SocketIPCData;

/// Used on POSIX
fn NewSocketIPCHandler(comptime Context: type) type {
    return struct {
        pub fn onOpen(
            _: *anyopaque,
            _: Socket,
        ) void {
            // it is NOT safe to use the first argument here because it has not been initialized yet.
            // ideally we would call .ipc.writeVersionPacket() here, and we need that to handle the
            // theoretical write failure, but since the .ipc.outgoing buffer isn't available, that
            // data has nowhere to go.
            //
            // therefore, initializers of IPC handlers need to call .ipc.writeVersionPacket() themselves
            // this is covered by an assertion.
        }

        pub fn onClose(
            this: *Context,
            _: Socket,
            _: c_int,
            _: ?*anyopaque,
        ) void {
            // Note: uSockets has already freed the underlying socket, so calling Socket.close() can segfault
            log("NewSocketIPCHandler#onClose\n", .{});
            this.handleIPCClose();
        }

        pub fn onData(
            this: *Context,
            socket: Socket,
            all_data: []const u8,
        ) void {
            var data = all_data;
            const ipc = this.ipc() orelse return;
            log("onData {}", .{std.fmt.fmtSliceHexLower(data)});

            // In the VirtualMachine case, `globalThis` is an optional, in case
            // the vm is freed before the socket closes.
            const globalThis = switch (@typeInfo(@TypeOf(this.globalThis))) {
                .Pointer => this.globalThis,
                .Optional => brk: {
                    if (this.globalThis) |global| {
                        break :brk global;
                    }
                    this.handleIPCClose();
                    socket.close(.failure);
                    return;
                },
                else => @panic("Unexpected globalThis type: " ++ @typeName(@TypeOf(this.globalThis))),
            };

            // Decode the message with just the temporary buffer, and if that
            // fails (not enough bytes) then we allocate to .ipc_buffer
            if (ipc.incoming.len == 0) {
                while (true) {
                    const result = decodeIPCMessage(ipc.mode, data, globalThis) catch |e| switch (e) {
                        error.NotEnoughBytes => {
                            _ = ipc.incoming.write(bun.default_allocator, data) catch bun.outOfMemory();
                            log("hit NotEnoughBytes", .{});
                            return;
                        },
                        error.InvalidFormat => {
                            Output.printErrorln("InvalidFormatError during IPC message handling", .{});
                            this.handleIPCClose();
                            socket.close(.failure);
                            return;
                        },
                    };

                    this.handleIPCMessage(result.message);

                    if (result.bytes_consumed < data.len) {
                        data = data[result.bytes_consumed..];
                    } else {
                        return;
                    }
                }
            }

            _ = ipc.incoming.write(bun.default_allocator, data) catch bun.outOfMemory();

            var slice = ipc.incoming.slice();
            while (true) {
                const result = decodeIPCMessage(ipc.mode, slice, globalThis) catch |e| switch (e) {
                    error.NotEnoughBytes => {
                        // copy the remaining bytes to the start of the buffer
                        bun.copy(u8, ipc.incoming.ptr[0..slice.len], slice);
                        ipc.incoming.len = @truncate(slice.len);
                        log("hit NotEnoughBytes2", .{});
                        return;
                    },
                    error.InvalidFormat => {
                        Output.printErrorln("InvalidFormatError during IPC message handling", .{});
                        this.handleIPCClose();
                        socket.close(.failure);
                        return;
                    },
                };

                this.handleIPCMessage(result.message);

                if (result.bytes_consumed < slice.len) {
                    slice = slice[result.bytes_consumed..];
                } else {
                    // clear the buffer
                    ipc.incoming.len = 0;
                    return;
                }
            }
        }

        pub fn onWritable(
            context: *Context,
            socket: Socket,
        ) void {
            const ipc = context.ipc() orelse return;
            const to_write = ipc.outgoing.slice();
            if (to_write.len == 0) {
                ipc.outgoing.reset();
                return;
            }
            const n = socket.write(to_write, false);
            if (n == to_write.len) {
                ipc.outgoing.reset();
            } else if (n > 0) {
                ipc.outgoing.cursor += @intCast(n);
            }
        }

        pub fn onTimeout(
            _: *Context,
            _: Socket,
        ) void {}

        pub fn onLongTimeout(
            _: *Context,
            _: Socket,
        ) void {}

        pub fn onConnectError(
            _: *anyopaque,
            _: Socket,
            _: c_int,
        ) void {
            // context has not been initialized
        }

        pub fn onEnd(
            _: *Context,
            _: Socket,
        ) void {}
    };
}

/// Used on Windows
fn NewNamedPipeIPCHandler(comptime Context: type) type {
    return struct {
        fn onReadAlloc(this: *Context, suggested_size: usize) []u8 {
            const ipc = this.ipc() orelse return "";
            var available = ipc.incoming.available();
            if (available.len < suggested_size) {
                ipc.incoming.ensureUnusedCapacity(bun.default_allocator, suggested_size) catch bun.outOfMemory();
                available = ipc.incoming.available();
            }
            log("NewNamedPipeIPCHandler#onReadAlloc {d}", .{suggested_size});
            return available.ptr[0..suggested_size];
        }

        fn onReadError(this: *Context, err: bun.C.E) void {
            log("NewNamedPipeIPCHandler#onReadError {}", .{err});
            if (this.ipc()) |ipc_data| {
                ipc_data.close(true);
            }
        }

        fn onRead(this: *Context, buffer: []const u8) void {
            const ipc = this.ipc() orelse return;

            log("NewNamedPipeIPCHandler#onRead {d}", .{buffer.len});
            ipc.incoming.len += @as(u32, @truncate(buffer.len));
            var slice = ipc.incoming.slice();

            bun.assert(ipc.incoming.len <= ipc.incoming.cap);
            bun.assert(bun.isSliceInBuffer(buffer, ipc.incoming.allocatedSlice()));

            const globalThis = switch (@typeInfo(@TypeOf(this.globalThis))) {
                .Pointer => this.globalThis,
                .Optional => brk: {
                    if (this.globalThis) |global| {
                        break :brk global;
                    }
                    ipc.close(true);
                    return;
                },
                else => @panic("Unexpected globalThis type: " ++ @typeName(@TypeOf(this.globalThis))),
            };
            while (true) {
                const result = decodeIPCMessage(ipc.mode, slice, globalThis) catch |e| switch (e) {
                    error.NotEnoughBytes => {
                        // copy the remaining bytes to the start of the buffer
                        bun.copy(u8, ipc.incoming.ptr[0..slice.len], slice);
                        ipc.incoming.len = @truncate(slice.len);
                        log("hit NotEnoughBytes2", .{});
                        return;
                    },
                    error.InvalidFormat => {
                        Output.printErrorln("InvalidFormatError during IPC message handling", .{});
                        ipc.close(false);
                        return;
                    },
                };

                this.handleIPCMessage(result.message);

                if (result.bytes_consumed < slice.len) {
                    slice = slice[result.bytes_consumed..];
                } else {
                    // clear the buffer
                    ipc.incoming.len = 0;
                    return;
                }
            }
        }

        pub fn onClose(this: *Context) void {
            log("NewNamedPipeIPCHandler#onClose\n", .{});
            this.handleIPCClose();
        }
    };
}

/// This type is shared between VirtualMachine and Subprocess for their respective IPC handlers
///
/// `Context` must be a struct that implements this interface:
/// struct {
///     globalThis: ?*JSGlobalObject,
///
///     fn ipc(*Context) ?*IPCData,
///     fn handleIPCMessage(*Context, DecodedIPCMessage) void
///     fn handleIPCClose(*Context) void
/// }
pub const NewIPCHandler = if (Environment.isWindows) NewNamedPipeIPCHandler else NewSocketIPCHandler;
