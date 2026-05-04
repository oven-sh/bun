//! JSC bridges for c-ares reply structs. Keeps `src/cares_sys/` free of
//! `JSValue`/`JSGlobalObject`/`CallFrame` types — the original methods on
//! each `struct_ares_*_reply` are aliased to the free fns here.

// ── struct_hostent ─────────────────────────────────────────────────────────
pub fn hostentToJSResponse(this: *c_ares.struct_hostent, _: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime lookup_name: []const u8) bun.JSError!jsc.JSValue {
    if (comptime strings.eqlComptime(lookup_name, "cname")) {
        // A cname lookup always returns a single record but we follow the common API here.
        if (this.h_name == null) {
            return try jsc.JSValue.createEmptyArray(globalThis, 0);
        }
        return bun.String.toJSArray(globalThis, &[_]bun.String{bun.String.borrowUTF8(this.h_name.?[0..bun.len(this.h_name.?)])});
    }

    if (this.h_aliases == null) {
        return try jsc.JSValue.createEmptyArray(globalThis, 0);
    }

    var count: u32 = 0;
    while (this.h_aliases.?[count] != null) {
        count += 1;
    }

    const array = try jsc.JSValue.createEmptyArray(globalThis, count);
    count = 0;

    while (this.h_aliases.?[count]) |alias| {
        const alias_len = bun.len(alias);
        const alias_slice = alias[0..alias_len];
        try array.putIndex(globalThis, count, jsc.ZigString.fromUTF8(alias_slice).toJS(globalThis));
        count += 1;
    }

    return array;
}

// ── hostent_with_ttls ──────────────────────────────────────────────────────
pub fn hostentWithTtlsToJSResponse(this: *c_ares.hostent_with_ttls, _: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime lookup_name: []const u8) bun.JSError!jsc.JSValue {
    if (comptime strings.eqlComptime(lookup_name, "a") or strings.eqlComptime(lookup_name, "aaaa")) {
        if (this.hostent.h_addr_list == null) {
            return try jsc.JSValue.createEmptyArray(globalThis, 0);
        }

        var count: u32 = 0;
        while (this.hostent.h_addr_list.?[count] != null) {
            count += 1;
        }

        const array = try jsc.JSValue.createEmptyArray(globalThis, count);
        count = 0;

        const addressKey = jsc.ZigString.static("address").withEncoding();
        const ttlKey = jsc.ZigString.static("ttl").withEncoding();

        while (this.hostent.h_addr_list.?[count]) |addr| : (count += 1) {
            const addrString = (if (this.hostent.h_addrtype == c_ares.AF.INET6)
                bun.dns.addressToJS(&std.net.Address.initIp6(addr[0..16].*, 0, 0, 0), globalThis)
            else
                bun.dns.addressToJS(&std.net.Address.initIp4(addr[0..4].*, 0), globalThis)) catch return globalThis.throwOutOfMemoryValue();

            const ttl: ?c_int = if (count < this.ttls.len) this.ttls[count] else null;
            const resultObject = try jsc.JSValue.createObject2(globalThis, &addressKey, &ttlKey, addrString, if (ttl) |val| .jsNumber(val) else .js_undefined);
            try array.putIndex(globalThis, count, resultObject);
        }

        return array;
    } else {
        @compileError(std.fmt.comptimePrint("Unsupported hostent_with_ttls record type: {s}", .{lookup_name}));
    }
}

// ── struct_nameinfo ────────────────────────────────────────────────────────
pub fn nameinfoToJSResponse(this: *c_ares.struct_nameinfo, _: std.mem.Allocator, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    const array = try jsc.JSValue.createEmptyArray(globalThis, 2); // [node, service]

    if (this.node != null) {
        const node_len = bun.len(this.node);
        const node_slice = this.node[0..node_len];
        try array.putIndex(globalThis, 0, jsc.ZigString.fromUTF8(node_slice).toJS(globalThis));
    } else {
        try array.putIndex(globalThis, 0, .js_undefined);
    }

    if (this.service != null) {
        const service_len = bun.len(this.service);
        const service_slice = this.service[0..service_len];
        try array.putIndex(globalThis, 1, jsc.ZigString.fromUTF8(service_slice).toJS(globalThis));
    } else {
        try array.putIndex(globalThis, 1, .js_undefined);
    }

    return array;
}

