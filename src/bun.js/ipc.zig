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

const IsInternal = enum { internal, external };

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

    pub const fromJS = Map.fromJS;
    pub const fromString = Map.get;
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
            .SerializedMessage, .SerializedInternalMessage => |tag| {
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
                    .message = if (tag == .SerializedInternalMessage) .{ .internal = deserialized } else .{ .data = deserialized },
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
    pub fn getAckPacket() []const u8 {
        @panic("TODO: advanced getAckPacket");
    }
    pub fn getNackPacket() []const u8 {
        @panic("TODO: advanced getNackPacket");
    }

    pub fn serialize(_: *IPCData, writer: *bun.io.StreamBuffer, global: *JSC.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
        const serialized = value.serialize(global) orelse
            return IPCSerializationError.SerializationFailed;
        defer serialized.deinit();

        const size: u32 = @intCast(serialized.data.len);

        const payload_length: usize = @sizeOf(IPCMessageType) + @sizeOf(u32) + size;

        try writer.ensureUnusedCapacity(payload_length);

        writer.writeTypeAsBytesAssumeCapacity(IPCMessageType, switch (is_internal) {
            .internal => .SerializedInternalMessage,
            .external => .SerializedMessage,
        });
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
    pub fn getAckPacket() []const u8 {
        return "{\"cmd\":\"NODE_HANDLE_ACK\"}\n";
    }
    pub fn getNackPacket() []const u8 {
        return "{\"cmd\":\"NODE_HANDLE_NACK\"}\n";
    }

    // In order to not have to do a property lookup json messages sent from Bun will have a single u8 prepended to them
    // to be able to distinguish whether it is a regular json message or an internal one for cluster ipc communication.
    // 1 is regular
    // 2 is internal

    pub fn decodeIPCMessage(data: []const u8, globalThis: *JSC.JSGlobalObject) IPCDecodeError!DecodeIPCMessageResult {
        if (bun.strings.indexOfChar(data, '\n')) |idx| {
            var kind = data[0];
            var json_data = data[0..idx];

            switch (kind) {
                2 => {
                    json_data = data[1..idx];
                },
                else => {
                    // assume it's valid json with no header
                    // any error will be thrown by toJSByParseJSON below
                    kind = 1;
                },
            }

            if (json_data.len == 0) return IPCDecodeError.NotEnoughBytes;

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

            const deserialized = str.toJSByParseJSON(globalThis) catch |e| switch (e) {
                error.JSError => {
                    globalThis.clearException();
                    return IPCDecodeError.InvalidFormat;
                },
                error.OutOfMemory => return bun.outOfMemory(),
            };

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

    pub fn serialize(_: *IPCData, writer: *bun.io.StreamBuffer, global: *JSC.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
        var out: bun.String = undefined;
        value.jsonStringify(global, 0, &out);
        defer out.deref();

        if (out.tag == .Dead) return IPCSerializationError.SerializationFailed;

        // TODO: it would be cool to have a 'toUTF8Into' which can write directly into 'ipc_data.outgoing.list'
        const str = out.toUTF8(bun.default_allocator);
        defer str.deinit();

        const slice = str.slice();

        var result_len: usize = slice.len + 1;
        if (is_internal == .internal) result_len += 1;

        try writer.ensureUnusedCapacity(result_len);

        if (is_internal == .internal) {
            writer.writeAssumeCapacity(&.{2});
        }
        writer.writeAssumeCapacity(slice);
        writer.writeAssumeCapacity("\n");

        return result_len;
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
pub fn serialize(data: *IPCData, writer: *bun.io.StreamBuffer, global: *JSC.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
    return switch (data.mode) {
        .advanced => advanced.serialize(data, writer, global, value, is_internal),
        .json => json.serialize(data, writer, global, value, is_internal),
    };
}

pub fn getAckPacket(data: *IPCData) []const u8 {
    return switch (data.mode) {
        .advanced => advanced.getAckPacket(),
        .json => json.getAckPacket(),
    };
}

pub fn getNackPacket(data: *IPCData) []const u8 {
    return switch (data.mode) {
        .advanced => advanced.getNackPacket(),
        .json => json.getNackPacket(),
    };
}

pub const Socket = uws.NewSocketHandler(false);

pub const Handle = struct {
    fd: bun.FileDescriptor,
    fn deinit(self: *Handle) void {
        _ = self;
    }
};
pub const SendHandle = struct {
    // when a message has a handle, make sure it has a new SendHandle - so that if we retry sending it,
    // we only retry sending the message with the handle, not the original message.
    data: bun.io.StreamBuffer = .{},
    handle: ?Handle,
    is_ack_nack: bool = false,
    // keep sending the handle until data is drained (assume it hasn't sent until data is fully drained)

    pub fn deinit(self: *SendHandle) void {
        self.data.deinit();
        if (self.handle) |*handle| {
            handle.deinit();
        }
    }
    pub fn reset(self: *SendHandle) void {
        self.data.reset();
        if (self.handle) |*handle| {
            handle.deinit();
            self.handle = null;
        }
    }
};

pub const SendQueue = struct {
    queue: std.ArrayList(SendHandle),
    waiting_for_ack: ?SendHandle = null,

    retry_count: u32 = 0,
    keep_alive: bun.Async.KeepAlive = .{},
    pub fn init() @This() {
        return .{ .queue = .init(bun.default_allocator) };
    }
    pub fn deinit(self: *@This()) void {
        for (self.queue.items) |*item| item.deinit();
        self.queue.deinit();
        self.keep_alive.disable();
        if (self.waiting_for_ack) |*waiting| waiting.deinit();
    }

    /// returned pointer is invalidated if the queue is modified
    pub fn startMessage(self: *SendQueue, handle: ?Handle) *SendHandle {
        if (self.queue.items.len == 0) {
            // queue is empty; add an item
            self.queue.append(.{ .handle = handle }) catch bun.outOfMemory();
            return &self.queue.items[0];
        }
        const last = &self.queue.items[self.queue.items.len - 1];
        // if there is a handle, always add a new item even if the previous item doesn't have a handle
        //   this is so that in the case of a NACK, we can retry sending the whole message that has the handle
        // if the last item has a handle, always add a new item
        if (last.handle != null or handle != null) {
            self.queue.append(.{ .handle = handle }) catch bun.outOfMemory();
            return &self.queue.items[0];
        }
        bun.assert(handle == null);
        return last;
    }

    pub fn onAckNack(this: *SendQueue, global: *JSGlobalObject, socket: anytype, ack_nack: enum { ack, nack }) void {
        if (this.waiting_for_ack == null) {
            log("onAckNack: ack received but not waiting for ack", .{});
            return;
        }
        const item = &this.waiting_for_ack.?;
        if (item.handle == null) {
            log("onAckNack: ack received but waiting_for_ack is not a handle message?", .{});
            return;
        }
        if (ack_nack == .nack) {
            // retry up to three times
            this.retry_count += 1;
            if (this.retry_count < MAX_HANDLE_RETRANSMISSIONS) {
                // retry sending the message
                item.data.cursor = 0;
                if (this.queue.items.len == 0 or this.queue.items[0].data.cursor == 0) {
                    // prepend (we have not started sending the next message yet because we are waiting for the ack/nack)
                    this.queue.insert(0, item.*) catch bun.outOfMemory();
                    this.waiting_for_ack = null;
                } else {
                    // insert at index 1 (we are in the middle of sending an ack/nack to the other process)
                    bun.debugAssert(this.queue.items[0].is_ack_nack);
                    this.queue.insert(1, item.*) catch bun.outOfMemory();
                    this.waiting_for_ack = null;
                }
                return this.continueSend(global, socket, .new_message_appended);
            }
            // too many retries; give up
            var warning = bun.String.static("Handle did not reach the receiving process correctly");
            var warning_name = bun.String.static("SentHandleNotReceivedWarning");
            global.emitWarning(
                warning.transferToJS(global),
                warning_name.transferToJS(global),
                .undefined,
                .undefined,
            ) catch |e| {
                _ = global.takeException(e);
            };
            // (fall through to success code in order to consume the message and continue sending)
        }
        // consume the message and continue sending
        item.deinit();
        this.waiting_for_ack = null;
        this.continueSend(global, socket, .new_message_appended);
    }
    fn shouldRef(this: *SendQueue) bool {
        if (this.waiting_for_ack != null) return true; // waiting to receive an ack/nack from the other side
        if (this.queue.items.len == 0) return false; // nothing to send
        const first = &this.queue.items[0];
        if (first.data.cursor > 0) return true; // send in progress, waiting on writable
        return false; // error state.
    }
    pub fn updateRef(this: *SendQueue, global: *JSGlobalObject) void {
        switch (this.shouldRef()) {
            true => this.keep_alive.ref(global.bunVM()),
            false => this.keep_alive.unref(global.bunVM()),
        }
    }
    const ContinueSendReason = enum {
        new_message_appended,
        on_writable,
    };
    fn _continueSend(this: *SendQueue, socket: anytype, reason: ContinueSendReason) void {
        if (this.queue.items.len == 0) {
            return; // nothing to send
        }

        const first = &this.queue.items[0];
        if (this.waiting_for_ack != null and !first.is_ack_nack) {
            // waiting for ack/nack. may not send any items until it is received.
            // only allowed to send the message if it is an ack/nack itself.
            return;
        }
        if (reason != .on_writable and first.data.cursor != 0) {
            // the last message isn't fully sent yet, we're waiting for a writable event
            return;
        }
        const to_send = first.data.list.items[first.data.cursor..];
        if (to_send.len == 0) {
            return; // nothing to send
        }
        const n = if (first.handle) |handle| socket.writeFd(to_send, handle.fd) else socket.write(to_send, false);
        if (n == to_send.len) {
            if (first.handle) |_| {
                // the message was fully written, but it had a handle.
                // we must wait for ACK or NACK before sending any more messages.
                if (this.waiting_for_ack != null) {
                    log("[error] already waiting for ack. this should never happen.", .{});
                }
                // shift the item off the queue and move it to waiting_for_ack
                const item = this.queue.orderedRemove(0);
                this.waiting_for_ack = item;
                return _continueSend(this, socket, reason); // in case the next item is an ack/nack waiting to be sent
            } else if (this.queue.items.len == 1) {
                // the message was fully sent and this is the last item; reuse the StreamBuffer for the next message
                first.reset();
                // the last item was fully sent; wait for the next .send() call from js
                return;
            } else {
                // the message was fully sent, but there are more items in the queue.
                // shift the queue and try to send the next item immediately.
                var item = this.queue.orderedRemove(0);
                item.deinit(); // free the StreamBuffer.
                return _continueSend(this, socket, reason);
            }
        } else if (n > 0 and n < @as(i32, @intCast(first.data.list.items.len))) {
            // the item was partially sent; update the cursor and wait for writable to send the rest
            // (if we tried to send a handle, a partial write means the handle wasn't sent yet.)
            first.data.cursor += @intCast(n);
            return;
        } else {
            // error?
            return;
        }
    }
    fn continueSend(this: *SendQueue, global: *JSGlobalObject, socket: anytype, reason: ContinueSendReason) void {
        this._continueSend(socket, reason);
        this.updateRef(global);
    }
};
const MAX_HANDLE_RETRANSMISSIONS = 3;

/// Used on POSIX
const SocketIPCData = struct {
    socket: Socket,
    mode: Mode,

    incoming: bun.ByteList = .{}, // Maybe we should use StreamBuffer here as well
    incoming_fd: ?bun.FileDescriptor = null,
    send_queue: SendQueue = .init(),
    has_written_version: if (Environment.allow_assert) u1 else u0 = 0,
    internal_msg_queue: node_cluster_binding.InternalMsgHolder = .{},
    disconnected: bool = false,
    is_server: bool = false,
    close_next_tick: ?JSC.Task = null,

    pub fn deinit(ipc_data: *SocketIPCData) void {
        // ipc_data.socket may already be UAF when this is called
        ipc_data.internal_msg_queue.deinit();
        ipc_data.send_queue.deinit();
        ipc_data.incoming.deinitWithAllocator(bun.default_allocator);

        // if there is a close next tick task, cancel it so it doesn't get called and then UAF
        if (ipc_data.close_next_tick) |close_next_tick_task| {
            const managed: *bun.JSC.ManagedTask = close_next_tick_task.as(bun.JSC.ManagedTask);
            managed.cancel();
        }
    }

    pub fn writeVersionPacket(this: *SocketIPCData, global: *JSC.JSGlobalObject) void {
        if (Environment.allow_assert) {
            bun.assert(this.has_written_version == 0);
        }
        const bytes = getVersionPacket(this.mode);
        if (bytes.len > 0) {
            const msg = this.send_queue.startMessage(null);
            msg.data.write(bytes) catch bun.outOfMemory();
            this.send_queue.continueSend(global, this.socket, .new_message_appended);
        }
        if (Environment.allow_assert) {
            this.has_written_version = 1;
        }
    }

    pub fn serializeAndSend(ipc_data: *SocketIPCData, global: *JSGlobalObject, value: JSValue, is_internal: IsInternal) bool {
        if (Environment.allow_assert) {
            bun.assert(ipc_data.has_written_version == 1);
        }

        const msg = ipc_data.send_queue.startMessage(null);
        const start_offset = msg.data.list.items.len;

        const payload_length = serialize(ipc_data, &msg.data, global, value, is_internal) catch return false;
        bun.assert(msg.data.list.items.len == start_offset + payload_length);

        ipc_data.send_queue.continueSend(global, ipc_data.socket, .new_message_appended);

        return true;
    }

    pub fn close(this: *SocketIPCData, nextTick: bool) void {
        log("SocketIPCData#close", .{});
        if (this.disconnected) return;
        this.disconnected = true;
        if (nextTick) {
            if (this.close_next_tick != null) return;
            this.close_next_tick = JSC.ManagedTask.New(SocketIPCData, closeTask).init(this);
            JSC.VirtualMachine.get().enqueueTask(this.close_next_tick.?);
        } else {
            this.closeTask();
        }
    }

    pub fn closeTask(this: *SocketIPCData) void {
        log("SocketIPCData#closeTask", .{});
        this.close_next_tick = null;
        bun.assert(this.disconnected);
        this.socket.close(.normal);
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

    pub fn writeVersionPacket(this: *NamedPipeIPCData, _: *JSC.JSGlobalObject) void {
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

    pub fn serializeAndSend(this: *NamedPipeIPCData, global: *JSGlobalObject, value: JSValue, is_internal: IsInternal) bool {
        if (Environment.allow_assert) {
            bun.assert(this.has_written_version == 1);
        }
        if (this.disconnected) {
            return false;
        }
        // ref because we have pending data
        this.writer.source.?.pipe.ref();
        const start_offset = this.writer.outgoing.list.items.len;

        const payload_length: usize = serialize(this, &this.writer.outgoing, global, value, is_internal) catch return false;

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

fn emitProcessErrorEvent(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    std.log.info("S#impl", .{});
    const ex = callframe.argumentsAsArray(1)[0];
    JSC.VirtualMachine.Process__emitErrorEvent(globalThis, ex);
    return .undefined;
}
const FromEnum = enum { subprocess_exited, subprocess, process };
pub fn doSend(ipc: ?*IPCData, globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame, from: FromEnum) bun.JSError!JSValue {
    var message, var handle, var options_, var callback = callFrame.argumentsAsArray(4);

    if (handle.isFunction()) {
        callback = handle;
        handle = .undefined;
        options_ = .undefined;
    } else if (options_.isFunction()) {
        callback = options_;
        options_ = .undefined;
    } else if (!options_.isUndefined()) {
        try globalObject.validateObject("options", options_, .{});
    }

    const ipc_data = ipc orelse {
        switch (from) {
            .process => {
                const ex = globalObject.ERR_IPC_CHANNEL_CLOSED("Subprocess.send() cannot be used after the process has exited.", .{}).toJS();
                const target = if (callback.isFunction()) callback else JSC.JSFunction.create(globalObject, "", emitProcessErrorEvent, 1, .{});
                JSC.Bun__Process__queueNextTick1(globalObject, target, ex);
            },
            // child_process wrapper will catch the error and emit it as an 'error' event or send it to the callback
            .subprocess => return globalObject.ERR_IPC_CHANNEL_CLOSED("Subprocess.send() can only be used if an IPC channel is open.", .{}).throw(),
            .subprocess_exited => return globalObject.ERR_IPC_CHANNEL_CLOSED("Subprocess.send() cannot be used after the process has exited.", .{}).throw(),
        }
        return .false;
    };

    if (message.isUndefined()) {
        return globalObject.throwMissingArgumentsValue(&.{"message"});
    }
    if (!message.isString() and !message.isObject() and !message.isNumber() and !message.isBoolean() and !message.isNull()) {
        return globalObject.throwInvalidArgumentTypeValueOneOf("message", "string, object, number, or boolean", message);
    }

    const good = ipc_data.serializeAndSend(globalObject, message, .external);

    if (good) {
        if (callback.isFunction()) {
            JSC.Bun__Process__queueNextTick1(globalObject, callback, .null);
        }
    } else {
        const ex = globalObject.createTypeErrorInstance("process.send() failed", .{});
        ex.put(globalObject, JSC.ZigString.static("syscall"), bun.String.static("write").toJS(globalObject));
        switch (from) {
            .process => {
                const target = if (callback.isFunction()) callback else JSC.JSFunction.create(globalObject, "", emitProcessErrorEvent, 1, .{});
                JSC.Bun__Process__queueNextTick1(globalObject, target, ex);
            },
            // child_process wrapper will catch the error and emit it as an 'error' event or send it to the callback
            else => return globalObject.throwValue(ex),
        }
        return .false;
    }

    return .true;
}

pub const IPCData = if (Environment.isWindows) NamedPipeIPCData else SocketIPCData;

/// Used on POSIX
fn NewSocketIPCHandler(comptime Context: type) type {
    return struct {
        pub fn onOpen(
            _: *anyopaque,
            _: Socket,
        ) void {
            log("onOpen", .{});
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
            log("onClose", .{});
            const ipc = this.ipc() orelse return;
            // unref if needed
            ipc.send_queue.keep_alive.unref((this.getGlobalThis() orelse return).bunVM());
            // Note: uSockets has already freed the underlying socket, so calling Socket.close() can segfault
            log("NewSocketIPCHandler#onClose\n", .{});

            // after onClose(), socketIPCData.close should never be called again because socketIPCData may be freed. just in case, set disconnected to true.
            ipc.disconnected = true;

            this.handleIPCClose();
        }

        pub fn onData(
            this: *Context,
            socket: Socket,
            all_data: []const u8,
        ) void {
            var data = all_data;
            const ipc: *IPCData = this.ipc() orelse return;
            log("onData {}", .{std.fmt.fmtSliceHexLower(data)});

            // In the VirtualMachine case, `globalThis` is an optional, in case
            // the vm is freed before the socket closes.
            const globalThis: *JSC.JSGlobalObject = switch (@typeInfo(@TypeOf(this.globalThis))) {
                .pointer => this.globalThis,
                .optional => brk: {
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
                            socket.close(.failure);
                            return;
                        },
                    };

                    skip_handle_message: {
                        if (result.message == .data) {
                            // TODO: get property 'cmd' from the message, read as a string
                            // to skip this property lookup (and simplify the code significantly)
                            // we could make three new message types:
                            // - data_with_handle
                            // - ack
                            // - nack
                            // This would make the IPC not interoperable with node
                            // - advanced ipc already is completely different in bun. bun uses
                            // - json ipc is the same as node in bun
                            const msg_data = result.message.data;
                            if (msg_data.isObject()) {
                                const cmd = msg_data.get(globalThis, "cmd") catch |e| {
                                    _ = globalThis.takeException(e);
                                    break :skip_handle_message;
                                };
                                if (cmd != null and cmd.?.isString()) {
                                    const cmd_str = bun.String.fromJS(cmd.?, globalThis) catch |e| {
                                        _ = globalThis.takeException(e);
                                        break :skip_handle_message;
                                    };
                                    if (cmd_str.eqlComptime("NODE_HANDLE")) {
                                        // Handle NODE_HANDLE message
                                        const ack = ipc.incoming_fd != null;

                                        const packet = if (ack) getAckPacket(ipc) else getNackPacket(ipc);
                                        var handle = SendHandle{ .data = .{}, .handle = null, .is_ack_nack = true };
                                        handle.data.write(packet) catch bun.outOfMemory();

                                        // Insert at appropriate position in send queue
                                        if (ipc.send_queue.queue.items.len == 0 or ipc.send_queue.queue.items[0].data.cursor == 0) {
                                            ipc.send_queue.queue.insert(0, handle) catch bun.outOfMemory();
                                        } else {
                                            ipc.send_queue.queue.insert(1, handle) catch bun.outOfMemory();
                                        }

                                        // Send if needed
                                        ipc.send_queue.continueSend(globalThis, socket, .new_message_appended);

                                        if (!ack) break :skip_handle_message;

                                        // Get file descriptor and clear it
                                        const fd = ipc.incoming_fd.?;
                                        ipc.incoming_fd = null;
                                        _ = fd;

                                        @panic("TODO: decode handle, decode message, call handleIPCMessage() with the resolved handle");
                                    } else if (cmd_str.eqlComptime("NODE_HANDLE_ACK")) {
                                        ipc.send_queue.onAckNack(globalThis, socket, .ack);
                                        break :skip_handle_message;
                                    } else if (cmd_str.eqlComptime("NODE_HANDLE_NACK")) {
                                        ipc.send_queue.onAckNack(globalThis, socket, .nack);
                                        break :skip_handle_message;
                                    }
                                }
                            }
                        }

                        this.handleIPCMessage(result.message);
                    }

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

        pub fn onFd(
            this: *Context,
            _: Socket,
            fd: c_int,
        ) void {
            const ipc: *IPCData = this.ipc() orelse return;
            if (ipc.incoming_fd != null) {
                log("onFd: incoming_fd already set; overwriting", .{});
            }
            ipc.incoming_fd = @enumFromInt(fd);
        }

        pub fn onWritable(
            context: *Context,
            socket: Socket,
        ) void {
            log("onWritable", .{});
            const ipc: *IPCData = context.ipc() orelse return;
            ipc.send_queue.continueSend(context.getGlobalThis() orelse return, socket, .on_writable);
        }

        pub fn onTimeout(
            context: *Context,
            _: Socket,
        ) void {
            log("onTimeout", .{});
            const ipc = context.ipc() orelse return;
            // unref if needed
            ipc.send_queue.keep_alive.unref((context.getGlobalThis() orelse return).bunVM());
        }

        pub fn onLongTimeout(
            context: *Context,
            _: Socket,
        ) void {
            log("onLongTimeout", .{});
            const ipc = context.ipc() orelse return;
            // unref if needed
            ipc.send_queue.keep_alive.unref((context.getGlobalThis() orelse return).bunVM());
        }

        pub fn onConnectError(
            _: *anyopaque,
            _: Socket,
            _: c_int,
        ) void {
            log("onConnectError", .{});
            // context has not been initialized
        }

        pub fn onEnd(
            _: *Context,
            s: Socket,
        ) void {
            log("onEnd", .{});
            s.close(.failure);
        }
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
                .pointer => this.globalThis,
                .optional => brk: {
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
                        log("hit NotEnoughBytes3", .{});
                        return;
                    },
                    error.InvalidFormat => {
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
