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

pub const IPCBuffer = struct {
    list: bun.ByteList = .{},
    cursor: u32 = 0,
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

pub const IPCData = struct {
    socket: Socket,
    incoming: bun.ByteList = .{}, // Maybe we should use IPCBuffer here as well
    outgoing: IPCBuffer = .{},

    has_written_version: if (Environment.allow_assert) u1 else u0 = 0,

    pub fn writeVersionPacket(this: *IPCData) void {
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
            var list = this.outgoing.list.listManaged(bun.default_allocator);
            list.appendSlice(bytes) catch @panic("OOM");
        }
        if (Environment.allow_assert) {
            this.has_written_version = 1;
        }
    }

    pub fn serializeAndSend(ipc_data: *IPCData, globalThis: *JSGlobalObject, value: JSValue) bool {
        if (Environment.allow_assert) {
            std.debug.assert(ipc_data.has_written_version == 1);
        }

        const serialized = value.serialize(globalThis) orelse return false;
        defer serialized.deinit();

        const size: u32 = @intCast(serialized.data.len);

        const payload_length: usize = @sizeOf(IPCMessageType) + @sizeOf(u32) + size;

        ipc_data.outgoing.list.ensureUnusedCapacity(bun.default_allocator, payload_length) catch @panic("OOM");
        const start_offset = ipc_data.outgoing.list.len;

        ipc_data.outgoing.list.writeTypeAsBytesAssumeCapacity(u8, @intFromEnum(IPCMessageType.SerializedMessage));
        ipc_data.outgoing.list.writeTypeAsBytesAssumeCapacity(u32, size);
        ipc_data.outgoing.list.appendSliceAssumeCapacity(serialized.data);

        std.debug.assert(ipc_data.outgoing.list.len == start_offset + payload_length);

        if (start_offset == 0) {
            std.debug.assert(ipc_data.outgoing.cursor == 0);

            const n = ipc_data.socket.write(ipc_data.outgoing.list.ptr[start_offset..payload_length], false);
            if (n == payload_length) {
                ipc_data.outgoing.list.len = 0;
            } else if (n > 0) {
                ipc_data.outgoing.cursor = @intCast(n);
            }
        }

        return true;
    }
};

/// This type is shared between VirtualMachine and Subprocess for their respective IPC handlers
///
/// `Context` must be a struct that implements this interface:
/// struct {
///     globalThis: ?*JSGlobalObject,
///     ipc: IPCData,
///
///     fn handleIPCMessage(*Context, DecodedIPCMessage) void
///     fn handleIPCClose(*Context, Socket) void
/// }
pub fn NewIPCHandler(comptime Context: type) type {
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
            socket: Socket,
            _: c_int,
            _: ?*anyopaque,
        ) void {
            // ?! does uSockets .close call onClose?
            log("onClose\n", .{});
            this.handleIPCClose(socket);
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
                    this.handleIPCClose(socket);
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
                            _ = this.ipc.incoming.write(bun.default_allocator, data) catch @panic("OOM");
                            log("hit NotEnoughBytes", .{});
                            return;
                        },
                        error.InvalidFormat => {
                            Output.printErrorln("InvalidFormatError during IPC message handling", .{});
                            this.handleIPCClose(socket);
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

            _ = this.ipc.incoming.write(bun.default_allocator, data) catch @panic("OOM");

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
                        this.handleIPCClose(socket);
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
            const to_write = context.ipc.outgoing.list.ptr[context.ipc.outgoing.cursor..context.ipc.outgoing.list.len];
            if (to_write.len == 0) {
                context.ipc.outgoing.cursor = 0;
                context.ipc.outgoing.list.len = 0;
                return;
            }
            const n = socket.write(to_write, false);
            if (n == to_write.len) {
                context.ipc.outgoing.cursor = 0;
                context.ipc.outgoing.list.len = 0;
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
