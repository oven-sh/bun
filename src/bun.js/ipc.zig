pub const log = Output.scoped(.IPC, .visible);

/// Union type that switches between simple ByteList (for advanced mode)
/// and JSONLineBuffer (for JSON mode with optimized newline tracking).
const IncomingBuffer = union(enum) {
    /// For advanced mode - uses length-prefix, no scanning needed
    advanced: bun.ByteList,
    /// For JSON mode - tracks newline positions to avoid O(n²) scanning
    json: JSONLineBuffer,

    pub fn init(mode: Mode) IncomingBuffer {
        return switch (mode) {
            .advanced => .{ .advanced = .{} },
            .json => .{ .json = .{} },
        };
    }

    pub fn deinit(self: *@This()) void {
        switch (self.*) {
            .advanced => |*b| b.deinit(bun.default_allocator),
            .json => |*b| b.deinit(),
        }
    }
};

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
} || bun.JSError;

pub const IPCSerializationError = error{
    /// Value could not be serialized.
    SerializationFailed,
} || bun.JSError;

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

    pub fn decodeIPCMessage(data: []const u8, global: *jsc.JSGlobalObject) IPCDecodeError!DecodeIPCMessageResult {
        if (data.len < header_length) {
            log("Not enough bytes to decode IPC message header, have {d} bytes", .{data.len});
            return IPCDecodeError.NotEnoughBytes;
        }

        const message_type: IPCMessageType = @enumFromInt(data[0]);
        const message_len = std.mem.readInt(u32, data[1 .. @sizeOf(u32) + 1], .little);

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
                const deserialized = try JSValue.deserialize(message, global);

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

    pub fn serialize(writer: *bun.io.StreamBuffer, global: *jsc.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
        const serialized = try value.serialize(global, .{
            // IPC sends across process.
            .forCrossProcessTransfer = true,

            .forStorage = false,
        });
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
    fn jsonIPCDataStringFreeCB(context: *bool, _: *anyopaque, _: u32) callconv(.c) void {
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

    pub fn decodeIPCMessage(data: []const u8, globalThis: *jsc.JSGlobalObject, known_newline: ?u32) IPCDecodeError!DecodeIPCMessageResult {
        // <tag>{ "foo": "bar"} // tag is 1 or 2
        const idx: u32 = known_newline orelse idx: {
            const found = bun.strings.indexOfChar(data, '\n') orelse
                return IPCDecodeError.NotEnoughBytes;
            // Individual IPC messages should not exceed 4GB, and idx+1 must not overflow
            if (found >= std.math.maxInt(u32)) return IPCDecodeError.InvalidFormat;
            break :idx @intCast(found);
        };

        var json_data = data[0..idx];
        // An empty payload (newline with no preceding data) is invalid JSON.
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
        } else bun.String.borrowUTF8(json_data);

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
            error.JSTerminated => {
                globalThis.clearException();
                return IPCDecodeError.InvalidFormat;
            },
            error.OutOfMemory => return bun.outOfMemory(),
        };

        return switch (kind) {
            .regular => .{
                .bytes_consumed = @intCast(idx + 1),
                .message = .{ .data = deserialized },
            },
            .internal => .{
                .bytes_consumed = @intCast(idx + 1),
                .message = .{ .internal = deserialized },
            },
        };
    }

    pub fn serialize(writer: *bun.io.StreamBuffer, global: *jsc.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
        var out: bun.String = undefined;
        // Use jsonStringifyFast which passes undefined for the space parameter,
        // triggering JSC's SIMD-optimized FastStringifier code path.
        try value.jsonStringifyFast(global, &out);
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
/// For JSON mode, `known_newline` can be provided to avoid re-scanning for the newline delimiter.
pub fn decodeIPCMessage(mode: Mode, data: []const u8, global: *jsc.JSGlobalObject, known_newline: ?u32) IPCDecodeError!DecodeIPCMessageResult {
    return switch (mode) {
        .advanced => advanced.decodeIPCMessage(data, global),
        .json => json.decodeIPCMessage(data, global, known_newline),
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
pub fn serialize(mode: Mode, writer: *bun.io.StreamBuffer, global: *jsc.JSGlobalObject, value: JSValue, is_internal: IsInternal) !usize {
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
    js: jsc.JSValue,
    pub fn init(fd: bun.FileDescriptor, js: jsc.JSValue) @This() {
        js.protect();
        return .{ .fd = fd, .js = js };
    }
    fn deinit(self: *Handle) void {
        self.js.unprotect();
    }
};
pub const CallbackList = union(enum) {
    ack_nack,
    none,
    /// js callable
    callback: jsc.JSValue,
    /// js array
    callback_array: jsc.JSValue,

    /// protects the callback
    pub fn init(callback: jsc.JSValue) @This() {
        if (callback.isCallable()) {
            callback.protect();
            return .{ .callback = callback };
        }
        return .none;
    }

    /// protects the callback
    pub fn push(self: *@This(), callback: jsc.JSValue, global: *jsc.JSGlobalObject) bun.JSError!void {
        switch (self.*) {
            .ack_nack => unreachable,
            .none => {
                callback.protect();
                self.* = .{ .callback = callback };
            },
            .callback => {
                const prev = self.callback;
                const arr = try jsc.JSValue.createEmptyArray(global, 2);
                arr.protect();
                try arr.putIndex(global, 0, prev); // add the old callback to the array
                try arr.putIndex(global, 1, callback); // add the new callback to the array
                prev.unprotect(); // owned by the array now
                self.* = .{ .callback_array = arr };
            },
            .callback_array => |arr| {
                try arr.push(global, callback);
            },
        }
    }
    fn callNextTick(self: *@This(), global: *jsc.JSGlobalObject) bun.JSError!void {
        switch (self.*) {
            .ack_nack => {},
            .none => {},
            .callback => {
                try self.callback.callNextTick(global, .{.null});
                self.callback.unprotect();
                self.* = .none;
            },
            .callback_array => {
                var iter = try self.callback_array.arrayIterator(global);
                while (try iter.next()) |item| {
                    try item.callNextTick(global, .{.null});
                }
                self.callback_array.unprotect();
                self.* = .none;
            },
        }
    }
    pub fn deinit(self: *@This()) void {
        switch (self.*) {
            .ack_nack => {},
            .none => {},
            .callback => self.callback.unprotect(),
            .callback_array => self.callback_array.unprotect(),
        }
        self.* = .none;
    }
};
pub const SendHandle = struct {
    // when a message has a handle, make sure it has a new SendHandle - so that if we retry sending it,
    // we only retry sending the message with the handle, not the original message.
    data: bun.io.StreamBuffer = .{},
    /// keep sending the handle until data is drained (assume it hasn't sent until data is fully drained)
    handle: ?Handle,
    callbacks: CallbackList,

    pub fn isAckNack(self: *SendHandle) bool {
        return self.callbacks == .ack_nack;
    }

    /// Call the callback and deinit
    pub fn complete(self: *SendHandle, global: *jsc.JSGlobalObject) void {
        defer self.deinit();
        self.callbacks.callNextTick(global) catch {}; // TODO: properly propagate exception upwards
    }
    pub fn deinit(self: *SendHandle) void {
        self.data.deinit();
        self.callbacks.deinit();
        if (self.handle) |*handle| {
            handle.deinit();
        }
    }
};

pub const WindowsWrite = struct {
    write_req: uv.uv_write_t = std.mem.zeroes(uv.uv_write_t),
    write_buffer: uv.uv_buf_t = uv.uv_buf_t.init(""),
    write_slice: []const u8,
    owner: ?*SendQueue,
    pub fn destroy(self: *WindowsWrite) void {
        bun.default_allocator.free(self.write_slice);
        bun.destroy(self);
    }
};
pub const SendQueue = struct {
    queue: std.array_list.Managed(SendHandle),
    waiting_for_ack: ?SendHandle = null,

    retry_count: u32 = 0,
    keep_alive: bun.Async.KeepAlive = .{},
    has_written_version: if (Environment.allow_assert) u1 else u0 = 0,
    mode: Mode,
    internal_msg_queue: node_cluster_binding.InternalMsgHolder = .{},
    incoming: IncomingBuffer,
    incoming_fd: ?bun.FileDescriptor = null,

    socket: SocketUnion,
    owner: SendQueueOwner,

    close_next_tick: ?jsc.Task = null,
    write_in_progress: bool = false,
    close_event_sent: bool = false,

    windows: switch (Environment.isWindows) {
        true => struct {
            is_server: bool = false,
            windows_write: ?*WindowsWrite = null,
            try_close_after_write: bool = false,
        },
        false => struct {},
    } = .{},

    pub const SendQueueOwner = union(enum) {
        subprocess: *bun.api.Subprocess,
        virtual_machine: *bun.jsc.VirtualMachine.IPCInstance,
    };
    pub const SocketType = switch (Environment.isWindows) {
        true => *uv.Pipe,
        false => Socket,
    };
    pub const SocketUnion = union(enum) {
        uninitialized,
        open: SocketType,
        closed,
    };

    pub fn init(mode: Mode, owner: SendQueueOwner, socket: SocketUnion) @This() {
        log("SendQueue#init", .{});
        return .{
            .queue = .init(bun.default_allocator),
            .mode = mode,
            .owner = owner,
            .socket = socket,
            .incoming = IncomingBuffer.init(mode),
        };
    }
    pub fn deinit(self: *@This()) void {
        log("SendQueue#deinit", .{});
        // must go first
        self.closeSocket(.failure, .deinit);

        for (self.queue.items) |*item| item.deinit();
        self.queue.deinit();
        self.internal_msg_queue.deinit();
        self.incoming.deinit();
        if (self.waiting_for_ack) |*waiting| waiting.deinit();

        // if there is a close next tick task, cancel it so it doesn't get called and then UAF
        if (self.close_next_tick) |close_next_tick_task| {
            const managed: *bun.jsc.ManagedTask = close_next_tick_task.as(bun.jsc.ManagedTask);
            managed.cancel();
        }
    }

    pub fn isConnected(this: *SendQueue) bool {
        if (Environment.isWindows and this.windows.try_close_after_write) return false;
        return this.socket == .open and this.close_next_tick == null;
    }

    fn closeSocket(this: *SendQueue, reason: enum { normal, failure }, from: enum { user, deinit }) void {
        log("SendQueue#closeSocket {s}", .{@tagName(from)});
        switch (this.socket) {
            .open => |s| switch (Environment.isWindows) {
                true => {
                    const pipe: *uv.Pipe = s;
                    const stream: *uv.uv_stream_t = pipe.asStream();
                    stream.readStop();

                    if (this.windows.windows_write != null and from != .deinit) {
                        log("SendQueue#closeSocket -> mark ready for close", .{});
                        // currently writing; wait for the write to complete
                        this.windows.try_close_after_write = true;
                    } else {
                        log("SendQueue#closeSocket -> close now", .{});
                        this._windowsClose();
                    }
                },
                false => {
                    s.close(switch (reason) {
                        .normal => .normal,
                        .failure => .failure,
                    });
                    this._socketClosed();
                },
            },
            else => {
                this._socketClosed();
            },
        }
    }
    fn _socketClosed(this: *SendQueue) void {
        log("SendQueue#_socketClosed", .{});
        if (Environment.isWindows) {
            if (this.windows.windows_write) |windows_write| {
                windows_write.owner = null; // so _windowsOnWriteComplete doesn't try to continue writing
            }
            this.windows.windows_write = null; // will be freed by _windowsOnWriteComplete
        }
        this.keep_alive.disable();
        this.socket = .closed;
        this.getGlobalThis().bunVM().enqueueTask(jsc.ManagedTask.New(SendQueue, _onAfterIPCClosed).init(this));
    }
    fn _windowsClose(this: *SendQueue) void {
        log("SendQueue#_windowsClose", .{});
        if (this.socket != .open) return;
        const pipe = this.socket.open;
        pipe.data = pipe;
        pipe.close(&_windowsOnClosed);
        this._socketClosed();
        this.getGlobalThis().bunVM().enqueueTask(jsc.ManagedTask.New(SendQueue, _onAfterIPCClosed).init(this));
    }
    fn _windowsOnClosed(windows: *uv.Pipe) callconv(.c) void {
        log("SendQueue#_windowsOnClosed", .{});
        bun.default_allocator.destroy(windows);
    }

    pub fn closeSocketNextTick(this: *SendQueue, nextTick: bool) void {
        log("SendQueue#closeSocketNextTick", .{});
        if (this.socket != .open) {
            this.socket = .closed;
            return;
        }
        if (this.close_next_tick != null) return; // close already requested
        if (!nextTick) {
            this.closeSocket(.normal, .user);
            return;
        }
        this.close_next_tick = jsc.ManagedTask.New(SendQueue, _closeSocketTask).init(this);
        jsc.VirtualMachine.get().enqueueTask(this.close_next_tick.?);
    }

    fn _closeSocketTask(this: *SendQueue) void {
        log("SendQueue#closeSocketTask", .{});
        bun.assert(this.close_next_tick != null);
        this.close_next_tick = null;
        this.closeSocket(.normal, .user);
    }

    fn _onAfterIPCClosed(this: *SendQueue) void {
        log("SendQueue#_onAfterIPCClosed", .{});
        if (this.close_event_sent) return;
        this.close_event_sent = true;
        switch (this.owner) {
            inline else => |owner| {
                owner.handleIPCClose();
            },
        }
    }

    /// returned pointer is invalidated if the queue is modified
    pub fn startMessage(self: *SendQueue, global: *jsc.JSGlobalObject, callback: jsc.JSValue, handle: ?Handle) bun.JSError!*SendHandle {
        log("SendQueue#startMessage", .{});
        if (Environment.allow_assert) bun.debugAssert(self.has_written_version == 1);

        // optimal case: appending a message without a handle to the end of the queue when the last message also doesn't have a handle and isn't ack/nack
        // this is rare. it will only happen if messages stack up after sending a handle, or if a long message is sent that is waiting for writable
        if (handle == null and self.queue.items.len > 0) {
            const last = &self.queue.items[self.queue.items.len - 1];
            if (last.handle == null and !last.isAckNack() and !(self.queue.items.len == 1 and self.write_in_progress)) {
                if (callback.isCallable()) {
                    try last.callbacks.push(callback, global);
                }
                // caller can append now
                return last;
            }
        }

        // fallback case: append a new message to the queue
        bun.handleOom(self.queue.append(.{ .handle = handle, .callbacks = .init(callback) }));
        return &self.queue.items[self.queue.items.len - 1];
    }
    /// returned pointer is invalidated if the queue is modified
    pub fn insertMessage(this: *SendQueue, message: SendHandle) void {
        log("SendQueue#insertMessage", .{});
        if (Environment.allow_assert) bun.debugAssert(this.has_written_version == 1);
        if ((this.queue.items.len == 0 or this.queue.items[0].data.cursor == 0) and !this.write_in_progress) {
            // prepend (we have not started sending the next message yet because we are waiting for the ack/nack)
            bun.handleOom(this.queue.insert(0, message));
        } else {
            // insert at index 1 (we are in the middle of sending a message to the other process)
            bun.debugAssert(this.queue.items[0].isAckNack());
            bun.handleOom(this.queue.insert(1, message));
        }
    }

    pub fn onAckNack(this: *SendQueue, global: *JSGlobalObject, ack_nack: enum { ack, nack }) void {
        log("SendQueue#onAckNack", .{});
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
                log("IPC call continueSend() from onAckNack retry", .{});
                return this.continueSend(global, .new_message_appended);
            }
            // too many retries; give up - emit warning if possible
            var warning = bun.String.static("Handle did not reach the receiving process correctly");
            var warning_name = bun.String.static("SentHandleNotReceivedWarning");
            if (warning.transferToJS(global)) |warning_js| {
                if (warning_name.transferToJS(global)) |warning_name_js| {
                    global.emitWarning(warning_js, warning_name_js, .js_undefined, .js_undefined) catch {};
                } else |_| {}
            } else |_| {}
            // (fall through to success code in order to consume the message and continue sending)
        }
        // consume the message and continue sending
        item.complete(global); // call the callback & deinit
        this.waiting_for_ack = null;
        log("IPC call continueSend() from onAckNack success", .{});
        this.continueSend(global, .new_message_appended);
    }
    fn shouldRef(this: *SendQueue) bool {
        if (this.waiting_for_ack != null) return true; // waiting to receive an ack/nack from the other side
        if (this.queue.items.len == 0) return false; // nothing to send
        const first = &this.queue.items[0];
        if (first.data.cursor > 0) return true; // send in progress, waiting on writable
        if (this.write_in_progress) return true; // send in progress (windows), waiting on writable
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
    fn continueSend(this: *SendQueue, global: *jsc.JSGlobalObject, reason: ContinueSendReason) void {
        log("IPC continueSend: {s}", .{@tagName(reason)});
        this.debugLogMessageQueue();
        defer this.updateRef(global);

        if (this.queue.items.len == 0) {
            return; // nothing to send
        }
        if (this.write_in_progress) {
            return; // write in progress
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
            log("IPC call continueSend() from empty item", .{});
            return continueSend(this, global, reason);
        }
        // log("sending ipc message: '{'}' (has_handle={})", .{ std.zig.fmtString(to_send), first.handle != null });
        bun.assert(!this.write_in_progress);
        this.write_in_progress = true;
        this._write(to_send, if (first.handle) |handle| handle.fd else null);
        // the write is queued. this._onWriteComplete() will be called when the write completes.
    }
    fn _onWriteComplete(this: *SendQueue, n: i32) void {
        log("SendQueue#_onWriteComplete {d}", .{n});
        this.debugLogMessageQueue();
        if (!this.write_in_progress or this.queue.items.len < 1) {
            bun.debugAssert(false);
            return;
        }
        this.write_in_progress = false;
        const globalThis = this.getGlobalThis();
        defer this.updateRef(globalThis);
        const first = &this.queue.items[0];
        const to_send = first.data.list.items[first.data.cursor..];
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
            } else {
                // the message was fully sent, but there may be more items in the queue.
                // shift the queue and try to send the next item immediately.
                var item = this.queue.orderedRemove(0);
                item.complete(globalThis); // call the callback & deinit
            }
            return continueSend(this, globalThis, .on_writable);
        } else if (n > 0 and n < @as(i32, @intCast(first.data.list.items.len))) {
            // the item was partially sent; update the cursor and wait for writable to send the rest
            // (if we tried to send a handle, a partial write means the handle wasn't sent yet.)
            first.data.cursor += @intCast(n);
            return;
        } else if (n == 0) {
            // no bytes written; wait for writable
            return;
        } else {
            // error. close socket.
            this.closeSocket(.failure, .deinit);
            return;
        }
    }
    pub fn writeVersionPacket(this: *SendQueue, global: *JSGlobalObject) void {
        log("SendQueue#writeVersionPacket", .{});
        bun.debugAssert(this.has_written_version == 0);
        bun.debugAssert(this.queue.items.len == 0);
        bun.debugAssert(this.waiting_for_ack == null);
        const bytes = getVersionPacket(this.mode);
        if (bytes.len > 0) {
            bun.handleOom(this.queue.append(.{ .handle = null, .callbacks = .none }));
            bun.handleOom(this.queue.items[this.queue.items.len - 1].data.write(bytes));
            log("IPC call continueSend() from version packet", .{});
            this.continueSend(global, .new_message_appended);
        }
        if (Environment.allow_assert) this.has_written_version = 1;
    }
    pub fn serializeAndSend(self: *SendQueue, global: *JSGlobalObject, value: JSValue, is_internal: IsInternal, callback: jsc.JSValue, handle: ?Handle) SerializeAndSendResult {
        log("SendQueue#serializeAndSend", .{});
        const indicate_backoff = self.waiting_for_ack != null and self.queue.items.len > 0;
        const msg = self.startMessage(global, callback, handle) catch return .failure;
        const start_offset = msg.data.list.items.len;

        const payload_length = serialize(self.mode, &msg.data, global, value, is_internal) catch return .failure;
        bun.assert(msg.data.list.items.len == start_offset + payload_length);
        // log("enqueueing ipc message: '{'}'", .{std.zig.fmtString(msg.data.list.items[start_offset..])});

        log("IPC call continueSend() from serializeAndSend", .{});
        self.continueSend(global, .new_message_appended);

        if (indicate_backoff) return .backoff;
        return .success;
    }
    fn debugLogMessageQueue(this: *SendQueue) void {
        if (!Environment.isDebug) return;
        log("IPC message queue ({d} items)", .{this.queue.items.len});
        for (this.queue.items) |item| {
            if (item.data.list.items.len > 100) {
                log(" {d}|{d}", .{ item.data.cursor, item.data.list.items.len - item.data.cursor });
            } else {
                log("  \"{f}\"|\"{f}\"", .{ std.zig.fmtString(item.data.list.items[0..item.data.cursor]), std.zig.fmtString(item.data.list.items[item.data.cursor..]) });
            }
        }
    }

    fn getSocket(this: *SendQueue) ?SocketType {
        return switch (this.socket) {
            .open => |s| s,
            else => return null,
        };
    }

    /// starts a write request. on posix, this always calls _onWriteComplete immediately. on windows, it may
    /// call _onWriteComplete later.
    fn _write(this: *SendQueue, data: []const u8, fd: ?bun.FileDescriptor) void {
        log("SendQueue#_write len {d}", .{data.len});
        const socket = this.getSocket() orelse {
            this._onWriteComplete(-1);
            return;
        };
        return switch (Environment.isWindows) {
            true => {
                if (fd) |_| {
                    // TODO: send fd on windows
                }
                const pipe: *uv.Pipe = socket;
                const write_len = @min(data.len, std.math.maxInt(i32));

                // create write request
                const write_req_slice = bun.handleOom(bun.default_allocator.dupe(u8, data[0..write_len]));
                const write_req = bun.new(WindowsWrite, .{
                    .owner = this,
                    .write_slice = write_req_slice,
                    .write_req = std.mem.zeroes(uv.uv_write_t),
                    .write_buffer = uv.uv_buf_t.init(write_req_slice),
                });
                bun.assert(this.windows.windows_write == null);
                this.windows.windows_write = write_req;

                pipe.ref(); // ref on write
                if (this.windows.windows_write.?.write_req.write(pipe.asStream(), &this.windows.windows_write.?.write_buffer, write_req, &_windowsOnWriteComplete).asErr()) |err| {
                    _windowsOnWriteComplete(write_req, @enumFromInt(-@as(c_int, err.errno)));
                }
                // write request is queued. it will call _onWriteComplete when it completes.
            },
            false => {
                if (fd) |fd_unwrapped| {
                    this._onWriteComplete(socket.writeFd(data, fd_unwrapped));
                } else {
                    this._onWriteComplete(socket.write(data));
                }
            },
        };
    }
    fn _windowsOnWriteComplete(write_req: *WindowsWrite, status: uv.ReturnCode) void {
        log("SendQueue#_windowsOnWriteComplete", .{});
        const write_len = write_req.write_slice.len;
        const this = blk: {
            defer write_req.destroy();
            break :blk write_req.owner orelse return; // orelse case if disconnected before the write completes
        };

        const vm = jsc.VirtualMachine.get();
        vm.eventLoop().enter();
        defer vm.eventLoop().exit();

        this.windows.windows_write = null;
        if (this.getSocket()) |socket| socket.unref(); // write complete; unref
        if (status.toError(.write)) |_| {
            this._onWriteComplete(-1);
        } else {
            this._onWriteComplete(@intCast(write_len));
        }

        if (this.windows.try_close_after_write) {
            this.closeSocket(.normal, .user);
        }
    }
    fn getGlobalThis(this: *SendQueue) *jsc.JSGlobalObject {
        return switch (this.owner) {
            inline else => |owner| owner.globalThis,
        };
    }

    fn onServerPipeClose(this: *uv.Pipe) callconv(.c) void {
        // safely free the pipes
        bun.default_allocator.destroy(this);
    }

    pub fn windowsConfigureServer(this: *SendQueue, ipc_pipe: *uv.Pipe) bun.sys.Maybe(void) {
        log("configureServer", .{});
        ipc_pipe.data = this;
        ipc_pipe.unref();
        this.socket = .{ .open = ipc_pipe };
        this.windows.is_server = true;
        const pipe: *uv.Pipe = this.socket.open;
        pipe.data = this;

        const stream: *uv.uv_stream_t = pipe.asStream();

        const readStartResult = stream.readStart(this, IPCHandlers.WindowsNamedPipe.onReadAlloc, IPCHandlers.WindowsNamedPipe.onReadError, IPCHandlers.WindowsNamedPipe.onRead);
        if (readStartResult == .err) {
            this.closeSocket(.failure, .user);
            return readStartResult;
        }
        return .success;
    }

    pub fn windowsConfigureClient(this: *SendQueue, pipe_fd: bun.FileDescriptor) !void {
        log("configureClient", .{});
        const ipc_pipe = bun.handleOom(bun.default_allocator.create(uv.Pipe));
        ipc_pipe.init(uv.Loop.get(), true).unwrap() catch |err| {
            bun.default_allocator.destroy(ipc_pipe);
            return err;
        };
        ipc_pipe.open(pipe_fd).unwrap() catch |err| {
            bun.default_allocator.destroy(ipc_pipe);
            return err;
        };
        ipc_pipe.unref();
        this.socket = .{ .open = ipc_pipe };
        this.windows.is_server = false;

        const stream = ipc_pipe.asStream();

        stream.readStart(this, IPCHandlers.WindowsNamedPipe.onReadAlloc, IPCHandlers.WindowsNamedPipe.onReadError, IPCHandlers.WindowsNamedPipe.onRead).unwrap() catch |err| {
            this.closeSocket(.failure, .user);
            return err;
        };
    }
};
const MAX_HANDLE_RETRANSMISSIONS = 3;

fn emitProcessErrorEvent(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const ex = callframe.argumentsAsArray(1)[0];
    jsc.VirtualMachine.Process__emitErrorEvent(globalThis, ex);
    return .js_undefined;
}
const FromEnum = enum { subprocess_exited, subprocess, process };
fn doSendErr(globalObject: *jsc.JSGlobalObject, callback: jsc.JSValue, ex: jsc.JSValue, from: FromEnum) bun.JSError!jsc.JSValue {
    if (callback.isCallable()) {
        try callback.callNextTick(globalObject, .{ex});
        return .false;
    }
    if (from == .process) {
        const target = jsc.JSFunction.create(globalObject, bun.String.empty, emitProcessErrorEvent, 1, .{});
        try target.callNextTick(globalObject, .{ex});
        return .false;
    }
    // Bun.spawn().send() should throw an error (unless callback is passed)
    return globalObject.throwValue(ex);
}
pub fn doSend(ipc: ?*SendQueue, globalObject: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame, from: FromEnum) bun.JSError!JSValue {
    var message, var handle, var options_, var callback = callFrame.argumentsAsArray(4);

    if (handle.isCallable()) {
        callback = handle;
        handle = .js_undefined;
        options_ = .js_undefined;
    } else if (options_.isCallable()) {
        callback = options_;
        options_ = .js_undefined;
    } else if (!options_.isUndefined()) {
        try globalObject.validateObject("options", options_, .{});
    }

    const connected = ipc != null and ipc.?.isConnected();
    if (!connected) {
        const ex = globalObject.ERR(.IPC_CHANNEL_CLOSED, "{s}", .{@as([]const u8, switch (from) {
            .process => "process.send() can only be used if the IPC channel is open.",
            .subprocess => "Subprocess.send() can only be used if an IPC channel is open.",
            .subprocess_exited => "Subprocess.send() cannot be used after the process has exited.",
        })}).toJS();
        return doSendErr(globalObject, callback, ex, from);
    }

    const ipc_data = ipc.?;

    if (message.isUndefined()) {
        return globalObject.throwMissingArgumentsValue(&.{"message"});
    }
    if (!message.isString() and !message.isObject() and !message.isNumber() and !message.isBoolean() and !message.isNull()) {
        return globalObject.throwInvalidArgumentTypeValueOneOf("message", "string, object, number, or boolean", message);
    }

    if (!handle.isUndefinedOrNull()) {
        const serialized_array: jsc.JSValue = try ipcSerialize(globalObject, message, handle);
        if (serialized_array.isUndefinedOrNull()) {
            handle = .js_undefined;
        } else {
            const serialized_handle = try serialized_array.getIndex(globalObject, 0);
            const serialized_message = try serialized_array.getIndex(globalObject, 1);
            handle = serialized_handle;
            message = serialized_message;
        }
    }

    var zig_handle: ?Handle = null;
    if (!handle.isUndefinedOrNull()) {
        if (bun.jsc.API.Listener.fromJS(handle)) |listener| {
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

    const status = ipc_data.serializeAndSend(globalObject, message, .external, callback, zig_handle);

    if (status == .failure) {
        const ex = globalObject.createTypeErrorInstance("process.send() failed", .{});
        ex.put(globalObject, jsc.ZigString.static("syscall"), try bun.String.static("write").toJS(globalObject));
        return doSendErr(globalObject, callback, ex, from);
    }

    // in the success or backoff case, serializeAndSend will handle calling the callback
    return if (status == .success) .true else .false;
}

pub fn emitHandleIPCMessage(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const target, const message, const handle = callframe.argumentsAsArray(3);
    if (target.isNull()) {
        const ipc = globalThis.bunVM().getIPCInstance() orelse return .js_undefined;
        ipc.handleIPCMessage(.{ .data = message }, handle);
    } else {
        if (!target.isCell()) return .js_undefined;
        const subprocess = bun.jsc.Subprocess.fromJSDirect(target) orelse return .js_undefined;
        subprocess.handleIPCMessage(.{ .data = message }, handle);
    }
    return .js_undefined;
}

const IPCCommand = union(enum) {
    handle: jsc.JSValue,
    ack,
    nack,
};

fn handleIPCMessage(send_queue: *SendQueue, message: DecodedIPCMessage, globalThis: *jsc.JSGlobalObject) void {
    if (Environment.isDebug) {
        var formatter = jsc.ConsoleObject.Formatter{ .globalThis = globalThis };
        defer formatter.deinit();
        switch (message) {
            .version => |version| log("received ipc message: version: {}", .{version}),
            .data => |jsvalue| log("received ipc message: {f}", .{jsvalue.toFmt(&formatter)}),
            .internal => |jsvalue| log("received ipc message: internal: {f}", .{jsvalue.toFmt(&formatter)}),
        }
    }
    var internal_command: ?IPCCommand = null;
    if (message == .data) handle_message: {
        const msg_data = message.data;
        if (msg_data.isObject()) {
            const cmd = msg_data.fastGet(globalThis, .cmd) catch {
                globalThis.clearException();
                break :handle_message;
            } orelse {
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
                const ack = send_queue.incoming_fd != null;

                const packet = if (ack) getAckPacket(send_queue.mode) else getNackPacket(send_queue.mode);
                var handle = SendHandle{ .data = .{}, .handle = null, .callbacks = .ack_nack };
                bun.handleOom(handle.data.write(packet));

                // Insert at appropriate position in send queue
                send_queue.insertMessage(handle);

                // Send if needed
                log("IPC call continueSend() from handleIPCMessage", .{});
                send_queue.continueSend(globalThis, .new_message_appended);

                if (!ack) return;

                // Get file descriptor and clear it
                const fd: bun.FD = bun.take(&send_queue.incoming_fd).?;

                const target: bun.jsc.JSValue = switch (send_queue.owner) {
                    .subprocess => |subprocess| subprocess.this_value.tryGet() orelse .zero,
                    .virtual_machine => bun.jsc.JSValue.null,
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
                send_queue.onAckNack(globalThis, .ack);
                return;
            },
            .nack => {
                send_queue.onAckNack(globalThis, .nack);
                return;
            },
        }
    } else {
        switch (send_queue.owner) {
            inline else => |owner| {
                owner.handleIPCMessage(message, .js_undefined);
            },
        }
    }
}

fn onData2(send_queue: *SendQueue, all_data: []const u8) void {
    var data = all_data;
    // log("onData '{'}'", .{std.zig.fmtString(data)});

    // In the VirtualMachine case, `globalThis` is an optional, in case
    // the vm is freed before the socket closes.
    const globalThis = send_queue.getGlobalThis();

    // Decode the message with just the temporary buffer, and if that
    // fails (not enough bytes) then we allocate to .ipc_buffer
    switch (send_queue.incoming) {
        .json => |*json_buf| {
            // JSON mode: append to buffer (scans only new data for newline),
            // then process complete messages using next().
            json_buf.append(data);

            while (json_buf.next()) |msg| {
                const result = decodeIPCMessage(.json, msg.data, globalThis, msg.newline_pos) catch |e| switch (e) {
                    error.NotEnoughBytes => {
                        log("hit NotEnoughBytes", .{});
                        return;
                    },
                    error.InvalidFormat, error.JSError, error.JSTerminated => {
                        send_queue.closeSocket(.failure, .user);
                        return;
                    },
                    error.OutOfMemory => {
                        Output.printErrorln("IPC message is too long.", .{});
                        send_queue.closeSocket(.failure, .user);
                        return;
                    },
                };

                handleIPCMessage(send_queue, result.message, globalThis);
                json_buf.consume(result.bytes_consumed);
            }
        },
        .advanced => |*adv_buf| {
            // Advanced mode: uses length-prefix, no newline scanning needed.
            // Try to decode directly first, only buffer if needed.
            if (adv_buf.len == 0) {
                while (true) {
                    const result = decodeIPCMessage(.advanced, data, globalThis, null) catch |e| switch (e) {
                        error.NotEnoughBytes => {
                            _ = bun.handleOom(adv_buf.write(bun.default_allocator, data));
                            log("hit NotEnoughBytes", .{});
                            return;
                        },
                        error.InvalidFormat, error.JSError, error.JSTerminated => {
                            send_queue.closeSocket(.failure, .user);
                            return;
                        },
                        error.OutOfMemory => {
                            Output.printErrorln("IPC message is too long.", .{});
                            send_queue.closeSocket(.failure, .user);
                            return;
                        },
                    };

                    handleIPCMessage(send_queue, result.message, globalThis);

                    if (result.bytes_consumed < data.len) {
                        data = data[result.bytes_consumed..];
                    } else {
                        return;
                    }
                }
            }

            // Buffer has existing data, append and process
            _ = bun.handleOom(adv_buf.write(bun.default_allocator, data));
            var slice = adv_buf.slice();
            while (true) {
                const result = decodeIPCMessage(.advanced, slice, globalThis, null) catch |e| switch (e) {
                    error.NotEnoughBytes => {
                        // copy the remaining bytes to the start of the buffer
                        bun.copy(u8, adv_buf.ptr[0..slice.len], slice);
                        bun.debugAssert(slice.len <= std.math.maxInt(u32));
                        adv_buf.len = @intCast(slice.len);
                        log("hit NotEnoughBytes2", .{});
                        return;
                    },
                    error.InvalidFormat, error.JSError, error.JSTerminated => {
                        send_queue.closeSocket(.failure, .user);
                        return;
                    },
                    error.OutOfMemory => {
                        Output.printErrorln("IPC message is too long.", .{});
                        send_queue.closeSocket(.failure, .user);
                        return;
                    },
                };

                handleIPCMessage(send_queue, result.message, globalThis);

                if (result.bytes_consumed < slice.len) {
                    slice = slice[result.bytes_consumed..];
                } else {
                    adv_buf.len = 0;
                    return;
                }
            }
        },
    }
}

/// Used on POSIX
pub const IPCHandlers = struct {
    pub const PosixSocket = struct {
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
            send_queue: *SendQueue,
            _: Socket,
            _: c_int,
            _: ?*anyopaque,
        ) void {
            // uSockets has already freed the underlying socket
            log("NewSocketIPCHandler#onClose\n", .{});
            send_queue._socketClosed();
        }

        pub fn onData(
            send_queue: *SendQueue,
            _: Socket,
            all_data: []const u8,
        ) void {
            const globalThis = send_queue.getGlobalThis();
            const loop = globalThis.bunVM().eventLoop();
            loop.enter();
            defer loop.exit();
            onData2(send_queue, all_data);
        }

        pub fn onFd(
            send_queue: *SendQueue,
            _: Socket,
            fd: c_int,
        ) void {
            log("onFd: {d}", .{fd});
            if (send_queue.incoming_fd != null) {
                log("onFd: incoming_fd already set; overwriting", .{});
            }
            send_queue.incoming_fd = bun.FD.fromNative(fd);
        }

        pub fn onWritable(
            send_queue: *SendQueue,
            _: Socket,
        ) void {
            log("onWritable", .{});

            const globalThis = send_queue.getGlobalThis();
            const loop = globalThis.bunVM().eventLoop();
            loop.enter();
            defer loop.exit();
            log("IPC call continueSend() from onWritable", .{});
            send_queue.continueSend(globalThis, .on_writable);
        }

        pub fn onTimeout(
            _: *SendQueue,
            _: Socket,
        ) void {
            log("onTimeout", .{});
            // unref if needed
        }

        pub fn onLongTimeout(
            _: *SendQueue,
            _: Socket,
        ) void {
            log("onLongTimeout", .{});
            // onLongTimeout
        }

        pub fn onConnectError(
            send_queue: *SendQueue,
            _: Socket,
            _: c_int,
        ) void {
            log("onConnectError", .{});
            // context has not been initialized
            send_queue.closeSocket(.failure, .user);
        }

        pub fn onEnd(
            send_queue: *SendQueue,
            _: Socket,
        ) void {
            log("onEnd", .{});
            send_queue.closeSocket(.failure, .user);
        }
    };

    pub const WindowsNamedPipe = struct {
        fn onReadAlloc(send_queue: *SendQueue, suggested_size: usize) []u8 {
            switch (send_queue.incoming) {
                .json => |*json_buf| {
                    var available = json_buf.unusedCapacitySlice();
                    if (available.len < suggested_size) {
                        json_buf.ensureUnusedCapacity(suggested_size);
                        available = json_buf.unusedCapacitySlice();
                    }
                    log("NewNamedPipeIPCHandler#onReadAlloc {d}", .{suggested_size});
                    return available.ptr[0..suggested_size];
                },
                .advanced => |*adv_buf| {
                    var available = adv_buf.unusedCapacitySlice();
                    if (available.len < suggested_size) {
                        bun.handleOom(adv_buf.ensureUnusedCapacity(bun.default_allocator, suggested_size));
                        available = adv_buf.unusedCapacitySlice();
                    }
                    log("NewNamedPipeIPCHandler#onReadAlloc {d}", .{suggested_size});
                    return available.ptr[0..suggested_size];
                },
            }
        }

        fn onReadError(send_queue: *SendQueue, err: bun.sys.E) void {
            log("NewNamedPipeIPCHandler#onReadError {}", .{err});
            send_queue.closeSocketNextTick(true);
        }

        fn onRead(send_queue: *SendQueue, buffer: []const u8) void {
            log("NewNamedPipeIPCHandler#onRead {d}", .{buffer.len});
            const globalThis = send_queue.getGlobalThis();
            const loop = globalThis.bunVM().eventLoop();
            loop.enter();
            defer loop.exit();

            switch (send_queue.incoming) {
                .json => |*json_buf| {
                    // For JSON mode on Windows, use notifyWritten to update length and scan for newlines
                    bun.assert(json_buf.data.len + buffer.len <= json_buf.data.cap);
                    bun.assert(bun.isSliceInBuffer(buffer, json_buf.data.allocatedSlice()));

                    json_buf.notifyWritten(buffer);

                    // Process complete messages using next() - avoids O(n²) re-scanning
                    while (json_buf.next()) |msg| {
                        const result = decodeIPCMessage(.json, msg.data, globalThis, msg.newline_pos) catch |e| switch (e) {
                            error.NotEnoughBytes => {
                                log("hit NotEnoughBytes3", .{});
                                return;
                            },
                            error.InvalidFormat, error.JSError, error.JSTerminated => {
                                send_queue.closeSocket(.failure, .user);
                                return;
                            },
                            error.OutOfMemory => {
                                Output.printErrorln("IPC message is too long.", .{});
                                send_queue.closeSocket(.failure, .user);
                                return;
                            },
                        };

                        handleIPCMessage(send_queue, result.message, globalThis);
                        json_buf.consume(result.bytes_consumed);
                    }
                },
                .advanced => |*adv_buf| {
                    adv_buf.len +|= @as(u32, @intCast(buffer.len));
                    var slice = adv_buf.slice();

                    bun.assert(adv_buf.len <= adv_buf.cap);
                    bun.assert(bun.isSliceInBuffer(buffer, adv_buf.allocatedSlice()));

                    while (true) {
                        const result = decodeIPCMessage(.advanced, slice, globalThis, null) catch |e| switch (e) {
                            error.NotEnoughBytes => {
                                // copy the remaining bytes to the start of the buffer
                                bun.copy(u8, adv_buf.ptr[0..slice.len], slice);
                                // slice.len is guaranteed <= adv_buf.len (u32) since it's derived from adv_buf.slice()
                                bun.debugAssert(slice.len <= std.math.maxInt(u32));
                                adv_buf.len = @intCast(slice.len);
                                log("hit NotEnoughBytes3", .{});
                                return;
                            },
                            error.InvalidFormat, error.JSError, error.JSTerminated => {
                                send_queue.closeSocket(.failure, .user);
                                return;
                            },
                            error.OutOfMemory => {
                                Output.printErrorln("IPC message is too long.", .{});
                                send_queue.closeSocket(.failure, .user);
                                return;
                            },
                        };

                        handleIPCMessage(send_queue, result.message, globalThis);

                        if (result.bytes_consumed < slice.len) {
                            slice = slice[result.bytes_consumed..];
                        } else {
                            // clear the buffer
                            adv_buf.len = 0;
                            return;
                        }
                    }
                },
            }
        }

        pub fn onClose(send_queue: *SendQueue) void {
            log("NewNamedPipeIPCHandler#onClose\n", .{});
            send_queue.getGlobalThis().bunVM().enqueueTask(jsc.ManagedTask.New(SendQueue, SendQueue._onAfterIPCClosed).init(send_queue));
        }
    };
};

pub fn ipcSerialize(globalObject: *jsc.JSGlobalObject, message: jsc.JSValue, handle: jsc.JSValue) bun.JSError!jsc.JSValue {
    return bun.cpp.IPCSerialize(globalObject, message, handle);
}

pub fn ipcParse(globalObject: *jsc.JSGlobalObject, target: jsc.JSValue, serialized: jsc.JSValue, fd: jsc.JSValue) bun.JSError!jsc.JSValue {
    return bun.cpp.IPCParse(globalObject, target, serialized, fd);
}

const string = []const u8;

const node_cluster_binding = @import("./node/node_cluster_binding.zig");
const std = @import("std");
const JSONLineBuffer = @import("./JSONLineBuffer.zig").JSONLineBuffer;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const strings = bun.strings;
const uws = bun.uws;
const uv = bun.windows.libuv;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