// ── AddrInfo ───────────────────────────────────────────────────────────────
pub fn addrInfoToJSArray(addr_info: *c_ares.AddrInfo, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    var node = addr_info.node orelse return try jsc.JSValue.createEmptyArray(globalThis, 0);
    const array = try jsc.JSValue.createEmptyArray(globalThis, node.count());

    {
        var j: u32 = 0;
        var current: ?*c_ares.AddrInfo_node = addr_info.node;
        while (current) |this_node| : (current = this_node.next) {
            try array.putIndex(
                globalThis,
                j,
                try GetAddrInfo.Result.toJS(
                    &.{
                        .address = switch (this_node.family) {
                            c_ares.AF.INET => std.net.Address{ .in = .{ .sa = bun.cast(*const std.posix.sockaddr.in, this_node.addr.?).* } },
                            c_ares.AF.INET6 => std.net.Address{ .in6 = .{ .sa = bun.cast(*const std.posix.sockaddr.in6, this_node.addr.?).* } },
                            else => unreachable,
                        },
                        .ttl = this_node.ttl,
                    },
                    globalThis,
                ),
            );
            j += 1;
        }
    }

    return array;
}

// ── struct_ares_caa_reply ──────────────────────────────────────────────────
pub fn caaReplyToJSResponse(this: *c_ares.struct_ares_caa_reply, parent_allocator: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime _: []const u8) bun.JSError!jsc.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = bun.ArenaAllocator.init(stack.get());
    defer arena.deinit();

    const allocator = arena.allocator();
    var count: usize = 0;
    var caa: ?*c_ares.struct_ares_caa_reply = this;
    while (caa != null) : (caa = caa.?.next) {
        count += 1;
    }

    const array = try jsc.JSValue.createEmptyArray(globalThis, count);

    caa = this;
    var i: u32 = 0;
    while (caa != null) {
        var node = caa.?;
        try array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
        caa = node.next;
        i += 1;
    }

    return array;
}

pub fn caaReplyToJS(this: *c_ares.struct_ares_caa_reply, globalThis: *jsc.JSGlobalObject, _: std.mem.Allocator) jsc.JSValue {
    var obj = jsc.JSValue.createEmptyObject(globalThis, 2);

    obj.put(globalThis, jsc.ZigString.static("critical"), jsc.JSValue.jsNumber(this.critical));

    const property = this.property[0..this.plength];
    const value = this.value[0..this.length];
    const property_str = jsc.ZigString.fromUTF8(property);
    obj.put(globalThis, &property_str, jsc.ZigString.fromUTF8(value).toJS(globalThis));

    return obj;
}

// ── struct_ares_srv_reply ──────────────────────────────────────────────────
pub fn srvReplyToJSResponse(this: *c_ares.struct_ares_srv_reply, parent_allocator: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime _: []const u8) bun.JSError!jsc.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = bun.ArenaAllocator.init(stack.get());
    defer arena.deinit();

    const allocator = arena.allocator();
    var count: usize = 0;
    var srv: ?*c_ares.struct_ares_srv_reply = this;
    while (srv != null) : (srv = srv.?.next) {
        count += 1;
    }

    const array = try jsc.JSValue.createEmptyArray(globalThis, count);

    srv = this;
    var i: u32 = 0;
    while (srv != null) {
        var node = srv.?;
        try array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
        srv = node.next;
        i += 1;
    }

    return array;
}

pub fn srvReplyToJS(this: *c_ares.struct_ares_srv_reply, globalThis: *jsc.JSGlobalObject, _: std.mem.Allocator) jsc.JSValue {
    const obj = jsc.JSValue.createEmptyObject(globalThis, 4);

    obj.put(globalThis, jsc.ZigString.static("priority"), jsc.JSValue.jsNumber(this.priority));
    obj.put(globalThis, jsc.ZigString.static("weight"), jsc.JSValue.jsNumber(this.weight));
    obj.put(globalThis, jsc.ZigString.static("port"), jsc.JSValue.jsNumber(this.port));

    const len = bun.len(this.host);
    const host = this.host[0..len];
    obj.put(globalThis, jsc.ZigString.static("name"), jsc.ZigString.fromUTF8(host).toJS(globalThis));

    return obj;
}

