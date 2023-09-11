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

/// This type is shared between VirtualMachine and Subprocess for their respective IPC handlers
///
/// `Context` must be a struct that implements this interface:
/// struct {
///     globalThis: ?*JSGlobalObject,
///     ipc_buffer: bun.ByteList,
///
///     fn handleIPCMessage(*Context, DecodedIPCMessage) void
///     fn handleIPCClose(*Context, Socket) void
/// }
pub fn NewIPCHandler(comptime Context: type) type {
    return struct {
        pub fn onOpen(
            _: *Context,
            socket: Socket,
        ) void {
            // Write the version message
            const Data = extern struct {
                type: IPCMessageType align(1) = .Version,
                version: u32 align(1) = ipcVersion,
            };
            const data: []const u8 = comptime @as([@sizeOf(Data)]u8, @bitCast(Data{}))[0..];
            _ = socket.write(data, false);
            socket.flush();
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
        // extern fn getpid() i32;
        pub fn onData(
            this: *Context,
            socket: Socket,
            data_: []const u8,
        ) void {
            var data = data_;
            log("onData {}", .{std.fmt.fmtSliceHexLower(data)});

            // if (comptime Context == bun.JSC.VirtualMachine.IPCInstance) {
            //     logDataOnly("{d} -> '{}'", .{ getpid(), std.fmt.fmtSliceHexLower(data) });
            // }

            // In the VirtualMachine case, `globalThis` is an optional, in case
            // the vm is freed before the socket closes.
            var globalThis = switch (@typeInfo(@TypeOf(this.globalThis))) {
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
            if (this.ipc_buffer.len == 0) {
                while (true) {
                    const result = decodeIPCMessage(data, globalThis) catch |e| switch (e) {
                        error.NotEnoughBytes => {
                            _ = this.ipc_buffer.write(bun.default_allocator, data) catch @panic("OOM");
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

            _ = this.ipc_buffer.write(bun.default_allocator, data) catch @panic("OOM");

            var slice = this.ipc_buffer.slice();
            while (true) {
                const result = decodeIPCMessage(slice, globalThis) catch |e| switch (e) {
                    error.NotEnoughBytes => {
                        // copy the remaining bytes to the start of the buffer
                        bun.copy(u8, this.ipc_buffer.ptr[0..slice.len], slice);
                        this.ipc_buffer.len = @truncate(slice.len);
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
                    this.ipc_buffer.len = 0;
                    return;
                }
            }
        }

        pub fn onWritable(
            _: *Context,
            _: Socket,
        ) void {}
        pub fn onTimeout(
            _: *Context,
            _: Socket,
        ) void {}
        pub fn onConnectError(
            _: *Context,
            _: Socket,
            _: c_int,
        ) void {}
        pub fn onEnd(
            _: *Context,
            _: Socket,
        ) void {}
    };
}

/// This is used for Bun.spawn() IPC because otherwise we would have to copy the data once to get it to zig, then write it.
/// Returns `true` on success, `false` on failure + throws a JS error.
extern fn Bun__serializeJSValueForSubprocess(global: *JSC.JSGlobalObject, value: JSValue, fd: bun.FileDescriptor) bool;

pub const serializeJSValueForSubprocess = Bun__serializeJSValueForSubprocess;
