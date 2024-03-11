const uws = @import("../deps/uws.zig");
const bun = @import("root").bun;
const Environment = bun.Environment;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

pub const log = Output.scoped(.IPC, false);

pub const ipcHeaderLength = @sizeOf(u8) + @sizeOf(u32);
pub const ipcVersion = 1;

pub const DecodedIPCMessage = union(enum) {
    version: u32,
    data: JSValue,
};

pub const DecodeIPCMessageResult = struct {
    bytes_consumed: u32,
    message: DecodedIPCMessage,
};

pub const IPCDecodeError = error{ NotEnoughBytes, InvalidFormat };

pub const IPCMessageType = enum(u8) {
    Version = 1,
    SerializedMessage = 2,
    _,
};

/// Given potentially unfinished buffer `data`, attempt to decode and process a message from it.
/// Returns `NotEnoughBytes` if there werent enough bytes
/// Returns `InvalidFormat` if the message was invalid, probably close the socket in this case
/// otherwise returns the number of bytes consumed.
pub fn decodeIPCMessage(
    data: []const u8,
    globalThis: *JSC.JSGlobalObject,
) IPCDecodeError!DecodeIPCMessageResult {
    JSC.markBinding(@src());
    if (data.len < ipcHeaderLength) {
        return IPCDecodeError.NotEnoughBytes;
    }

    const message_type: IPCMessageType = @enumFromInt(data[0]);
    const message_len: u32 = @as(*align(1) const u32, @ptrCast(data[1 .. @sizeOf(u32) + 1])).*;

    log("Received IPC message type {d} ({s}) len {d}", .{
        @intFromEnum(message_type),
        std.enums.tagName(IPCMessageType, message_type) orelse "unknown",
        message_len,
    });

    switch (message_type) {
        .Version => {
            return .{
                .bytes_consumed = ipcHeaderLength,
                .message = .{ .version = message_len },
            };
        },
        .SerializedMessage => {
            if (data.len < (ipcHeaderLength + message_len)) {
                return IPCDecodeError.NotEnoughBytes;
            }

            const message = data[ipcHeaderLength .. ipcHeaderLength + message_len];
            const deserialized = JSValue.deserialize(message, globalThis);

            if (deserialized == .zero) {
                return IPCDecodeError.InvalidFormat;
            }

            return .{
                .bytes_consumed = ipcHeaderLength + message_len,
                .message = .{ .data = deserialized },
            };
        },
        else => {
            return IPCDecodeError.InvalidFormat;
        },
    }
}

pub const Socket = uws.NewSocketHandler(false);

pub const SocketIPCData = struct {
    socket: Socket,
    incoming: bun.ByteList = .{}, // Maybe we should use StreamBuffer here as well
    outgoing: bun.io.StreamBuffer = .{},

    has_written_version: if (Environment.allow_assert) u1 else u0 = 0,

    pub fn writeVersionPacket(this: *SocketIPCData) void {
        if (Environment.allow_assert) {
            std.debug.assert(this.has_written_version == 0);
        }
        const VersionPacket = extern struct {
            type: IPCMessageType align(1) = .Version,
            version: u32 align(1) = ipcVersion,
        };
        const bytes = comptime std.mem.asBytes(&VersionPacket{});
        const n = this.socket.write(bytes, false);
        if (n != bytes.len) {
            this.outgoing.write(bytes) catch bun.outOfMemory();
        }
        if (Environment.allow_assert) {
            this.has_written_version = 1;
        }
    }

    pub fn serializeAndSend(ipc_data: *SocketIPCData, globalThis: *JSGlobalObject, value: JSValue) bool {
        if (Environment.allow_assert) {
            std.debug.assert(ipc_data.has_written_version == 1);
        }

        const serialized = value.serialize(globalThis) orelse return false;
        defer serialized.deinit();

        const size: u32 = @intCast(serialized.data.len);

        const payload_length: usize = @sizeOf(IPCMessageType) + @sizeOf(u32) + size;

        ipc_data.outgoing.ensureUnusedCapacity(payload_length) catch bun.outOfMemory();
        //TODO: probably we should not direct access ipc_data.outgoing.list.items here
        const start_offset = ipc_data.outgoing.list.items.len;

        ipc_data.outgoing.writeTypeAsBytesAssumeCapacity(u8, @intFromEnum(IPCMessageType.SerializedMessage));
        ipc_data.outgoing.writeTypeAsBytesAssumeCapacity(u32, size);
        ipc_data.outgoing.writeAssumeCapacity(serialized.data);

        std.debug.assert(ipc_data.outgoing.list.items.len == start_offset + payload_length);

        if (start_offset == 0) {
            std.debug.assert(ipc_data.outgoing.cursor == 0);

            const n = ipc_data.socket.write(ipc_data.outgoing.list.items.ptr[start_offset..payload_length], false);
            if (n == payload_length) {
                ipc_data.outgoing.reset();
            } else if (n > 0) {
                ipc_data.outgoing.cursor = @intCast(n);
            }
        }

        return true;
    }
};