// ── struct_ares_mx_reply ───────────────────────────────────────────────────
pub fn mxReplyToJSResponse(this: *c_ares.struct_ares_mx_reply, parent_allocator: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime _: []const u8) bun.JSError!jsc.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = bun.ArenaAllocator.init(stack.get());
    defer arena.deinit();

    const allocator = arena.allocator();
    var count: usize = 0;
    var mx: ?*c_ares.struct_ares_mx_reply = this;
    while (mx != null) : (mx = mx.?.next) {
        count += 1;
    }

    const array = try jsc.JSValue.createEmptyArray(globalThis, count);

    mx = this;
    var i: u32 = 0;
    while (mx != null) {
        var node = mx.?;
        try array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
        mx = node.next;
        i += 1;
    }

    return array;
}

pub fn mxReplyToJS(this: *c_ares.struct_ares_mx_reply, globalThis: *jsc.JSGlobalObject, _: std.mem.Allocator) jsc.JSValue {
    const obj = jsc.JSValue.createEmptyObject(globalThis, 2);
    obj.put(globalThis, jsc.ZigString.static("priority"), jsc.JSValue.jsNumber(this.priority));

    const host_len = bun.len(this.host);
    const host = this.host[0..host_len];
    obj.put(globalThis, jsc.ZigString.static("exchange"), jsc.ZigString.fromUTF8(host).toJS(globalThis));

    return obj;
}

// ── struct_ares_txt_reply ──────────────────────────────────────────────────
pub fn txtReplyToJSResponse(this: *c_ares.struct_ares_txt_reply, parent_allocator: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime _: []const u8) bun.JSError!jsc.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = bun.ArenaAllocator.init(stack.get());
    defer arena.deinit();

    const allocator = arena.allocator();
    var count: usize = 0;
    var txt: ?*c_ares.struct_ares_txt_reply = this;
    while (txt != null) : (txt = txt.?.next) {
        count += 1;
    }

    const array = try jsc.JSValue.createEmptyArray(globalThis, count);

    txt = this;
    var i: u32 = 0;
    while (txt != null) {
        var node = txt.?;
        try array.putIndex(globalThis, i, try node.toJS(globalThis, allocator));
        txt = node.next;
        i += 1;
    }

    return array;
}

pub fn txtReplyToJS(this: *c_ares.struct_ares_txt_reply, globalThis: *jsc.JSGlobalObject, _: std.mem.Allocator) bun.JSError!jsc.JSValue {
    const array = try jsc.JSValue.createEmptyArray(globalThis, 1);
    const value = this.txt[0..this.length];
    try array.putIndex(globalThis, 0, jsc.ZigString.fromUTF8(value).toJS(globalThis));
    return array;
}

pub fn txtReplyToJSForAny(this: *c_ares.struct_ares_txt_reply, _: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime _: []const u8) bun.JSError!jsc.JSValue {
    var count: usize = 0;
    var txt: ?*c_ares.struct_ares_txt_reply = this;
    while (txt != null) : (txt = txt.?.next) {
        count += 1;
    }

    const array = try jsc.JSValue.createEmptyArray(globalThis, count);

    txt = this;
    var i: u32 = 0;
    while (txt != null) : (txt = txt.?.next) {
        var node = txt.?;
        try array.putIndex(globalThis, i, jsc.ZigString.fromUTF8(node.txt[0..node.length]).toJS(globalThis));
        i += 1;
    }

    return (try jsc.JSObject.create(.{
        .entries = array,
    }, globalThis)).toJS();
}

// ── struct_ares_naptr_reply ────────────────────────────────────────────────
pub fn naptrReplyToJSResponse(this: *c_ares.struct_ares_naptr_reply, parent_allocator: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime _: []const u8) bun.JSError!jsc.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = bun.ArenaAllocator.init(stack.get());
    defer arena.deinit();

    const allocator = arena.allocator();
    var count: usize = 0;
    var naptr: ?*c_ares.struct_ares_naptr_reply = this;
    while (naptr != null) : (naptr = naptr.?.next) {
        count += 1;
    }

    const array = try jsc.JSValue.createEmptyArray(globalThis, count);

    naptr = this;
    var i: u32 = 0;
    while (naptr != null) {
        var node = naptr.?;
        try array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
        naptr = node.next;
        i += 1;
    }

    return array;
}

