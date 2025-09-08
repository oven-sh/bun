const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const Output = bun.Output;
const uws = bun.uws;
const jsc = bun.jsc;
const Environment = bun.Environment;

const log = Output.scoped(.SystemdResolved, false);

pub const SystemdResolvedConnection = struct {
    const SOCKET_PATH = "/run/systemd/resolve/io.systemd.Resolve";
    const VARLINK_METHOD = "io.systemd.Resolve.ResolveHostname";
    
    socket: ?uws.SocketTCP = null,
    socket_context: ?*uws.SocketContext = null,
    vm: *jsc.VirtualMachine,
    
    read_buffer: bun.MutableString,
    write_buffer: bun.MutableString,
    
    current_request: ?*Request = null,
    request_queue: std.ArrayList(*Request),
    
    flags: packed struct {
        connected: bool = false,
        connecting: bool = false,
        has_backpressure: bool = false,
        closed: bool = false,
    } = .{},
    
    pub const Request = struct {
        id: u64,
        name: []const u8,
        family: ?i32,
        flags: ?i32,
        callback: *const fn (*Request, ?*ResolveResult, ?*ResolveError) void,
        context: *anyopaque,
        next: ?*Request = null,
    };
    
    pub const ResolveResult = struct {
        addresses: []ResolvedAddress,
        name: []const u8,
        flags: i32,
        
        pub fn deinit(this: *ResolveResult, allocator: std.mem.Allocator) void {
            allocator.free(this.addresses);
            allocator.free(this.name);
        }
    };
    
    pub const ResolvedAddress = struct {
        ifindex: ?i32,
        family: i32,
        address: []const u8,
    };
    
    pub const ResolveError = struct {
        code: []const u8,
        message: []const u8,
        
        pub fn deinit(this: *ResolveError, allocator: std.mem.Allocator) void {
            allocator.free(this.code);
            allocator.free(this.message);
        }
    };
    
    var next_request_id: std.atomic.Value(u64) = std.atomic.Value(u64).init(1);
    
    pub fn init(vm: *jsc.VirtualMachine) !*SystemdResolvedConnection {
        const allocator = vm.allocator;
        const this = try allocator.create(SystemdResolvedConnection);
        
        this.* = .{
            .vm = vm,
            .read_buffer = try bun.MutableString.initEmpty(allocator, 4096),
            .write_buffer = try bun.MutableString.initEmpty(allocator, 4096),
            .request_queue = std.ArrayList(*Request).init(allocator),
        };
        
        return this;
    }
    
    pub fn deinit(this: *SystemdResolvedConnection) void {
        const allocator = this.vm.allocator;
        
        if (this.socket) |socket| {
            socket.close();
        }
        
        this.read_buffer.deinit();
        this.write_buffer.deinit();
        this.request_queue.deinit();
        
        allocator.destroy(this);
    }
    
    pub fn isAvailable() bool {
        if (comptime !Environment.isLinux) return false;
        
        const stat = std.fs.cwd().statFile(SOCKET_PATH) catch return false;
        return stat.kind == .unix_domain_socket;
    }
    
    pub fn connect(this: *SystemdResolvedConnection) !void {
        if (this.flags.connected or this.flags.connecting) {
            return;
        }
        
        this.flags.connecting = true;
        
        const ctx = this.socket_context orelse brk: {
            const ctx_ = uws.SocketContext.createNoSSLContext(this.vm.uwsLoop(), @sizeOf(*SystemdResolvedConnection)).?;
            uws.NewSocketHandler(false).configure(ctx_, true, *SystemdResolvedConnection, SocketHandler(false));
            this.socket_context = ctx_;
            break :brk ctx_;
        };
        
        this.socket = try uws.SocketTCP.connectUnixAnon(
            SOCKET_PATH,
            ctx,
            this,
        );
    }
    
    pub fn resolveHostname(
        this: *SystemdResolvedConnection,
        name: []const u8,
        family: ?i32,
        flags: ?i32,
        callback: *const fn (*Request, ?*ResolveResult, ?*ResolveError) void,
        context: *anyopaque,
    ) !void {
        const allocator = this.vm.allocator;
        
        const request = try allocator.create(Request);
        request.* = .{
            .id = next_request_id.fetchAdd(1, .monotonic),
            .name = try allocator.dupe(u8, name),
            .family = family,
            .flags = flags,
            .callback = callback,
            .context = context,
        };
        
        try this.request_queue.append(request);
        
        if (!this.flags.connected) {
            try this.connect();
        } else {
            try this.sendNextRequest();
        }
    }
    
    fn sendNextRequest(this: *SystemdResolvedConnection) !void {
        if (this.current_request != null) return;
        if (this.request_queue.items.len == 0) return;
        if (this.flags.has_backpressure) return;
        
        const request = this.request_queue.orderedRemove(0);
        this.current_request = request;
        
        this.write_buffer.reset();
        
        var writer = this.write_buffer.writer();
        
        try std.json.stringify(.{
            .method = VARLINK_METHOD,
            .parameters = .{
                .name = request.name,
                .family = request.family,
                .flags = request.flags,
            },
        }, .{}, writer);
        
        try writer.writeByte(0);
        
        this.flushData();
    }
    
    fn flushData(this: *SystemdResolvedConnection) void {
        if (this.flags.has_backpressure) return;
        
        const chunk = this.write_buffer.list.items;
        if (chunk.len == 0) return;
        
        if (this.socket) |socket| {
            const wrote = socket.write(chunk);
            this.flags.has_backpressure = wrote < chunk.len;
            
            if (wrote > 0) {
                _ = this.write_buffer.list.orderedRemove(0);
                _ = this.write_buffer.list.resize(@intCast(chunk.len - wrote)) catch {};
            }
        }
    }
    
    fn processResponse(this: *SystemdResolvedConnection, data: []const u8) void {
        defer {
            const remaining = data[this.processResponseInternal(data)..];
            if (remaining.len > 0) {
                this.processResponse(remaining);
            }
        }
    }
    
    fn processResponseInternal(this: *SystemdResolvedConnection, data: []const u8) usize {
        const allocator = this.vm.allocator;
        
        var null_pos: ?usize = null;
        for (data, 0..) |byte, i| {
            if (byte == 0) {
                null_pos = i;
                break;
            }
        }
        
        if (null_pos == null) {
            this.read_buffer.appendSlice(data) catch {};
            return data.len;
        }
        
        const message_data = if (this.read_buffer.list.items.len > 0) blk: {
            this.read_buffer.appendSlice(data[0..null_pos.?]) catch {};
            break :blk this.read_buffer.list.items;
        } else data[0..null_pos.?];
        
        defer this.read_buffer.reset();
        
        const request = this.current_request orelse return null_pos.? + 1;
        this.current_request = null;
        
        const json_source = bun.logger.Source.initPathString("<varlink>", message_data);
        var temp_log = bun.logger.Log.init(allocator);
        defer temp_log.deinit();
        
        const json = bun.json.parseUTF8(&json_source, &temp_log, allocator) catch |err| {
            log("Failed to parse JSON response: {s}", .{@errorName(err)});
            var error_result = ResolveError{
                .code = "PARSE_ERROR",
                .message = try allocator.dupe(u8, "Failed to parse response"),
            };
            request.callback(request, null, &error_result);
            return null_pos.? + 1;
        };
        
        if (json.data == .e_object) {
            const obj = json.data.e_object;
            
            if (obj.get("error")) |error_val| {
                if (error_val.data == .e_string) {
                    var error_result = ResolveError{
                        .code = try allocator.dupe(u8, error_val.data.e_string.data),
                        .message = try allocator.dupe(u8, error_val.data.e_string.data),
                    };
                    request.callback(request, null, &error_result);
                    return null_pos.? + 1;
                }
            }
            
            if (obj.get("parameters")) |params| {
                if (params.data == .e_object) {
                    const params_obj = params.data.e_object;
                    
                    var addresses = std.ArrayList(ResolvedAddress).init(allocator);
                    defer addresses.deinit();
                    
                    if (params_obj.get("addresses")) |addresses_val| {
                        if (addresses_val.data == .e_array) {
                            for (addresses_val.data.e_array.slice()) |addr_val| {
                                if (addr_val.data == .e_object) {
                                    const addr_obj = addr_val.data.e_object;
                                    
                                    var resolved_addr = ResolvedAddress{
                                        .ifindex = null,
                                        .family = 0,
                                        .address = "",
                                    };
                                    
                                    if (addr_obj.get("ifindex")) |ifindex_val| {
                                        if (ifindex_val.data == .e_number) {
                                            resolved_addr.ifindex = @intFromFloat(ifindex_val.data.e_number.value);
                                        }
                                    }
                                    
                                    if (addr_obj.get("family")) |family_val| {
                                        if (family_val.data == .e_number) {
                                            resolved_addr.family = @intFromFloat(family_val.data.e_number.value);
                                        }
                                    }
                                    
                                    if (addr_obj.get("address")) |address_val| {
                                        if (address_val.data == .e_array) {
                                            var addr_bytes = try allocator.alloc(u8, address_val.data.e_array.len());
                                            for (address_val.data.e_array.slice(), 0..) |byte_val, i| {
                                                if (byte_val.data == .e_number) {
                                                    addr_bytes[i] = @intFromFloat(byte_val.data.e_number.value);
                                                }
                                            }
                                            
                                            if (resolved_addr.family == std.posix.AF.INET) {
                                                var buf: [16]u8 = undefined;
                                                const addr_str = std.fmt.bufPrint(&buf, "{d}.{d}.{d}.{d}", .{
                                                    addr_bytes[0],
                                                    addr_bytes[1],
                                                    addr_bytes[2],
                                                    addr_bytes[3],
                                                }) catch "";
                                                resolved_addr.address = try allocator.dupe(u8, addr_str);
                                            } else if (resolved_addr.family == std.posix.AF.INET6) {
                                                var buf: [46]u8 = undefined;
                                                const addr_in6 = @as(*align(1) const std.posix.sockaddr.in6, @ptrCast(addr_bytes.ptr));
                                                const addr_str = std.fmt.bufPrint(&buf, "{}", .{addr_in6.addr}) catch "";
                                                resolved_addr.address = try allocator.dupe(u8, addr_str);
                                            }
                                        }
                                    }
                                    
                                    try addresses.append(resolved_addr);
                                }
                            }
                        }
                    }
                    
                    var result = ResolveResult{
                        .addresses = try addresses.toOwnedSlice(),
                        .name = "",
                        .flags = 0,
                    };
                    
                    if (params_obj.get("name")) |name_val| {
                        if (name_val.data == .e_string) {
                            result.name = try allocator.dupe(u8, name_val.data.e_string.data);
                        }
                    }
                    
                    if (params_obj.get("flags")) |flags_val| {
                        if (flags_val.data == .e_number) {
                            result.flags = @intFromFloat(flags_val.data.e_number.value);
                        }
                    }
                    
                    request.callback(request, &result, null);
                    return null_pos.? + 1;
                }
            }
        }
        
        var error_result = ResolveError{
            .code = "UNKNOWN_ERROR",
            .message = try allocator.dupe(u8, "Unknown response format"),
        };
        request.callback(request, null, &error_result);
        return null_pos.? + 1;
    }
    
    pub fn SocketHandler(comptime ssl: bool) type {
        return struct {
            const SocketType = if (ssl) uws.SocketTLS else uws.SocketTCP;
            
            fn _socket(s: SocketType) uws.SocketTCP {
                return s;
            }
            
            pub fn onOpen(this: *SystemdResolvedConnection, socket: SocketType) void {
                log("SystemdResolved connection opened", .{});
                this.socket = _socket(socket);
                this.flags.connected = true;
                this.flags.connecting = false;
                
                this.sendNextRequest() catch |err| {
                    log("Failed to send request: {s}", .{@errorName(err)});
                };
            }
            
            pub fn onClose(this: *SystemdResolvedConnection, socket: SocketType, _: i32, _: ?*anyopaque) void {
                _ = socket;
                log("SystemdResolved connection closed", .{});
                this.flags.connected = false;
                this.flags.connecting = false;
                this.flags.closed = true;
                
                if (this.current_request) |request| {
                    var error_result = ResolveError{
                        .code = "CONNECTION_CLOSED",
                        .message = this.vm.allocator.dupe(u8, "Connection closed") catch "",
                    };
                    request.callback(request, null, &error_result);
                    this.current_request = null;
                }
            }
            
            pub fn onEnd(this: *SystemdResolvedConnection, socket: SocketType) void {
                this.onClose(socket, 0, null);
            }
            
            pub fn onConnectError(this: *SystemdResolvedConnection, socket: SocketType, _: i32) void {
                log("SystemdResolved connection error", .{});
                this.onClose(socket, 0, null);
            }
            
            pub fn onTimeout(this: *SystemdResolvedConnection, socket: SocketType) void {
                _ = socket;
                log("SystemdResolved connection timeout", .{});
                
                if (this.current_request) |request| {
                    var error_result = ResolveError{
                        .code = "TIMEOUT",
                        .message = this.vm.allocator.dupe(u8, "Request timeout") catch "",
                    };
                    request.callback(request, null, &error_result);
                    this.current_request = null;
                }
            }
            
            pub fn onData(this: *SystemdResolvedConnection, socket: SocketType, data: []const u8) void {
                _ = socket;
                this.processResponse(data);
                this.sendNextRequest() catch |err| {
                    log("Failed to send next request: {s}", .{@errorName(err)});
                };
            }
            
            pub fn onWritable(this: *SystemdResolvedConnection, socket: SocketType) void {
                _ = socket;
                this.flags.has_backpressure = false;
                this.flushData();
                
                if (this.write_buffer.list.items.len == 0) {
                    this.sendNextRequest() catch |err| {
                        log("Failed to send request on writable: {s}", .{@errorName(err)});
                    };
                }
            }
            
            pub const onHandshake = null;
        };
    }
};