const NamedPipeIPCData = struct {
    const uv = bun.windows.libuv;
    // we will use writer pipe as Duplex
    writer: bun.io.StreamingWriter(NamedPipeIPCData, onWrite, onError, null, onClientClose) = .{},

    incoming: bun.ByteList = .{}, // Maybe we should use IPCBuffer here as well
    connected: bool = false,
    has_written_version: if (Environment.allow_assert) u1 else u0 = 0,
    connect_req: uv.uv_connect_t = std.mem.zeroes(uv.uv_connect_t),
    server: ?*uv.Pipe = null,
    onClose: ?CloseHandler = null,
    const CloseHandler = struct {
        callback: *const fn (*anyopaque) void,
        context: *anyopaque,
    };

    fn onWrite(_: *NamedPipeIPCData, amount: usize, status: bun.io.WriteStatus) void {
        log("onWrite {d} {}", .{ amount, status });
    }

    fn onError(_: *NamedPipeIPCData, err: bun.sys.Error) void {
        log("Failed to write outgoing data {}", .{err});
    }

    fn onClientClose(this: *NamedPipeIPCData) void {
        log("onClisentClose", .{});
        this.connected = false;
        if (this.server) |server| {
            // we must close the server too
            server.close(onServerClose);
        } else {
            if (this.onClose) |handler| {
                // deinit dont free the instance of IPCData we should call it before the onClose callback actually frees it
                this.deinit();
                handler.callback(handler.context);
            }
        }
    }

    fn onServerClose(pipe: *uv.Pipe) callconv(.C) void {
        log("onServerClose", .{});
        const this = bun.cast(*NamedPipeIPCData, pipe.data);
        this.server = null;
        if (this.connected) {
            // close and deinit client if connected
            this.writer.close();
            return;
        }
        if (this.onClose) |handler| {
            // deinit dont free the instance of IPCData we should call it before the onClose callback actually frees it
            this.deinit();
            handler.callback(handler.context);
        }
    }

    pub fn writeVersionPacket(this: *NamedPipeIPCData) void {
        if (Environment.allow_assert) {
            std.debug.assert(this.has_written_version == 0);
        }
        const VersionPacket = extern struct {
            type: IPCMessageType align(1) = .Version,
            version: u32 align(1) = ipcVersion,
        };

        if (Environment.allow_assert) {
            this.has_written_version = 1;
        }
        const bytes = comptime std.mem.asBytes(&VersionPacket{});
        if (this.connected) {
            _ = this.writer.write(bytes);
        } else {
            // enqueue to be sent after connecting
            this.writer.outgoing.write(bytes) catch bun.outOfMemory();
        }
    }

    pub fn serializeAndSend(this: *NamedPipeIPCData, globalThis: *JSGlobalObject, value: JSValue) bool {
        if (Environment.allow_assert) {
            std.debug.assert(this.has_written_version == 1);
        }

        const serialized = value.serialize(globalThis) orelse return false;
        defer serialized.deinit();

        const size: u32 = @intCast(serialized.data.len);
        log("serializeAndSend {d}", .{size});

        const payload_length: usize = @sizeOf(IPCMessageType) + @sizeOf(u32) + size;

        this.writer.outgoing.ensureUnusedCapacity(payload_length) catch @panic("OOM");
        const start_offset = this.writer.outgoing.list.items.len;

        this.writer.outgoing.writeTypeAsBytesAssumeCapacity(u8, @intFromEnum(IPCMessageType.SerializedMessage));
        this.writer.outgoing.writeTypeAsBytesAssumeCapacity(u32, size);
        this.writer.outgoing.writeAssumeCapacity(serialized.data);

        std.debug.assert(this.writer.outgoing.list.items.len == start_offset + payload_length);

        if (start_offset == 0) {
            std.debug.assert(this.writer.outgoing.cursor == 0);
            if (this.connected) {
                _ = this.writer.flush();
            }
        }

        return true;
    }

    pub fn close(this: *NamedPipeIPCData) void {
        if (this.server) |server| {
            server.close(onServerClose);
        } else {
            this.writer.close();
        }
    }

    pub fn configureServer(this: *NamedPipeIPCData, comptime Context: type, instance: *Context, named_pipe: []const u8) JSC.Maybe(void) {
        log("configureServer", .{});
        const ipc_pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory();
        this.server = ipc_pipe;
        ipc_pipe.data = this;
        if (ipc_pipe.init(uv.Loop.get(), false).asErr()) |err| {
            bun.default_allocator.destroy(ipc_pipe);
            this.server = null;
            return .{ .err = err };
        }
        ipc_pipe.data = @ptrCast(instance);
        this.onClose = .{
            .callback = @ptrCast(&NewNamedPipeIPCHandler(Context).onClose),
            .context = @ptrCast(instance),
        };
        if (ipc_pipe.listenNamedPipe(named_pipe, 0, instance, NewNamedPipeIPCHandler(Context).onNewClientConnect).asErr()) |err| {
            bun.default_allocator.destroy(ipc_pipe);
            this.server = null;
            return .{ .err = err };
        }

        ipc_pipe.setPendingInstancesCount(1);

        ipc_pipe.unref();

        return .{ .result = {} };
    }

    pub fn configureClient(this: *NamedPipeIPCData, comptime Context: type, instance: *Context, named_pipe: []const u8) !void {
        log("configureClient", .{});
        const ipc_pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory();
        ipc_pipe.init(uv.Loop.get(), true).unwrap() catch |err| {
            bun.default_allocator.destroy(ipc_pipe);
            return err;
        };
        this.writer.startWithPipe(ipc_pipe).unwrap() catch |err| {
            bun.default_allocator.destroy(ipc_pipe);
            return err;
        };
        this.connect_req.data = @ptrCast(instance);
        this.onClose = .{
            .callback = @ptrCast(&NewNamedPipeIPCHandler(Context).onClose),
            .context = @ptrCast(instance),
        };
        try ipc_pipe.connect(&this.connect_req, named_pipe, instance, NewNamedPipeIPCHandler(Context).onConnect).unwrap();
    }

    fn deinit(this: *NamedPipeIPCData) void {
        log("deinit", .{});
        this.writer.deinit();
        if (this.server) |server| {
            this.server = null;
            bun.default_allocator.destroy(server);
        }
        this.incoming.deinitWithAllocator(bun.default_allocator);
    }
};