pub fn naptrReplyToJS(this: *c_ares.struct_ares_naptr_reply, globalThis: *jsc.JSGlobalObject, _: std.mem.Allocator) jsc.JSValue {
    const obj = jsc.JSValue.createEmptyObject(globalThis, 6);

    obj.put(globalThis, jsc.ZigString.static("preference"), jsc.JSValue.jsNumber(this.preference));
    obj.put(globalThis, jsc.ZigString.static("order"), jsc.JSValue.jsNumber(this.order));

    const flags_len = bun.len(this.flags);
    const flags = this.flags[0..flags_len];
    obj.put(globalThis, jsc.ZigString.static("flags"), jsc.ZigString.fromUTF8(flags).toJS(globalThis));

    const service_len = bun.len(this.service);
    const service = this.service[0..service_len];
    obj.put(globalThis, jsc.ZigString.static("service"), jsc.ZigString.fromUTF8(service).toJS(globalThis));

    const regexp_len = bun.len(this.regexp);
    const regexp = this.regexp[0..regexp_len];
    obj.put(globalThis, jsc.ZigString.static("regexp"), jsc.ZigString.fromUTF8(regexp).toJS(globalThis));

    const replacement_len = bun.len(this.replacement);
    const replacement = this.replacement[0..replacement_len];
    obj.put(globalThis, jsc.ZigString.static("replacement"), jsc.ZigString.fromUTF8(replacement).toJS(globalThis));

    return obj;
}

// ── struct_ares_soa_reply ──────────────────────────────────────────────────
pub fn soaReplyToJSResponse(this: *c_ares.struct_ares_soa_reply, parent_allocator: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime _: []const u8) bun.JSError!jsc.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = bun.ArenaAllocator.init(stack.get());
    defer arena.deinit();

    const allocator = arena.allocator();

    return this.toJS(globalThis, allocator);
}

pub fn soaReplyToJS(this: *c_ares.struct_ares_soa_reply, globalThis: *jsc.JSGlobalObject, _: std.mem.Allocator) jsc.JSValue {
    const obj = jsc.JSValue.createEmptyObject(globalThis, 7);

    obj.put(globalThis, jsc.ZigString.static("serial"), jsc.JSValue.jsNumber(this.serial));
    obj.put(globalThis, jsc.ZigString.static("refresh"), jsc.JSValue.jsNumber(this.refresh));
    obj.put(globalThis, jsc.ZigString.static("retry"), jsc.JSValue.jsNumber(this.retry));
    obj.put(globalThis, jsc.ZigString.static("expire"), jsc.JSValue.jsNumber(this.expire));
    obj.put(globalThis, jsc.ZigString.static("minttl"), jsc.JSValue.jsNumber(this.minttl));

    const nsname_len = bun.len(this.nsname);
    const nsname = this.nsname[0..nsname_len];
    obj.put(globalThis, jsc.ZigString.static("nsname"), jsc.ZigString.fromUTF8(nsname).toJS(globalThis));

    const hostmaster_len = bun.len(this.hostmaster);
    const hostmaster = this.hostmaster[0..hostmaster_len];
    obj.put(globalThis, jsc.ZigString.static("hostmaster"), jsc.ZigString.fromUTF8(hostmaster).toJS(globalThis));

    return obj;
}

// ── struct_any_reply ───────────────────────────────────────────────────────
pub fn anyReplyToJSResponse(this: *c_ares.struct_any_reply, parent_allocator: std.mem.Allocator, globalThis: *jsc.JSGlobalObject, comptime _: []const u8) bun.JSError!jsc.JSValue {
    var stack = std.heap.stackFallback(2048, parent_allocator);
    var arena = bun.ArenaAllocator.init(stack.get());
    defer arena.deinit();

    const allocator = arena.allocator();

    return this.toJS(globalThis, allocator);
}

fn anyReplyAppend(globalThis: *jsc.JSGlobalObject, array: jsc.JSValue, i: *u32, response: jsc.JSValue, comptime lookup_name: []const u8) bun.JSError!void {
    const transformed = if (response.isString())
        (try jsc.JSObject.create(.{
            .value = response,
        }, globalThis)).toJS()
    else blk: {
        bun.assert(response.isObject());
        break :blk response;
    };

    var upper = comptime lookup_name[0..lookup_name.len].*;
    inline for (&upper) |*char| {
        char.* = std.ascii.toUpper(char.*);
    }

    transformed.put(globalThis, "type", try bun.String.ascii(&upper).toJS(globalThis));
    try array.putIndex(globalThis, i.*, transformed);
    i.* += 1;
}

