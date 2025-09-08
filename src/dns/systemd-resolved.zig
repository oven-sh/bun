const std = @import("std");
const bun = @import("bun");
const dns = bun.dns;
const jsc = bun.jsc;
const Environment = bun.Environment;
const Output = bun.Output;
const strings = bun.strings;
const Async = bun.Async;

const SystemdResolvedBackend = @import("systemd-resolved-backend.zig");

const log = Output.scoped(.SystemdResolved, false);

const GetAddrInfoRequest = dns.GetAddrInfoRequest;
const DNSLookup = dns.DNSLookup;

pub const SystemdResolved = struct {
    connection: ?*SystemdResolvedBackend.SystemdResolvedConnection = null,
    event_loop: jsc.EventLoopHandle,
    
    var global_instance: ?*SystemdResolved = null;
    
    pub fn init(event_loop: jsc.EventLoopHandle) !*SystemdResolved {
        if (global_instance) |instance| {
            return instance;
        }
        
        const allocator = event_loop.allocator();
        var this = try allocator.create(SystemdResolved);
        this.* = .{
            .event_loop = event_loop,
        };
        
        if (SystemdResolvedBackend.SystemdResolvedConnection.isAvailable()) {
            this.connection = try SystemdResolvedBackend.SystemdResolvedConnection.init(event_loop);
        }
        
        global_instance = this;
        return this;
    }
    
    pub fn deinit(this: *SystemdResolved) void {
        if (this.connection) |conn| {
            conn.deinit();
        }
        this.event_loop.allocator().destroy(this);
        global_instance = null;
    }
    
    pub fn isAvailable() bool {
        return SystemdResolvedBackend.SystemdResolvedConnection.isAvailable();
    }
    
    pub fn lookup(this: *dns.Resolver, query: dns.GetAddrInfo, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
        if (comptime !Environment.isLinux) {
            return dns.LibC.lookup(this, query, globalThis);
        }
        
        if (!isAvailable()) {
            return dns.LibC.lookup(this, query, globalThis);
        }
        
        const vm = globalThis.bunVM();
        const event_loop = jsc.EventLoopHandle.init(vm);
        const systemd = global_instance orelse blk: {
            const instance = init(event_loop) catch {
                return dns.LibC.lookup(this, query, globalThis);
            };
            break :blk instance;
        };
        
        const connection = systemd.connection orelse {
            return dns.LibC.lookup(this, query, globalThis);
        };
        
        const key = GetAddrInfoRequest.PendingCacheKey.init(query);
        var cache = this.getOrPutIntoPendingCache(key, .pending_host_cache_native);
        
        if (cache == .inflight) {
            var dns_lookup = bun.handleOom(DNSLookup.init(this, globalThis, globalThis.allocator()));
            cache.inflight.append(dns_lookup);
            return dns_lookup.promise.value();
        }
        
        var request = GetAddrInfoRequest.init(
            cache,
            .{ .systemd_resolved = undefined },
            this,
            query,
            globalThis,
            "pending_host_cache_native",
        ) catch |err| bun.handleOom(err);
        
        log("Created GetAddrInfoRequest, calling requestSent", .{});
        const promise_value = request.head.promise.value();
        
        const callback_context = globalThis.allocator().create(CallbackContext) catch |err| {
            bun.handleOom(err);
            request.head.promise.rejectTask(globalThis, globalThis.createErrorInstance("Out of memory", .{}));
            if (request.cache.pending_cache) this.pending_host_cache_native.used.set(request.cache.pos_in_pending);
            event_loop.allocator().destroy(request);
            return promise_value;
        };
        
        callback_context.* = .{
            .request = request,
            .globalThis = globalThis,
            .resolver = this,
        };
        
        const family: ?i32 = switch (query.options.family) {
            .unspecified => null,
            .ipv4 => std.posix.AF.INET,
            .ipv6 => std.posix.AF.INET6,
        };
        
        connection.resolveHostname(
            query.name,
            family,
            null,
            onResolveComplete,
            callback_context,
        ) catch |err| {
            log("Failed to send DNS request: {s}", .{@errorName(err)});
            globalThis.allocator().destroy(callback_context);
            request.head.promise.rejectTask(globalThis, globalThis.createErrorInstance("DNS request failed: {s}", .{@errorName(err)}));
            if (request.cache.pending_cache) this.pending_host_cache_native.used.set(request.cache.pos_in_pending);
            event_loop.allocator().destroy(request);
            return promise_value;
        };
        
        this.requestSent(globalThis.bunVM());
        
        return promise_value;
    }
    
    const CallbackContext = struct {
        request: *GetAddrInfoRequest,
        globalThis: *jsc.JSGlobalObject,
        resolver: *dns.Resolver,
        
        // Task to schedule callback on JS thread
        pub const Task = bun.jsc.WorkTask(CallbackContext);
        
        pub fn run(this: *CallbackContext, task: *Task) void {
            // This runs on the JS thread - safe to call getAddrInfoAsyncCallback
            if (this.errno != 0) {
                GetAddrInfoRequest.getAddrInfoAsyncCallback(this.errno, null, this.request);
            } else if (this.addrinfo) |info| {
                GetAddrInfoRequest.getAddrInfoAsyncCallback(0, info, this.request);
            } else {
                GetAddrInfoRequest.getAddrInfoAsyncCallback(-1, null, this.request);
            }
            
            // Clean up
            const allocator = this.globalThis.allocator();
            allocator.destroy(this);
            task.onFinish();
        }
        
        // Store result data for task
        errno: i32 = 0,
        addrinfo: ?*std.c.addrinfo = null,
    };
    
    fn onResolveComplete(
        req: *SystemdResolvedBackend.SystemdResolvedConnection.Request,
        result: ?*SystemdResolvedBackend.SystemdResolvedConnection.ResolveResult,
        err: ?*SystemdResolvedBackend.SystemdResolvedConnection.ResolveError,
    ) void {
        const context = @as(*CallbackContext, @ptrCast(@alignCast(req.context)));
        const globalThis = context.globalThis;
        const allocator = globalThis.allocator();
        
        defer {
            allocator.free(req.name);
            allocator.destroy(req);
        }
        
        if (err) |error_info| {
            defer error_info.deinit(allocator);
            
            const errno: i32 = if (strings.eqlComptime(error_info.code, "NoSuchResourceRecord")) 
                @intFromEnum(std.posix.E.NOENT)
            else if (strings.eqlComptime(error_info.code, "QueryTimedOut"))
                @intFromEnum(std.posix.E.TIMEDOUT)
            else if (strings.eqlComptime(error_info.code, "NetworkDown"))
                @intFromEnum(std.posix.E.NETDOWN)
            else
                -1;
            
            context.errno = errno;
            
            // Schedule callback on JS thread
            var task = CallbackContext.Task.createOnJSThread(allocator, globalThis, context) catch |e| {
                bun.handleOom(e);
                GetAddrInfoRequest.getAddrInfoAsyncCallback(errno, null, context.request);
                allocator.destroy(context);
                return;
            };
            task.schedule();
            return;
        }
        
        if (result) |res| {
            defer res.deinit(allocator);
            
            if (res.addresses.len == 0) {
                context.errno = @intFromEnum(std.posix.E.NOENT);
                
                // Schedule callback on JS thread
                var task = CallbackContext.Task.createOnJSThread(allocator, globalThis, context) catch |e| {
                    bun.handleOom(e);
                    GetAddrInfoRequest.getAddrInfoAsyncCallback(@intFromEnum(std.posix.E.NOENT), null, context.request);
                    allocator.destroy(context);
                    return;
                };
                task.schedule();
                return;
            }
            
            var head: ?*std.c.addrinfo = null;
            var tail: ?*std.c.addrinfo = null;
            
            for (res.addresses) |addr| {
                const ai = allocator.create(std.c.addrinfo) catch {
                    if (head) |h| std.c.freeaddrinfo(h);
                    context.errno = @intFromEnum(std.posix.E.NOMEM);
                    
                    // Schedule callback on JS thread
                    var task = CallbackContext.Task.createOnJSThread(allocator, globalThis, context) catch |e2| {
                        bun.handleOom(e2);
                        GetAddrInfoRequest.getAddrInfoAsyncCallback(@intFromEnum(std.posix.E.NOMEM), null, context.request);
                        allocator.destroy(context);
                        return;
                    };
                    task.schedule();
                    return;
                };
                
                ai.* = std.mem.zeroes(std.c.addrinfo);
                ai.ai_family = addr.family;
                ai.ai_socktype = std.posix.SOCK.STREAM;
                ai.ai_protocol = std.posix.IPPROTO.TCP;
                
                if (addr.family == std.posix.AF.INET) {
                    const sockaddr = allocator.create(std.posix.sockaddr.in) catch {
                        allocator.destroy(ai);
                        if (head) |h| std.c.freeaddrinfo(h);
                        context.errno = @intFromEnum(std.posix.E.NOMEM);
                        
                        // Schedule callback on JS thread
                        var task = CallbackContext.Task.createOnJSThread(allocator, globalThis, context) catch |e2| {
                            bun.handleOom(e2);
                            GetAddrInfoRequest.getAddrInfoAsyncCallback(@intFromEnum(std.posix.E.NOMEM), null, context.request);
                            allocator.destroy(context);
                            return;
                        };
                        task.schedule();
                        return;
                    };
                    
                    sockaddr.* = std.mem.zeroes(std.posix.sockaddr.in);
                    sockaddr.family = std.posix.AF.INET;
                    sockaddr.port = bun.std.mem.bigToNative(u16, request.head.port);
                    
                    var parts = std.mem.tokenize(u8, addr.address, ".");
                    var i: usize = 0;
                    while (parts.next()) |part| : (i += 1) {
                        if (i >= 4) break;
                        const byte = std.fmt.parseInt(u8, part, 10) catch 0;
                        sockaddr.addr.s_addr |= @as(u32, byte) << @intCast(i * 8);
                    }
                    
                    ai.ai_addr = @ptrCast(sockaddr);
                    ai.ai_addrlen = @sizeOf(std.posix.sockaddr.in);
                } else if (addr.family == std.posix.AF.INET6) {
                    const sockaddr = allocator.create(std.posix.sockaddr.in6) catch {
                        allocator.destroy(ai);
                        if (head) |h| std.c.freeaddrinfo(h);
                        context.errno = @intFromEnum(std.posix.E.NOMEM);
                        
                        // Schedule callback on JS thread
                        var task = CallbackContext.Task.createOnJSThread(allocator, globalThis, context) catch |e2| {
                            bun.handleOom(e2);
                            GetAddrInfoRequest.getAddrInfoAsyncCallback(@intFromEnum(std.posix.E.NOMEM), null, context.request);
                            allocator.destroy(context);
                            return;
                        };
                        task.schedule();
                        return;
                    };
                    
                    sockaddr.* = std.mem.zeroes(std.posix.sockaddr.in6);
                    sockaddr.family = std.posix.AF.INET6;
                    sockaddr.port = bun.std.mem.bigToNative(u16, request.head.port);
                    
                    _ = std.net.Ip6Address.parse(addr.address, 0) catch {};
                    
                    ai.ai_addr = @ptrCast(sockaddr);
                    ai.ai_addrlen = @sizeOf(std.posix.sockaddr.in6);
                }
                
                if (head == null) {
                    head = ai;
                    tail = ai;
                } else {
                    tail.?.ai_next = ai;
                    tail = ai;
                }
            }
            
            context.addrinfo = head;
            
            // Schedule callback on JS thread
            var task = CallbackContext.Task.createOnJSThread(allocator, globalThis, context) catch |e| {
                bun.handleOom(e);
                if (head) |h| std.c.freeaddrinfo(h);
                GetAddrInfoRequest.getAddrInfoAsyncCallback(@intFromEnum(std.posix.E.NOMEM), null, context.request);
                allocator.destroy(context);
                return;
            };
            task.schedule();
        } else {
            context.errno = -1;
            
            // Schedule callback on JS thread
            var task = CallbackContext.Task.createOnJSThread(allocator, globalThis, context) catch |e| {
                bun.handleOom(e);
                GetAddrInfoRequest.getAddrInfoAsyncCallback(-1, null, context.request);
                allocator.destroy(context);
                return;
            };
            task.schedule();
        }
    }
};