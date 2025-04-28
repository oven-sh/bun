const uws = bun.uws;
const bun = @import("bun");
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
const SerializeAndSendResult = enum {
    success,
    failure,
    backoff,
};

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
} || bun.OOM;

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
        return "\x02\x24\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x0f\x00\x00\x80NODE_HANDLE_ACK\xff\xff\xff\xff";
    }
    pub fn getNackPacket() []const u8 {
        return "\x02\x25\x00\x00\x00\r\x00\x00\x00\x02\x03\x00\x00\x80cmd\x10\x10\x00\x00\x80NODE_HANDLE_NACK\xff\xff\xff\xff";
    }

    pub fn serialize(writer: *bun.io.StreamBuffer, global: *JSC.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
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
    fn jsonIPCDataStringFreeCB(context: *bool, _: *anyopaque, _: u32) callconv(.C) void {
        context.* = true;
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

    // In order to not have to do a property lookup internal messages sent from Bun will have a single u8 prepended to them
    // to be able to distinguish whether it is a regular json message or an internal one for cluster ipc communication.
    // 2 is internal
    // ["[{\d\.] is regular

    pub fn decodeIPCMessage(data: []const u8, globalThis: *JSC.JSGlobalObject) IPCDecodeError!DecodeIPCMessageResult {
        // <tag>{ "foo": "bar"} // tag is 1 or 2
        if (bun.strings.indexOfChar(data, '\n')) |idx| {
            var json_data = data[0..idx];
            // bounds-check for the following json_data[0]
            // TODO: should we return NotEnoughBytes?
            if (json_data.len == 0) return error.InvalidFormat;

            var kind: enum { regular, internal } = .regular;
            if (json_data[0] == 2) {
                // internal message
                json_data = json_data[1..];
                kind = .internal;
            }

            const is_ascii = bun.strings.isAllASCII(json_data);
            var was_ascii_string_freed = false;

            // Use ExternalString to avoid copying data if possible.
            // This is only possible for ascii data, as that fits into latin1
            // otherwise we have to convert it utf-8 into utf16-le.
            var str = if (is_ascii) ascii: {

                // .dead if `json_data` exceeds max length
                const s = bun.String.createExternal(*bool, json_data, true, &was_ascii_string_freed, jsonIPCDataStringFreeCB);
                if (s.tag == .Dead) {
                    @branchHint(.unlikely);
                    return IPCDecodeError.OutOfMemory;
                }
                break :ascii s;
            } else bun.String.fromUTF8(json_data);

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
                .regular => .{
                    .bytes_consumed = idx + 1,
                    .message = .{ .data = deserialized },
                },
                .internal => .{
                    .bytes_consumed = idx + 1,
                    .message = .{ .internal = deserialized },
                },
            };
        }
        return IPCDecodeError.NotEnoughBytes;
    }

    pub fn serialize(writer: *bun.io.StreamBuffer, global: *JSC.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
        var out: bun.String = undefined;
        value.jsonStringify(global, 0, &out);
        defer out.deref();

        if (out.tag == .Dead) return IPCSerializationError.SerializationFailed;

        // TODO: it would be cool to have a 'toUTF8Into' which can write directly into 'ipc_data.outgoing.list'
        const str = out.toUTF8(bun.debug_allocator);
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
pub fn serialize(mode: Mode, writer: *bun.io.StreamBuffer, global: *JSC.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
    return switch (mode) {
        .advanced => advanced.serialize(writer, global, value, is_internal),
        .json => json.serialize(writer, global, value, is_internal),
    };
}

pub fn getAckPacket(mode: Mode) []const u8 {
    return switch (mode) {
        .advanced => advanced.getAckPacket(),
        .json => json.getAckPacket(),
    };
}

pub fn getNackPacket(mode: Mode) []const u8 {
    return switch (mode) {
        .advanced => advanced.getNackPacket(),
        .json => json.getNackPacket(),
    };
}

pub const Socket = uws.NewSocketHandler(false);

pub const Handle = struct {
    fd: bun.FileDescriptor,
    js: JSC.JSValue,
    pub fn init(fd: bun.FileDescriptor, js: JSC.JSValue) @This() {
        js.protect();
        return .{ .fd = fd, .js = js };
    }
    fn deinit(self: *Handle) void {
        self.js.unprotect();
    }
};
pub const SendHandle = struct {
    // when a message has a handle, make sure it has a new SendHandle - so that if we retry sending it,
    // we only retry sending the message with the handle, not the original message.
    data: bun.io.StreamBuffer = .{},
    /// keep sending the handle until data is drained (assume it hasn't sent until data is fully drained)
    handle: ?Handle,
    /// if zero, this indicates that the message is an ack/nack. these can send even if there is a handle waiting_for_ack.
    /// if undefined or null, this indicates that the message does not have a callback.
    callback: JSC.JSValue,

    pub fn isAckNack(self: *SendHandle) bool {
        return self.callback == .zero;
    }

    /// Call the callback and deinit
    pub fn complete(self: *SendHandle, global: *JSC.JSGlobalObject) void {
        if (self.callback.isEmptyOrUndefinedOrNull()) return;
        const loop = global.bunVM().eventLoop();
        // complete() may be called immediately after send, or it could be called from onMessage
        // Entter the event loop and use queueNextTick so it never gets called immediately
        loop.enter();
        defer loop.exit();

        if (self.callback.isArray()) {
            var iter = self.callback.arrayIterator(global);
            while (iter.next()) |item| {
                if (item.isFunction()) {
                    item.callNextTick(global, .{.null});
                }
            }
        } else if (self.callback.isFunction()) {
            self.callback.callNextTick(global, .{.null});
        }
        self.deinit();
    }
    pub fn deinit(self: *SendHandle) void {
        self.data.deinit();
        self.callback.unprotect();
        if (self.handle) |*handle| {
            handle.deinit();
        }
    }
};

pub const SendQueue = struct {
    queue: std.ArrayList(SendHandle),
    waiting_for_ack: ?SendHandle = null,

    retry_count: u32 = 0,
    keep_alive: bun.Async.KeepAlive = .{},
    has_written_version: if (Environment.allow_assert) u1 else u0 = 0,
    mode: Mode,
    internal_msg_queue: node_cluster_binding.InternalMsgHolder = .{},
    incoming: bun.ByteList = .{}, // Maybe we should use StreamBuffer here as well
    incoming_fd: ?bun.FileDescriptor = null,

    socket: union(enum) {
        uninitialized,
        open: SocketType,
        closed,
    } = .uninitialized,

    pub fn init(mode: Mode) @This() {
        return .{ .queue = .init(bun.debug_allocator), .mode = mode };
    }
    pub fn deinit(self: *@This()) void {
        // must go first
        self.closeSocket(.failure);

        for (self.queue.items) |*item| item.deinit();
        self.queue.deinit();
        self.keep_alive.disable();
        self.internal_msg_queue.deinit();
        self.incoming.deinitWithAllocator(bun.debug_allocator);
        if (self.waiting_for_ack) |*waiting| waiting.deinit();
    }

    fn closeSocket(this: *SendQueue, reason: SocketType.CloseReason) void {
        switch (this.socket) {
            .open => |s| s.close(reason),
            else => {},
        }
        this.socket = .closed;
    }

    /// returned pointer is invalidated if the queue is modified
    pub fn startMessage(self: *SendQueue, global: *JSC.JSGlobalObject, callback: JSC.JSValue, handle: ?Handle) *SendHandle {
        if (Environment.allow_assert) bun.debugAssert(self.has_written_version == 1);

        // optimal case: appending a message without a handle to the end of the queue when the last message also doesn't have a handle and isn't ack/nack
        // this is rare. it will only happen if messages stack up after sending a handle, or if a long message is sent that is waiting for writable
        if (handle == null and self.queue.items.len > 0) {
            const last = &self.queue.items[self.queue.items.len - 1];
            if (last.handle == null and !last.isAckNack()) {
                if (callback.isFunction()) {
                    // must append the callback to the end of the array if it exists
                    if (last.callback.isUndefinedOrNull()) {
                        // no previous callback; set it directly
                        callback.protect(); // callback is now owned by the queue
                        last.callback = callback;
                    } else if (last.callback.isArray()) {
                        // previous callback was already array; append to array
                        last.callback.push(global, callback); // no need to protect because the callback is in the protect()ed array
                    } else if (last.callback.isFunction()) {
                        // previous callback was a function; convert it to an array. protect the array and unprotect the old callback. don't protect the new callback.
                        // the array is owned by the queue and will be unprotected on deinit.
                        const arr = JSC.JSValue.createEmptyArray(global, 2);
                        arr.protect(); // owned by the queue
                        arr.putIndex(global, 0, last.callback); // add the old callback to the array
                        arr.putIndex(global, 1, callback); // add the new callback to the array
                        last.callback.unprotect(); // owned by the array now
                        last.callback = arr;
                    }
                }
                // caller can append now
                return last;
            }
        }

        // fallback case: append a new message to the queue
        callback.protect(); // now it is owned by the queue and will be unprotected on deinit.
        self.queue.append(.{ .handle = handle, .callback = callback }) catch bun.outOfMemory();
        return &self.queue.items[0];
    }
    /// returned pointer is invalidated if the queue is modified
    pub fn insertMessage(this: *SendQueue, message: SendHandle) void {
        if (Environment.allow_assert) bun.debugAssert(this.has_written_version == 1);
        if (this.queue.items.len == 0 or this.queue.items[0].data.cursor == 0) {
            // prepend (we have not started sending the next message yet because we are waiting for the ack/nack)
            this.queue.insert(0, message) catch bun.outOfMemory();
        } else {
            // insert at index 1 (we are in the middle of sending an ack/nack to the other process)
            bun.debugAssert(this.queue.items[0].isAckNack());
            this.queue.insert(1, message) catch bun.outOfMemory();
        }
    }

    pub fn onAckNack(this: *SendQueue, global: *JSGlobalObject, ack_nack: enum { ack, nack }) void {
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
                this.insertMessage(item.*);
                this.waiting_for_ack = null;
                return this.continueSend(global, .new_message_appended);
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
        item.complete(global); // call the callback & deinit
        this.waiting_for_ack = null;
        this.continueSend(global, .new_message_appended);
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
    fn _continueSend(this: *SendQueue, global: *JSC.JSGlobalObject, reason: ContinueSendReason) void {
        this.debugLogMessageQueue();
        log("IPC continueSend: {s}", .{@tagName(reason)});
        const socket = switch (this.socket) {
            .open => |s| s,
            else => return, // socket closed
        };

        if (this.queue.items.len == 0) {
            return; // nothing to send
        }

        const first = &this.queue.items[0];
        if (this.waiting_for_ack != null and !first.isAckNack()) {
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
            // item's length is 0, remove it and continue sending. this should rarely (never?) happen.
            var itm = this.queue.orderedRemove(0);
            itm.complete(global); // call the callback & deinit
            return _continueSend(this, global, reason);
        }
        log("sending ipc message: '{'}' (has_handle={})", .{ std.zig.fmtEscapes(to_send), first.handle != null });
        const n = if (first.handle) |handle| socket.writeFd(to_send, handle.fd) else socket.write(to_send);
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
                return _continueSend(this, global, reason); // in case the next item is an ack/nack waiting to be sent
            } else {
                // the message was fully sent, but there may be more items in the queue.
                // shift the queue and try to send the next item immediately.
                var item = this.queue.orderedRemove(0);
                item.complete(global); // call the callback & deinit
                return _continueSend(this, global, reason);
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
    fn continueSend(this: *SendQueue, global: *JSGlobalObject, reason: ContinueSendReason) void {
        this._continueSend(global, reason);
        this.updateRef(global);
    }
    pub fn writeVersionPacket(this: *SendQueue, global: *JSGlobalObject) void {
        bun.debugAssert(this.has_written_version == 0);
        bun.debugAssert(this.queue.items.len == 0);
        bun.debugAssert(this.waiting_for_ack == null);
        const bytes = getVersionPacket(this.mode);
        if (bytes.len > 0) {
            this.queue.append(.{ .handle = null, .callback = .null }) catch bun.outOfMemory();
            this.queue.items[this.queue.items.len - 1].data.write(bytes) catch bun.outOfMemory();
            this.continueSend(global, .new_message_appended);
        }
        if (Environment.allow_assert) this.has_written_version = 1;
    }
    pub fn serializeAndSend(self: *SendQueue, global: *JSGlobalObject, value: JSValue, is_internal: IsInternal, callback: JSC.JSValue, handle: ?Handle) SerializeAndSendResult {
        const indicate_backoff = self.waiting_for_ack != null and self.queue.items.len > 0;
        const msg = self.startMessage(global, callback, handle);
        const start_offset = msg.data.list.items.len;

        const payload_length = serialize(self.mode, &msg.data, global, value, is_internal) catch return .failure;
        bun.assert(msg.data.list.items.len == start_offset + payload_length);
        log("enqueueing ipc message: '{'}'", .{std.zig.fmtEscapes(msg.data.list.items[start_offset..])});

        self.continueSend(global, .new_message_appended);

        if (indicate_backoff) return .backoff;
        return .success;
    }
    fn debugLogMessageQueue(this: *SendQueue) void {
        if (!Environment.isDebug) return;
        log("IPC message queue ({d} items)", .{this.queue.items.len});
        for (this.queue.items) |item| {
            log("  '{'}'|'{'}'", .{ std.zig.fmtEscapes(item.data.list.items[0..item.data.cursor]), std.zig.fmtEscapes(item.data.list.items[item.data.cursor..]) });
        }
    }
};
const WindowsSocketType = bun.io.StreamingWriter(NamedPipeIPCData, .{
    .onWrite = NamedPipeIPCData.onWrite,
    .onError = NamedPipeIPCData.onError,
    .onWritable = null,
    .onClose = NamedPipeIPCData.onPipeClose,
});
const SocketType = struct {
    const Backing = switch (Environment.isWindows) {
        true => *WindowsSocketType,
        false => Socket,
    };
    backing: Backing,
    pub fn wrap(backing: Backing) @This() {
        return .{ .backing = backing };
    }
    const CloseReason = enum { normal, failure };
    fn close(this: @This(), reason: CloseReason) void {
        switch (Environment.isWindows) {
            true => @compileError("Not implemented"),
            false => this.backing.close(switch (reason) {
                .normal => .normal,
                .failure => .failure,
            }),
        }
    }
    fn writeFd(this: @This(), data: []const u8, fd: bun.FileDescriptor) i32 {
        return switch (Environment.isWindows) {
            true => {
                // TODO: implement writeFd on Windows
                this.backing.outgoing.write(data) catch bun.outOfMemory();
                return @intCast(data.len);
            },
            false => this.backing.writeFd(data, fd),
        };
    }
    fn write(this: @This(), data: []const u8) i32 {
        return switch (Environment.isWindows) {
            true => {
                const prev_len = this.backing.outgoing.list.items.len;
                this.backing.outgoing.write(data) catch bun.outOfMemory();
                if (prev_len == 0) {
                    _ = this.backing.flush();
                }
                return @intCast(data.len);
            },
            false => this.backing.write(data, false),
        };
    }
};
const MAX_HANDLE_RETRANSMISSIONS = 3;

/// Used on POSIX
const SocketIPCData = struct {
    send_queue: SendQueue,
    is_server: bool = false,
    close_next_tick: ?JSC.Task = null,

    pub fn deinit(ipc_data: *SocketIPCData) void {
        // ipc_data.socket is already freed when this is called
        ipc_data.send_queue.deinit();

        // if there is a close next tick task, cancel it so it doesn't get called and then UAF
        if (ipc_data.close_next_tick) |close_next_tick_task| {
            const managed: *bun.JSC.ManagedTask = close_next_tick_task.as(bun.JSC.ManagedTask);
            managed.cancel();
        }
    }

    pub fn close(this: *SocketIPCData, nextTick: bool) void {
        log("SocketIPCData#close", .{});
        if (this.send_queue.socket != .open) {
            this.send_queue.socket = .closed;
            return;
        }
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
        if (this.send_queue.socket != .open) {
            this.send_queue.socket = .closed;
            return;
        }
        this.send_queue.socket.open.close(.normal);
        this.send_queue.socket = .closed;
    }
};

/// Used on Windows
const NamedPipeIPCData = struct {
    const uv = bun.windows.libuv;

    send_queue: SendQueue,

    // we will use writer pipe as Duplex
    writer: WindowsSocketType = .{},

    disconnected: bool = false,
    is_server: bool = false,
    connect_req: uv.uv_connect_t = std.mem.zeroes(uv.uv_connect_t),
    onClose: ?CloseHandler = null,

    const CloseHandler = struct {
        callback: *const fn (*anyopaque) void,
        context: *anyopaque,
    };

    pub fn deinit(this: *NamedPipeIPCData) void {
        log("deinit", .{});
        this.writer.deinit();
        this.send_queue.deinit();
    }

    fn onServerPipeClose(this: *uv.Pipe) callconv(.C) void {
        // safely free the pipes
        bun.debug_allocator.destroy(this);
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
        defer bun.debug_allocator.destroy(source.pipe);
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
            // our own deinit will be called by the handler
        }
    }

    pub fn writeVersionPacket(this: *NamedPipeIPCData, global: *JSC.JSGlobalObject) void {
        this.send_queue.writeVersionPacket(global, .wrap(&this.writer));
    }

    pub fn serializeAndSend(this: *NamedPipeIPCData, global: *JSGlobalObject, value: JSValue, is_internal: IsInternal, callback: JSC.JSValue, handle: ?Handle) SerializeAndSendResult {
        if (this.disconnected) {
            return .failure;
        }
        // ref because we have pending data
        this.writer.source.?.pipe.ref();
        return this.send_queue.serializeAndSend(global, value, is_internal, callback, handle, .wrap(&this.writer));
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
            return JSC.Maybe(void).errno(bun.sys.E.PIPE, .pipe);
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
        const ipc_pipe = bun.debug_allocator.create(uv.Pipe) catch bun.outOfMemory();
        ipc_pipe.init(uv.Loop.get(), true).unwrap() catch |err| {
            bun.debug_allocator.destroy(ipc_pipe);
            return err;
        };
        ipc_pipe.open(pipe_fd).unwrap() catch |err| {
            bun.debug_allocator.destroy(ipc_pipe);
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
};

fn emitProcessErrorEvent(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const ex = callframe.argumentsAsArray(1)[0];
    JSC.VirtualMachine.Process__emitErrorEvent(globalThis, ex);
    return .undefined;
}
const FromEnum = enum { subprocess_exited, subprocess, process };
fn doSendErr(globalObject: *JSC.JSGlobalObject, callback: JSC.JSValue, ex: JSC.JSValue, from: FromEnum) bun.JSError!JSC.JSValue {
    if (callback.isFunction()) {
        callback.callNextTick(globalObject, .{ex});
        return .false;
    }
    if (from == .process) {
        const target = JSC.JSFunction.create(globalObject, "", emitProcessErrorEvent, 1, .{});
        target.callNextTick(globalObject, .{ex});
        return .false;
    }
    // Bun.spawn().send() should throw an error (unless callback is passed)
    return globalObject.throwValue(ex);
}
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
        const ex = globalObject.ERR(.IPC_CHANNEL_CLOSED, "{s}", .{@as([]const u8, switch (from) {
            .process => "process.send() can only be used if the IPC channel is open.",
            .subprocess => "Subprocess.send() can only be used if an IPC channel is open.",
            .subprocess_exited => "Subprocess.send() cannot be used after the process has exited.",
        })}).toJS();
        return doSendErr(globalObject, callback, ex, from);
    };

    if (message.isUndefined()) {
        return globalObject.throwMissingArgumentsValue(&.{"message"});
    }
    if (!message.isString() and !message.isObject() and !message.isNumber() and !message.isBoolean() and !message.isNull()) {
        return globalObject.throwInvalidArgumentTypeValueOneOf("message", "string, object, number, or boolean", message);
    }

    if (!handle.isUndefinedOrNull()) {
        const serialized_array: JSC.JSValue = try ipcSerialize(globalObject, message, handle);
        if (serialized_array.isUndefinedOrNull()) {
            handle = .undefined;
        } else {
            const serialized_handle = serialized_array.getIndex(globalObject, 0);
            const serialized_message = serialized_array.getIndex(globalObject, 1);
            handle = serialized_handle;
            message = serialized_message;
        }
    }

    var zig_handle: ?Handle = null;
    if (!handle.isUndefinedOrNull()) {
        if (bun.JSC.API.Listener.fromJS(handle)) |listener| {
            log("got listener", .{});
            switch (listener.listener) {
                .uws => |socket_uws| {
                    // may need to handle ssl case
                    const fd = socket_uws.getSocket().getFd();
                    zig_handle = .init(fd, handle);
                },
                .namedPipe => |namedPipe| {
                    _ = namedPipe;
                },
                .none => {},
            }
        } else {
            //
        }
    }

    const status = ipc_data.send_queue.serializeAndSend(globalObject, message, .external, callback, zig_handle);

    if (status == .failure) {
        const ex = globalObject.createTypeErrorInstance("process.send() failed", .{});
        ex.put(globalObject, JSC.ZigString.static("syscall"), bun.String.static("write").toJS(globalObject));
        return doSendErr(globalObject, callback, ex, from);
    }

    // in the success or backoff case, serializeAndSend will handle calling the callback
    return if (status == .success) .true else .false;
}

pub const IPCData = if (Environment.isWindows) NamedPipeIPCData else SocketIPCData;

pub fn emitHandleIPCMessage(globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const target, const message, const handle = callframe.argumentsAsArray(3);
    if (target.isNull()) {
        const ipc = globalThis.bunVM().getIPCInstance() orelse return .undefined;
        ipc.handleIPCMessage(.{ .data = message }, handle);
    } else {
        if (!target.isCell()) return .undefined;
        const subprocess = bun.JSC.Subprocess.fromJSDirect(target) orelse return .undefined;
        subprocess.handleIPCMessage(.{ .data = message }, handle);
    }
    return .undefined;
}

const IPCCommand = union(enum) {
    handle: JSC.JSValue,
    ack,
    nack,
};

fn handleIPCMessage(comptime Context: type, this: *Context, message: DecodedIPCMessage, globalThis: *JSC.JSGlobalObject) void {
    const ipc: *IPCData = this.ipc() orelse return;
    if (Environment.isDebug) {
        var formatter = JSC.ConsoleObject.Formatter{ .globalThis = globalThis };
        defer formatter.deinit();
        switch (message) {
            .version => |version| log("received ipc message: version: {}", .{version}),
            .data => |jsvalue| log("received ipc message: {}", .{jsvalue.toFmt(&formatter)}),
            .internal => |jsvalue| log("received ipc message: internal: {}", .{jsvalue.toFmt(&formatter)}),
        }
    }
    var internal_command: ?IPCCommand = null;
    if (message == .data) handle_message: {
        // TODO: get property 'cmd' from the message, read as a string
        // to skip this property lookup (and simplify the code significantly)
        // we could make three new message types:
        // - data_with_handle
        // - ack
        // - nack
        // This would make the IPC not interoperable with node
        // - advanced ipc already is completely different in bun. bun uses
        // - json ipc is the same as node in bun
        const msg_data = message.data;
        if (msg_data.isObject()) {
            const cmd = msg_data.fastGet(globalThis, .cmd) orelse {
                if (globalThis.hasException()) _ = globalThis.takeException(bun.JSError.JSError);
                break :handle_message;
            };
            if (cmd.isString()) {
                if (!cmd.isCell()) break :handle_message;
                const cmd_str = bun.String.fromJS(cmd, globalThis) catch |e| {
                    _ = globalThis.takeException(e);
                    break :handle_message;
                };
                if (cmd_str.eqlComptime("NODE_HANDLE")) {
                    internal_command = .{ .handle = msg_data };
                } else if (cmd_str.eqlComptime("NODE_HANDLE_ACK")) {
                    internal_command = .ack;
                } else if (cmd_str.eqlComptime("NODE_HANDLE_NACK")) {
                    internal_command = .nack;
                }
            }
        }
    }

    if (internal_command) |icmd| {
        switch (icmd) {
            .handle => |msg_data| {
                // Handle NODE_HANDLE message
                const ack = ipc.send_queue.incoming_fd != null;

                const packet = if (ack) getAckPacket(ipc.send_queue.mode) else getNackPacket(ipc.send_queue.mode);
                var handle = SendHandle{ .data = .{}, .handle = null, .callback = .zero };
                handle.data.write(packet) catch bun.outOfMemory();

                // Insert at appropriate position in send queue
                ipc.send_queue.insertMessage(handle);

                // Send if needed
                ipc.send_queue.continueSend(globalThis, .new_message_appended);

                if (!ack) return;

                // Get file descriptor and clear it
                const fd = ipc.send_queue.incoming_fd.?;
                ipc.send_queue.incoming_fd = null;

                const target: bun.JSC.JSValue = switch (Context) {
                    bun.JSC.Subprocess => @as(*bun.JSC.Subprocess, this).this_jsvalue,
                    bun.JSC.VirtualMachine.IPCInstance => bun.JSC.JSValue.null,
                    else => @compileError("Unsupported context type: " ++ @typeName(Context)),
                };

                const vm = globalThis.bunVM();
                vm.eventLoop().enter();
                defer vm.eventLoop().exit();
                _ = ipcParse(globalThis, target, msg_data, fd.toJS(globalThis)) catch |e| {
                    // ack written already, that's okay.
                    globalThis.reportActiveExceptionAsUnhandled(e);
                    return;
                };

                // ipc_parse will call the callback which calls handleIPCMessage()
                // we have sent the ack already so the next message could arrive at any time. maybe even before
                // parseHandle calls emit(). however, node does this too and its messages don't end up out of order.
                // so hopefully ours won't either.
                return;
            },
            .ack => {
                ipc.send_queue.onAckNack(globalThis, .ack);
                return;
            },
            .nack => {
                ipc.send_queue.onAckNack(globalThis, .nack);
                return;
            },
        }
    } else {
        this.handleIPCMessage(message, .undefined);
    }
}

fn onData2(comptime Context: type, this: *Context, all_data: []const u8) void {
    var data = all_data;
    const ipc: *IPCData = this.ipc() orelse return;
    log("onData '{'}'", .{std.zig.fmtEscapes(data)});

    // In the VirtualMachine case, `globalThis` is an optional, in case
    // the vm is freed before the socket closes.
    const globalThisOptional: ?*JSC.JSGlobalObject = this.globalThis;
    const globalThis = globalThisOptional orelse {
        this.handleIPCClose();
        ipc.send_queue.closeSocket(.failure);
        return;
    };

    // Decode the message with just the temporary buffer, and if that
    // fails (not enough bytes) then we allocate to .ipc_buffer
    if (ipc.send_queue.incoming.len == 0) {
        while (true) {
            const result = decodeIPCMessage(ipc.send_queue.mode, data, globalThis) catch |e| switch (e) {
                error.NotEnoughBytes => {
                    _ = ipc.send_queue.incoming.write(bun.debug_allocator, data) catch bun.outOfMemory();
                    log("hit NotEnoughBytes", .{});
                    return;
                },
                error.InvalidFormat => {
                    ipc.send_queue.closeSocket(.failure);
                    return;
                },
                error.OutOfMemory => {
                    Output.printErrorln("IPC message is too long.", .{});
                    this.handleIPCClose();
                    ipc.send_queue.closeSocket(.failure);
                    return;
                },
            };

            handleIPCMessage(Context, this, result.message, globalThis);

            if (result.bytes_consumed < data.len) {
                data = data[result.bytes_consumed..];
            } else {
                return;
            }
        }
    }

    _ = ipc.send_queue.incoming.write(bun.debug_allocator, data) catch bun.outOfMemory();

    var slice = ipc.send_queue.incoming.slice();
    while (true) {
        const result = decodeIPCMessage(ipc.send_queue.mode, slice, globalThis) catch |e| switch (e) {
            error.NotEnoughBytes => {
                // copy the remaining bytes to the start of the buffer
                bun.copy(u8, ipc.send_queue.incoming.ptr[0..slice.len], slice);
                ipc.send_queue.incoming.len = @truncate(slice.len);
                log("hit NotEnoughBytes2", .{});
                return;
            },
            error.InvalidFormat => {
                ipc.send_queue.closeSocket(.failure);
                return;
            },
            error.OutOfMemory => {
                Output.printErrorln("IPC message is too long.", .{});
                this.handleIPCClose();
                ipc.send_queue.closeSocket(.failure);
                return;
            },
        };

        handleIPCMessage(Context, this, result.message, globalThis);

        if (result.bytes_consumed < slice.len) {
            slice = slice[result.bytes_consumed..];
        } else {
            // clear the buffer
            ipc.send_queue.incoming.len = 0;
            return;
        }
    }
}

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
            // uSockets has already freed the underlying socket
            log("onClose", .{});
            const ipc: *SocketIPCData = this.ipc() orelse return;
            ipc.send_queue.socket = .closed;
            log("NewSocketIPCHandler#onClose\n", .{});

            // call an onClose handler if there is one
            this.handleIPCClose();
        }

        pub fn onData(
            this: *Context,
            _: Socket,
            all_data: []const u8,
        ) void {
            onData2(Context, this, all_data);
        }

        pub fn onFd(
            this: *Context,
            _: Socket,
            fd: c_int,
        ) void {
            const ipc: *IPCData = this.ipc() orelse return;
            log("onFd: {d}", .{fd});
            if (ipc.send_queue.incoming_fd != null) {
                log("onFd: incoming_fd already set; overwriting", .{});
            }
            ipc.send_queue.incoming_fd = bun.FD.fromNative(fd);
        }

        pub fn onWritable(
            context: *Context,
            _: Socket,
        ) void {
            log("onWritable", .{});
            const ipc: *IPCData = context.ipc() orelse return;
            ipc.send_queue.continueSend(context.getGlobalThis() orelse return, .on_writable);
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
            var available = ipc.send_queue.incoming.available();
            if (available.len < suggested_size) {
                ipc.send_queue.incoming.ensureUnusedCapacity(bun.debug_allocator, suggested_size) catch bun.outOfMemory();
                available = ipc.send_queue.incoming.available();
            }
            log("NewNamedPipeIPCHandler#onReadAlloc {d}", .{suggested_size});
            return available.ptr[0..suggested_size];
        }

        fn onReadError(this: *Context, err: bun.sys.E) void {
            log("NewNamedPipeIPCHandler#onReadError {}", .{err});
            if (this.ipc()) |ipc_data| {
                ipc_data.close(true);
            }
        }

        fn onRead(this: *Context, buffer: []const u8) void {
            const ipc = this.ipc() orelse return;

            log("NewNamedPipeIPCHandler#onRead {d}", .{buffer.len});
            ipc.send_queue.incoming.len += @as(u32, @truncate(buffer.len));
            var slice = ipc.send_queue.incoming.slice();

            bun.assert(ipc.send_queue.incoming.len <= ipc.send_queue.incoming.cap);
            bun.assert(bun.isSliceInBuffer(buffer, ipc.send_queue.incoming.allocatedSlice()));

            const globalThis = switch (@typeInfo(@TypeOf(this.globalThis))) {
                .pointer => this.globalThis,
                .optional => brk: {
                    if (this.globalThis) |global| {
                        break :brk global;
                    }
                    ipc.close(true);
                    return;
                },
                else => @compileError("Unexpected globalThis type: " ++ @typeName(@TypeOf(this.globalThis))),
            };
            while (true) {
                const result = decodeIPCMessage(ipc.send_queue.mode, slice, globalThis) catch |e| switch (e) {
                    error.NotEnoughBytes => {
                        // copy the remaining bytes to the start of the buffer
                        bun.copy(u8, ipc.send_queue.incoming.ptr[0..slice.len], slice);
                        ipc.send_queue.incoming.len = @truncate(slice.len);
                        log("hit NotEnoughBytes3", .{});
                        return;
                    },
                    error.InvalidFormat => {
                        ipc.close(false);
                        return;
                    },
                    error.OutOfMemory => {
                        Output.printErrorln("IPC message is too long.", .{});
                        ipc.close(false);
                        return;
                    },
                };

                handleIPCMessage(Context, this, result.message, .wrap(&ipc.writer), globalThis);

                if (result.bytes_consumed < slice.len) {
                    slice = slice[result.bytes_consumed..];
                } else {
                    // clear the buffer
                    ipc.send_queue.incoming.len = 0;
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

extern "C" fn IPCSerialize(globalObject: *JSC.JSGlobalObject, message: JSC.JSValue, handle: JSC.JSValue) JSC.JSValue;

pub fn ipcSerialize(globalObject: *JSC.JSGlobalObject, message: JSC.JSValue, handle: JSC.JSValue) bun.JSError!JSC.JSValue {
    const result = IPCSerialize(globalObject, message, handle);
    if (result == .zero) return error.JSError;
    return result;
}

extern "C" fn IPCParse(globalObject: *JSC.JSGlobalObject, target: JSC.JSValue, serialized: JSC.JSValue, fd: JSC.JSValue) JSC.JSValue;

pub fn ipcParse(globalObject: *JSC.JSGlobalObject, target: JSC.JSValue, serialized: JSC.JSValue, fd: JSC.JSValue) bun.JSError!JSC.JSValue {
    const result = IPCParse(globalObject, target, serialized, fd);
    if (result == .zero) return error.JSError;
    return result;
}