fn anyReplyAppendAll(globalThis: *jsc.JSGlobalObject, allocator: std.mem.Allocator, array: jsc.JSValue, i: *u32, reply: anytype, comptime lookup_name: []const u8) bun.JSError!void {
    const response: jsc.JSValue = try if (comptime @hasDecl(@TypeOf(reply.*), "toJSForAny"))
        reply.toJSForAny(allocator, globalThis, lookup_name)
    else
        reply.toJSResponse(allocator, globalThis, lookup_name);

    if (response.isArray()) {
        var iterator = try response.arrayIterator(globalThis);
        while (try iterator.next()) |item| {
            try anyReplyAppend(globalThis, array, i, item, lookup_name);
        }
    } else {
        try anyReplyAppend(globalThis, array, i, response, lookup_name);
    }
}

pub fn anyReplyToJS(this: *c_ares.struct_any_reply, globalThis: *jsc.JSGlobalObject, allocator: std.mem.Allocator) bun.JSError!jsc.JSValue {
    const array = try jsc.JSValue.createEmptyArray(globalThis, blk: {
        var len: usize = 0;
        inline for (comptime @typeInfo(c_ares.struct_any_reply).@"struct".fields) |field| {
            if (comptime std.mem.endsWith(u8, field.name, "_reply")) {
                len += @intFromBool(@field(this, field.name) != null);
            }
        }
        break :blk len;
    });

    var i: u32 = 0;

    inline for (comptime @typeInfo(c_ares.struct_any_reply).@"struct".fields) |field| {
        if (comptime std.mem.endsWith(u8, field.name, "_reply")) {
            if (@field(this, field.name)) |reply| {
                const lookup_name = comptime field.name[0 .. field.name.len - "_reply".len];
                try anyReplyAppendAll(globalThis, allocator, array, &i, reply, lookup_name);
            }
        }
    }

    return array;
}

// ── Error ──────────────────────────────────────────────────────────────────
pub const ErrorDeferred = struct {
    errno: c_ares.Error,
    syscall: []const u8,
    hostname: ?bun.String,
    promise: jsc.JSPromise.Strong,

    pub const new = bun.TrivialNew(@This());

    pub fn init(errno: c_ares.Error, syscall: []const u8, hostname: ?bun.String, promise: jsc.JSPromise.Strong) *ErrorDeferred {
        return ErrorDeferred.new(.{
            .errno = errno,
            .syscall = syscall,
            .hostname = hostname,
            .promise = promise,
        });
    }

    pub fn reject(this: *ErrorDeferred, globalThis: *jsc.JSGlobalObject) bun.JSError!void {
        const system_error = jsc.SystemError{
            .errno = @intFromEnum(this.errno),
            .code = bun.String.static(this.errno.code()),
            .message = if (this.hostname) |hostname|
                bun.handleOom(bun.String.createFormat("{s} {s} {f}", .{ this.syscall, this.errno.code()[4..], hostname }))
            else
                bun.handleOom(bun.String.createFormat("{s} {s}", .{ this.syscall, this.errno.code()[4..] })),
            .syscall = bun.String.cloneUTF8(this.syscall),
            .hostname = this.hostname orelse bun.String.empty,
        };

        const instance = system_error.toErrorInstanceWithAsyncStack(globalThis, this.promise.get());
        instance.put(globalThis, "name", try bun.String.static("DNSException").toJS(globalThis));

        defer this.deinit();
        defer this.hostname = null;
        return this.promise.reject(globalThis, instance);
    }

    pub fn rejectLater(this: *ErrorDeferred, globalThis: *jsc.JSGlobalObject) void {
        const Context = struct {
            deferred: *ErrorDeferred,
            globalThis: *jsc.JSGlobalObject,
            pub fn callback(context: *@This()) bun.JSError!void {
                defer bun.default_allocator.destroy(context);
                try context.deferred.reject(context.globalThis);
            }
        };

        const context = bun.handleOom(bun.default_allocator.create(Context));
        context.deferred = this;
        context.globalThis = globalThis;
        // TODO(@heimskr): new custom Task type
        globalThis.bunVM().enqueueTask(jsc.ManagedTask.New(Context, Context.callback).init(context));
    }

    pub fn deinit(this: *@This()) void {
        if (this.hostname) |hostname| {
            hostname.deref();
        }
        this.promise.deinit();
        bun.destroy(this);
    }
};