pub const IPCData = if (Environment.isWindows) NamedPipeIPCData else SocketIPCData;

pub fn NewSocketIPCHandler(comptime Context: type) type {
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
            // ?! does uSockets .close call onClose?
            log("onClose\n", .{});
            this.handleIPCClose();
        }

        pub fn onData(
            this: *Context,
            socket: Socket,
            data_: []const u8,
        ) void {
            var data = data_;
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
                    socket.close(0, null);
                    return;
                },
                else => @panic("Unexpected globalThis type: " ++ @typeName(@TypeOf(this.globalThis))),
            };

            // Decode the message with just the temporary buffer, and if that
            // fails (not enough bytes) then we allocate to .ipc_buffer
            if (this.ipc.incoming.len == 0) {
                while (true) {
                    const result = decodeIPCMessage(data, globalThis) catch |e| switch (e) {
                        error.NotEnoughBytes => {
                            _ = this.ipc.incoming.write(bun.default_allocator, data) catch bun.outOfMemory();
                            log("hit NotEnoughBytes", .{});
                            return;
                        },
                        error.InvalidFormat => {
                            Output.printErrorln("InvalidFormatError during IPC message handling", .{});
                            this.handleIPCClose();
                            socket.close(0, null);
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

            _ = this.ipc.incoming.write(bun.default_allocator, data) catch bun.outOfMemory();

            var slice = this.ipc.incoming.slice();
            while (true) {
                const result = decodeIPCMessage(slice, globalThis) catch |e| switch (e) {
                    error.NotEnoughBytes => {
                        // copy the remaining bytes to the start of the buffer
                        bun.copy(u8, this.ipc.incoming.ptr[0..slice.len], slice);
                        this.ipc.incoming.len = @truncate(slice.len);
                        log("hit NotEnoughBytes2", .{});
                        return;
                    },
                    error.InvalidFormat => {
                        Output.printErrorln("InvalidFormatError during IPC message handling", .{});
                        this.handleIPCClose();
                        socket.close(0, null);
                        return;
                    },
                };

                this.handleIPCMessage(result.message);

                if (result.bytes_consumed < slice.len) {
                    slice = slice[result.bytes_consumed..];
                } else {
                    // clear the buffer
                    this.ipc.incoming.len = 0;
                    return;
                }
            }
        }

        pub fn onWritable(
            context: *Context,
            socket: Socket,
        ) void {
            const to_write = context.ipc.outgoing.slice();
            if (to_write.len == 0) {
                context.ipc.outgoing.reset();
                context.ipc.outgoing.reset();
                return;
            }
            const n = socket.write(to_write, false);
            if (n == to_write.len) {
                context.ipc.outgoing.reset();
                context.ipc.outgoing.reset();
            } else if (n > 0) {
                context.ipc.outgoing.cursor += @intCast(n);
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

fn NewNamedPipeIPCHandler(comptime Context: type) type {
    const uv = bun.windows.libuv;
    return struct {
        fn onReadAlloc(this: *Context, suggested_size: usize) []u8 {
            var available = this.ipc.incoming.available();
            if (available.len < suggested_size) {
                this.ipc.incoming.ensureUnusedCapacity(bun.default_allocator, suggested_size) catch bun.outOfMemory();
                available = this.ipc.incoming.available();
            }
            log("onReadAlloc {d}", .{suggested_size});
            return available.ptr[0..suggested_size];
        }

        fn onReadError(this: *Context, err: bun.C.E) void {
            log("onReadError {}", .{err});
            this.ipc.close();
        }

        fn onRead(this: *Context, buffer: []const u8) void {
            log("onRead {d}", .{buffer.len});
            this.ipc.incoming.len += @as(u32, @truncate(buffer.len));
            var slice = this.ipc.incoming.slice();

            std.debug.assert(this.ipc.incoming.len <= this.ipc.incoming.cap);
            std.debug.assert(bun.isSliceInBuffer(buffer, this.ipc.incoming.allocatedSlice()));

            const globalThis = switch (@typeInfo(@TypeOf(this.globalThis))) {
                .Pointer => this.globalThis,
                .Optional => brk: {
                    if (this.globalThis) |global| {
                        break :brk global;
                    }
                    this.ipc.close();
                    return;
                },
                else => @panic("Unexpected globalThis type: " ++ @typeName(@TypeOf(this.globalThis))),
            };
            while (true) {
                const result = decodeIPCMessage(slice, globalThis) catch |e| switch (e) {
                    error.NotEnoughBytes => {
                        // copy the remaining bytes to the start of the buffer
                        bun.copy(u8, this.ipc.incoming.ptr[0..slice.len], slice);
                        this.ipc.incoming.len = @truncate(slice.len);
                        log("hit NotEnoughBytes2", .{});
                        return;
                    },
                    error.InvalidFormat => {
                        Output.printErrorln("InvalidFormatError during IPC message handling", .{});
                        this.ipc.close();
                        return;
                    },
                };

                this.handleIPCMessage(result.message);

                if (result.bytes_consumed < slice.len) {
                    slice = slice[result.bytes_consumed..];
                } else {
                    // clear the buffer
                    this.ipc.incoming.len = 0;
                    return;
                }
            }
        }

        pub fn onNewClientConnect(this: *Context, status: uv.ReturnCode) void {
            log("onNewClientConnect {d}", .{status.int()});
            if (status.errEnum()) |_| {
                Output.printErrorln("Failed to connect IPC pipe", .{});
                return;
            }
            const server = this.ipc.server orelse {
                Output.printErrorln("Failed to connect IPC pipe", .{});
                return;
            };
            var client = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory();
            client.init(uv.Loop.get(), true).unwrap() catch {
                bun.default_allocator.destroy(client);
                Output.printErrorln("Failed to connect IPC pipe", .{});
                return;
            };

            this.ipc.writer.startWithPipe(client).unwrap() catch {
                bun.default_allocator.destroy(client);
                Output.printErrorln("Failed to start IPC pipe", .{});
                return;
            };

            switch (server.accept(client)) {
                .err => {
                    this.ipc.close();
                    return;
                },
                .result => {
                    this.ipc.connected = true;
                    client.readStart(this, onReadAlloc, onReadError, onRead).unwrap() catch {
                        this.ipc.close();
                        Output.printErrorln("Failed to connect IPC pipe", .{});
                        return;
                    };
                    _ = this.ipc.writer.flush();
                },
            }
        }

        pub fn onClose(this: *Context) void {
            this.handleIPCClose();
        }

        fn onConnect(this: *Context, status: uv.ReturnCode) void {
            log("onConnect {d}", .{status.int()});
            this.ipc.connected = true;

            if (status.errEnum()) |_| {
                Output.printErrorln("Failed to connect IPC pipe", .{});
                return;
            }
            const stream = this.ipc.writer.getStream() orelse {
                this.ipc.close();
                Output.printErrorln("Failed to connect IPC pipe", .{});
                return;
            };

            stream.readStart(this, onReadAlloc, onReadError, onRead).unwrap() catch {
                this.ipc.close();
                Output.printErrorln("Failed to connect IPC pipe", .{});
                return;
            };
            _ = this.ipc.writer.flush();
        }
    };
}

/// This type is shared between VirtualMachine and Subprocess for their respective IPC handlers
///
/// `Context` must be a struct that implements this interface:
/// struct {
///     globalThis: ?*JSGlobalObject,
///     ipc: IPCData,
///
///     fn handleIPCMessage(*Context, DecodedIPCMessage) void
///     fn handleIPCClose(*Context) void
/// }
pub fn NewIPCHandler(comptime Context: type) type {
    const IPCHandler = if (Environment.isWindows) NewNamedPipeIPCHandler else NewSocketIPCHandler;
    return IPCHandler(Context);
}