pub fn errorToDeferred(this: c_ares.Error, syscall: []const u8, hostname: ?[]const u8, promise: *jsc.JSPromise.Strong) *ErrorDeferred {
    const host_string: ?bun.String = if (hostname) |host|
        bun.String.cloneUTF8(host)
    else
        null;
    defer promise.* = .{};
    return ErrorDeferred.init(this, syscall, host_string, promise.*);
}

pub fn errorToJSWithSyscall(this: c_ares.Error, globalThis: *jsc.JSGlobalObject, comptime syscall: [:0]const u8) bun.JSError!jsc.JSValue {
    const instance = (jsc.SystemError{
        .errno = @intFromEnum(this),
        .code = bun.String.static(this.code()[4..]),
        .syscall = bun.String.static(syscall),
        .message = bun.handleOom(bun.String.createFormat("{s} {s}", .{ syscall, this.code()[4..] })),
    }).toErrorInstance(globalThis);
    instance.put(globalThis, "name", try bun.String.static("DNSException").toJS(globalThis));
    return instance;
}

pub fn errorToJSWithSyscallAndHostname(this: c_ares.Error, globalThis: *jsc.JSGlobalObject, comptime syscall: [:0]const u8, hostname: []const u8) bun.JSError!jsc.JSValue {
    const instance = (jsc.SystemError{
        .errno = @intFromEnum(this),
        .code = bun.String.static(this.code()[4..]),
        .message = bun.handleOom(bun.String.createFormat("{s} {s} {s}", .{ syscall, this.code()[4..], hostname })),
        .syscall = bun.String.static(syscall),
        .hostname = bun.String.cloneUTF8(hostname),
    }).toErrorInstance(globalThis);
    instance.put(globalThis, "name", try bun.String.static("DNSException").toJS(globalThis));
    return instance;
}

// ── canonicalizeIP host fn ─────────────────────────────────────────────────
comptime {
    const Bun__canonicalizeIP = jsc.toJSHostFn(Bun__canonicalizeIP_);
    @export(&Bun__canonicalizeIP, .{ .name = "Bun__canonicalizeIP" });
}
pub fn Bun__canonicalizeIP_(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    jsc.markBinding(@src());

    const arguments = callframe.arguments();

    if (arguments.len == 0) {
        return globalThis.throwInvalidArguments("canonicalizeIP() expects a string but received no arguments.", .{});
    }
    // windows uses 65 bytes for ipv6 addresses and linux/macos uses 46
    const INET6_ADDRSTRLEN = if (comptime bun.Environment.isWindows) 65 else 46;

    const addr_arg = try arguments[0].toSlice(globalThis, bun.default_allocator);
    defer addr_arg.deinit();
    const addr_str = addr_arg.slice();
    if (addr_str.len >= INET6_ADDRSTRLEN)
        return .js_undefined;

    // CIDR not allowed
    if (strings.containsChar(addr_str, '/'))
        return .js_undefined;

    var ip_binary: [16]u8 = undefined; // 16 bytes is enough for both IPv4 and IPv6

    // we need a null terminated string as input
    var ip_addr: [INET6_ADDRSTRLEN + 1]u8 = undefined;
    bun.copy(u8, &ip_addr, addr_str);
    ip_addr[addr_str.len] = 0;

    var af: c_int = c_ares.AF.INET;
    // get the binary representation of the IP
    if (c_ares.ares_inet_pton(af, &ip_addr, &ip_binary) != 1) {
        af = c_ares.AF.INET6;
        if (c_ares.ares_inet_pton(af, &ip_addr, &ip_binary) != 1) {
            return .js_undefined;
        }
    }
    // ip_addr will contain the null-terminated string of the canonicalized IP
    if (c_ares.ares_inet_ntop(af, &ip_binary, &ip_addr, @sizeOf(@TypeOf(ip_addr))) == null) {
        return .js_undefined;
    }
    // use the null-terminated size to return the string
    const slice = bun.sliceTo(ip_addr[0..], 0);
    if (bun.strings.eql(addr_str, slice)) {
        return arguments[0];
    }

    return bun.String.createUTF8ForJS(globalThis, slice);
}

const std = @import("std");

const bun = @import("bun");
const c_ares = bun.c_ares;
const jsc = bun.jsc;
const strings = bun.strings;
const GetAddrInfo = bun.dns.GetAddrInfo;
