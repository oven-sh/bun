const c = @import("std").c;
const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const strings = bun.strings;
const iovec = @import("std").os.iovec;
const struct_in_addr = std.posix.sockaddr.in;
const struct_sockaddr = std.posix.sockaddr;
pub const socklen_t = c.socklen_t;
const ares_socklen_t = c.socklen_t;
pub const ares_ssize_t = isize;
pub const ares_socket_t = if (bun.Environment.isWindows) std.os.windows.ws2_32.SOCKET else c_int;
pub const ares_sock_state_cb = ?*const fn (?*anyopaque, ares_socket_t, c_int, c_int) callconv(.C) void;
pub const struct_apattern = opaque {};
const fd_set = c.fd_set;
const libuv = bun.windows.libuv;

pub const AF = std.posix.AF;

pub const NSClass = enum(c_int) {
    /// Cookie.
    ns_c_invalid = 0,
    /// Internet.
    ns_c_in = 1,
    /// unallocated/unsupported.
    ns_c_2 = 2,
    /// MIT Chaos-net.
    ns_c_chaos = 3,
    /// MIT Hesiod.
    ns_c_hs = 4,
    /// Query class values which do not appear in resource records
    /// for prereq. sections in update requests
    ns_c_none = 254,
    /// Wildcard match.
    ns_c_any = 255,
    ns_c_max = 65536,
};

pub const NSType = enum(c_int) {
    /// Cookie.
    ns_t_invalid = 0,
    /// Host address.
    ns_t_a = 1,
    /// Authoritative server.
    ns_t_ns = 2,
    /// Mail destination.
    ns_t_md = 3,
    /// Mail forwarder.
    ns_t_mf = 4,
    /// Canonical name.
    ns_t_cname = 5,
    /// Start of authority zone.
    ns_t_soa = 6,
    /// Mailbox domain name.
    ns_t_mb = 7,
    /// Mail group member.
    ns_t_mg = 8,
    /// Mail rename name.
    ns_t_mr = 9,
    /// Null resource record.
    ns_t_null = 10,
    /// Well known service.
    ns_t_wks = 11,
    /// Domain name pointer.
    ns_t_ptr = 12,
    /// Host information.
    ns_t_hinfo = 13,
    /// Mailbox information.
    ns_t_minfo = 14,
    /// Mail routing information.
    ns_t_mx = 15,
    /// Text strings.
    ns_t_txt = 16,
    /// Responsible person.
    ns_t_rp = 17,
    /// AFS cell database.
    ns_t_afsdb = 18,
    /// X_25 calling address.
    ns_t_x25 = 19,
    /// ISDN calling address.
    ns_t_isdn = 20,
    /// Router.
    ns_t_rt = 21,
    /// NSAP address.
    ns_t_nsap = 22,
    /// Reverse NSAP lookup (deprecated).
    ns_t_nsap_ptr = 23,
    /// Security signature.
    ns_t_sig = 24,
    /// Security key.
    ns_t_key = 25,
    /// X.400 mail mapping.
    ns_t_px = 26,
    /// Geographical position (withdrawn).
    ns_t_gpos = 27,
    /// Ip6 Address.
    ns_t_aaaa = 28,
    /// Location Information.
    ns_t_loc = 29,
    /// Next domain (security).
    ns_t_nxt = 30,
    /// Endpoint identifier.
    ns_t_eid = 31,
    /// Nimrod Locator.
    ns_t_nimloc = 32,
    /// Server Selection.
    ns_t_srv = 33,
    /// ATM Address
    ns_t_atma = 34,
    /// Naming Authority PoinTeR
    ns_t_naptr = 35,
    /// Key Exchange
    ns_t_kx = 36,
    /// Certification record
    ns_t_cert = 37,
    /// IPv6 address (deprecates AAAA)
    ns_t_a6 = 38,
    /// Non-terminal DNAME (for IPv6)
    ns_t_dname = 39,
    /// Kitchen sink (experimentatl)
    ns_t_sink = 40,
    /// EDNS0 option (meta-RR)
    ns_t_opt = 41,
    /// Address prefix list (RFC3123)
    ns_t_apl = 42,
    /// Delegation Signer (RFC4034)
    ns_t_ds = 43,
    /// SSH Key Fingerprint (RFC4255)
    ns_t_sshfp = 44,
    /// Resource Record Signature (RFC4034)
    ns_t_rrsig = 46,
    /// Next Secure (RFC4034)
    ns_t_nsec = 47,
    /// DNS Public Key (RFC4034)
    ns_t_dnskey = 48,
    /// Transaction key
    ns_t_tkey = 249,
    /// Transaction signature.
    ns_t_tsig = 250,
    /// Incremental zone transfer.
    ns_t_ixfr = 251,
    /// Transfer zone of authority.
    ns_t_axfr = 252,
    /// Transfer mailbox records.
    ns_t_mailb = 253,
    /// Transfer mail agent records.
    ns_t_maila = 254,
    /// Wildcard match.
    ns_t_any = 255,
    /// Uniform Resource Identifier (RFC7553)
    ns_t_uri = 256,
    /// Certification Authority Authorization.
    ns_t_caa = 257,
    ns_t_max = 65536,
    _,
};
pub const struct_ares_server_failover_options = extern struct {
    retry_chance: c_ushort = 0,
    retry_delay: usize = 0,
};
const ARES_EVSYS_DEFAULT: c_int = 0;
const ARES_EVSYS_WIN32: c_int = 1;
const ARES_EVSYS_EPOLL: c_int = 2;
const ARES_EVSYS_KQUEUE: c_int = 3;
const ARES_EVSYS_POLL: c_int = 4;
const ARES_EVSYS_SELECT: c_int = 5;
const ares_evsys_t = c_uint;
pub const Options = extern struct {
    flags: c_int = 0,
    timeout: c_int = 0,
    tries: c_int = 0,
    ndots: c_int = 0,
    udp_port: c_ushort = 0,
    tcp_port: c_ushort = 0,
    socket_send_buffer_size: c_int = 0,
    socket_receive_buffer_size: c_int = 0,
    servers: [*c]struct_in_addr = null,
    nservers: c_int = 0,
    domains: ?[*][*:0]u8 = null,
    ndomains: c_int = 0,
    lookups: ?[*:0]u8 = null,
    sock_state_cb: ares_sock_state_cb = null,
    sock_state_cb_data: ?*anyopaque = null,
    sortlist: ?*struct_apattern = null,
    nsort: c_int = 0,
    ednspsz: c_int = 0,
    resolvconf_path: ?[*:0]u8 = null,
    hosts_path: ?[*:0]u8 = null,
    udp_max_queries: c_int = 0,
    maxtimeout: c_int = 0,
    qcache_max_ttl: c_uint = 0,
    evsys: ares_evsys_t = 0,
    server_failover_opts: struct_ares_server_failover_options = @import("std").mem.zeroes(struct_ares_server_failover_options),
};
pub const struct_hostent = extern struct {
    h_name: [*c]u8,
    h_aliases: [*c][*c]u8,
    h_addrtype: c_int,
    h_length: c_int,
    h_addr_list: [*c][*c]u8,

    pub fn toJSResponse(this: *struct_hostent, _: std.mem.Allocator, globalThis: *JSC.JSGlobalObject, comptime lookup_name: []const u8) JSC.JSValue {

        // A cname lookup always returns a single record but we follow the common API here.
        if (comptime strings.eqlComptime(lookup_name, "cname")) {
            if (this.h_name != null) {
                const array = JSC.JSValue.createEmptyArray(globalThis, 1);
                const h_name_len = bun.len(this.h_name);
                const h_name_slice = this.h_name[0..h_name_len];
                array.putIndex(globalThis, 0, JSC.ZigString.fromUTF8(h_name_slice).toJS(globalThis));
                return array;
            }
            return JSC.JSValue.createEmptyArray(globalThis, 0);
        } else {
            if (this.h_aliases == null) {
                return JSC.JSValue.createEmptyArray(globalThis, 0);
            }

            var count: u32 = 0;
            while (this.h_aliases[count] != null) {
                count += 1;
            }

            const array = JSC.JSValue.createEmptyArray(globalThis, count);
            count = 0;

            while (this.h_aliases[count]) |alias| {
                const alias_len = bun.len(alias);
                const alias_slice = alias[0..alias_len];
                array.putIndex(globalThis, count, JSC.ZigString.fromUTF8(alias_slice).toJS(globalThis));
                count += 1;
            }

            return array;
        }
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, results: ?*struct_hostent) void;
    }

    pub fn hostCallbackWrapper(
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_host_callback {
        return &struct {
            pub fn handle(ctx: ?*anyopaque, status: c_int, timeouts: c_int, hostent: ?*struct_hostent) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }
                function(this, null, timeouts, hostent);
            }
        }.handle;
    }

    pub fn callbackWrapper(
        comptime lookup_name: []const u8,
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_callback {
        return &struct {
            pub fn handle(ctx: ?*anyopaque, status: c_int, timeouts: c_int, buffer: [*c]u8, buffer_length: c_int) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }

                var start: [*c]struct_hostent = undefined;
                if (comptime strings.eqlComptime(lookup_name, "ns")) {
                    const result = ares_parse_ns_reply(buffer, buffer_length, &start);
                    if (result != ARES_SUCCESS) {
                        function(this, Error.get(result), timeouts, null);
                        return;
                    }
                    function(this, null, timeouts, start);
                } else if (comptime strings.eqlComptime(lookup_name, "ptr")) {
                    const result = ares_parse_ptr_reply(buffer, buffer_length, null, 0, AF.INET, &start);
                    if (result != ARES_SUCCESS) {
                        function(this, Error.get(result), timeouts, null);
                        return;
                    }
                    function(this, null, timeouts, start);
                } else if (comptime strings.eqlComptime(lookup_name, "cname")) {
                    var addrttls: [256]struct_ares_addrttl = undefined;
                    var naddrttls: i32 = 256;

                    const result = ares_parse_a_reply(buffer, buffer_length, &start, &addrttls, &naddrttls);
                    if (result != ARES_SUCCESS) {
                        function(this, Error.get(result), timeouts, null);
                        return;
                    }
                    function(this, null, timeouts, start);
                }
            }
        }.handle;
    }

    pub fn deinit(this: *struct_hostent) void {
        ares_free_hostent(this);
    }
};

pub const struct_nameinfo = extern struct {
    node: [*c]u8,
    service: [*c]u8,

    pub fn toJSResponse(this: *struct_nameinfo, _: std.mem.Allocator, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const array = JSC.JSValue.createEmptyArray(globalThis, 2); // [node, service]

        if (this.node != null) {
            const node_len = bun.len(this.node);
            const node_slice = this.node[0..node_len];
            array.putIndex(globalThis, 0, JSC.ZigString.fromUTF8(node_slice).toJS(globalThis));
        } else {
            array.putIndex(globalThis, 0, JSC.JSValue.jsUndefined());
        }

        if (this.service != null) {
            const service_len = bun.len(this.service);
            const service_slice = this.service[0..service_len];
            array.putIndex(globalThis, 1, JSC.ZigString.fromUTF8(service_slice).toJS(globalThis));
        } else {
            array.putIndex(globalThis, 1, JSC.JSValue.jsUndefined());
        }

        return array;
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, node: ?struct_nameinfo) void;
    }

    pub fn CallbackWrapper(
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_nameinfo_callback {
        return &struct {
            pub fn handle(ctx: ?*anyopaque, status: c_int, timeouts: c_int, node: [*c]u8, service: [*c]u8) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }
                function(this, null, timeouts, .{ .node = node, .service = service });
                return;
            }
        }.handle;
    }
};

pub const struct_timeval = opaque {};
pub const struct_Channeldata = opaque {};
pub const AddrInfo_cname = extern struct {
    ttl: c_int,
    alias: [*c]u8,
    name: [*c]u8,
    next: [*c]AddrInfo_cname,
};
pub const AddrInfo_node = extern struct {
    ttl: c_int = 0,
    flags: c_int = 0,
    family: c_int = 0,
    socktype: c_int = 0,
    protocol: c_int = 0,
    addrlen: ares_socklen_t,
    addr: ?*struct_sockaddr = null,
    next: ?*AddrInfo_node = null,

    pub fn count(this: *AddrInfo_node) u32 {
        var len: u32 = 0;
        var node: ?*AddrInfo_node = this;
        while (node != null) : (node = node.?.next) {
            len += 1;
        }
        return len;
    }
};

pub const AddrInfo = extern struct {
    cnames_: [*c]AddrInfo_cname = null,
    node: ?*AddrInfo_node = null,
    name_: ?[*:0]u8 = null,

    pub fn toJSArray(
        addr_info: *AddrInfo,
        globalThis: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        var node = addr_info.node orelse return JSC.JSValue.createEmptyArray(globalThis, 0);
        const array = JSC.JSValue.createEmptyArray(
            globalThis,
            node.count(),
        );

        {
            var j: u32 = 0;
            var current: ?*AddrInfo_node = addr_info.node;
            while (current) |this_node| : (current = this_node.next) {
                array.putIndex(
                    globalThis,
                    j,
                    GetAddrInfo.Result.toJS(
                        &.{
                            .address = switch (this_node.family) {
                                AF.INET => std.net.Address{ .in = .{ .sa = bun.cast(*const std.posix.sockaddr.in, this_node.addr.?).* } },
                                AF.INET6 => std.net.Address{ .in6 = .{ .sa = bun.cast(*const std.posix.sockaddr.in6, this_node.addr.?).* } },
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

    pub inline fn name(this: *const AddrInfo) []const u8 {
        const name_ = this.name_ orelse return "";
        return bun.span(name_);
    }

    pub inline fn cnames(this: *const AddrInfo) []const AddrInfo_node {
        const cnames_ = this.cnames_ orelse return &.{};
        return bun.span(cnames_);
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, results: ?*AddrInfo) void;
    }

    pub fn callbackWrapper(
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_addrinfo_callback {
        return &struct {
            pub fn handleAddrInfo(ctx: ?*anyopaque, status: c_int, timeouts: c_int, addr_info: ?*AddrInfo) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);

                function(this, Error.get(status), timeouts, addr_info);
            }
        }.handleAddrInfo;
    }

    pub fn deinit(this: *AddrInfo) void {
        ares_freeaddrinfo(this);
    }
};
pub const AddrInfo_hints = extern struct {
    ai_flags: c_int = 0,
    ai_family: c_int = 0,
    ai_socktype: c_int = 0,
    ai_protocol: c_int = 0,

    pub fn isEmpty(this: AddrInfo_hints) bool {
        return this.ai_flags == 0 and this.ai_family == 0 and this.ai_socktype == 0 and this.ai_protocol == 0;
    }
};

pub const Channel = opaque {
    pub fn init(comptime Container: type, this: *Container) ?Error {
        var channel: *Channel = undefined;

        libraryInit();

        if (Error.get(ares_init(&channel))) |err| {
            return err;
        }
        const SockStateWrap = struct {
            pub fn onSockState(ctx: ?*anyopaque, socket: ares_socket_t, readable: c_int, writable: c_int) callconv(.C) void {
                const container = bun.cast(*Container, ctx.?);
                Container.onDNSSocketState(container, socket, readable != 0, writable != 0);
            }
        };

        var opts = bun.zero(Options);

        opts.flags = ARES_FLAG_NOCHECKRESP;
        opts.sock_state_cb = &SockStateWrap.onSockState;
        opts.sock_state_cb_data = @as(*anyopaque, @ptrCast(this));
        opts.timeout = -1;
        opts.tries = 4;

        const optmask: c_int =
            ARES_OPT_FLAGS | ARES_OPT_TIMEOUTMS |
            ARES_OPT_SOCK_STATE_CB | ARES_OPT_TRIES;

        if (Error.get(ares_init_options(&channel, &opts, optmask))) |err| {
            ares_library_cleanup();
            return err;
        }

        this.channel = channel;
        return null;
    }

    ///
    ///The ares_getaddrinfo function initiates a host query by name on the name service channel identified by channel. The name and service parameters give the hostname and service as NULL-terminated C strings. The hints parameter is an ares_addrinfo_hints structure:
    ///
    ///struct ares_addrinfo_hints {   int ai_flags;   int ai_family;   int ai_socktype;   int ai_protocol; };
    ///
    ///ai_family Specifies desired address family. AF_UNSPEC means return both AF_INET and AF_INET6.
    ///
    ///ai_socktype Specifies desired socket type, for example SOCK_STREAM or SOCK_DGRAM. Setting this to 0 means any type.
    ///
    ///ai_protocol Setting this to 0 means any protocol.
    ///
    ///ai_flags Specifies additional options, see below.
    ///
    ///ARES_AI_NUMERICSERV If this option is set service field will be treated as a numeric value.
    ///
    ///ARES_AI_CANONNAME The ares_addrinfo structure will return a canonical names list.
    ///
    ///ARES_AI_NOSORT Result addresses will not be sorted and no connections to resolved addresses will be attempted.
    ///
    ///ARES_AI_ENVHOSTS Read hosts file path from the environment variable CARES_HOSTS .
    ///
    ///When the query is complete or has failed, the ares library will invoke callback. Completion or failure of the query may happen immediately, or may happen during a later call to ares_process, ares_destroy or ares_cancel.
    ///
    ///The callback argument arg is copied from the ares_getaddrinfo argument arg. The callback argument status indicates whether the query succeeded and, if not, how it failed. It may have any of the following values:
    ///
    ///ARES_SUCCESS The host lookup completed successfully.
    ///
    ///ARES_ENOTIMP The ares library does not know how to find addresses of type family.
    ///
    ///ARES_ENOTFOUND The name was not found.
    ///
    ///ARES_ENOMEM Memory was exhausted.
    ///
    ///ARES_ECANCELLED The query was cancelled.
    ///
    ///ARES_EDESTRUCTION The name service channel channel is being destroyed; the query will not be completed.
    ///
    ///On successful completion of the query, the callback argument result points to a struct ares_addrinfo which contains two linked lists, one with resolved addresses and another with canonical names. Also included is the official name of the host (analogous to gethostbyname() h_name).
    ///
    ///struct ares_addrinfo {   struct ares_addrinfo_cname *cnames;   struct ares_addrinfo_node *nodes;   char *name; };
    ///
    ///ares_addrinfo_node structure is similar to RFC 3493 addrinfo, but without canonname and with extra ttl field.
    ///
    ///struct ares_addrinfo_node {   int ai_ttl;   int ai_flags;   int ai_family;   int ai_socktype;   int ai_protocol;   ares_socklen_t ai_addrlen;   struct sockaddr *ai_addr;   struct ares_addrinfo_node *ai_next; };
    ///
    ///ares_addrinfo_cname structure is a linked list of CNAME records where ttl is a time to live alias is a label of the resource record and name is a value (canonical name) of the resource record. See RFC 2181 10.1.1. CNAME terminology.
    ///
    ///struct ares_addrinfo_cname {   int ttl;   char *alias;   char *name;   struct ares_addrinfo_cname *next; };
    ///
    ///The reserved memory has to be deleted by ares_freeaddrinfo.
    ///
    ///The result is sorted according to RFC 6724 except:  - Rule 3 (Avoid deprecated addresses)  - Rule 4 (Prefer home addresses)  - Rule 7 (Prefer native transport)
    ///
    ///Please note that the function will attempt a connection on each of the resolved addresses as per RFC 6724.
    ///
    pub fn getAddrInfo(this: *Channel, host: []const u8, port: u16, hints: []const AddrInfo_hints, comptime Type: type, ctx: *Type, comptime callback: AddrInfo.Callback(Type)) void {
        var host_buf: [1024]u8 = undefined;
        var port_buf: [52]u8 = undefined;
        const host_ptr: ?[*:0]const u8 = brk: {
            const len = @min(host.len, host_buf.len - 1);
            @memcpy(host_buf[0..len], host[0..len]);
            host_buf[len] = 0;
            break :brk host_buf[0..len :0].ptr;
        };

        const port_ptr: ?[*:0]const u8 = brk: {
            if (port == 0) {
                break :brk null;
            }

            break :brk (std.fmt.bufPrintZ(&port_buf, "{d}", .{port}) catch unreachable).ptr;
        };

        var hints_buf: [3]AddrInfo_hints = bun.zero([3]AddrInfo_hints);
        for (hints[0..@min(hints.len, 2)], 0..) |hint, i| {
            hints_buf[i] = hint;
        }
        const hints_: [*c]const AddrInfo_hints = if (hints.len > 0) &hints_buf else null;
        ares_getaddrinfo(this, host_ptr, port_ptr, hints_, AddrInfo.callbackWrapper(Type, callback), ctx);
    }

    pub fn resolve(this: *Channel, name: []const u8, comptime lookup_name: []const u8, comptime Type: type, ctx: *Type, comptime cares_type: type, comptime callback: cares_type.Callback(Type)) void {
        if (name.len >= 1023 or (name.len == 0 and !(bun.strings.eqlComptime(lookup_name, "ns") or bun.strings.eqlComptime(lookup_name, "soa")))) {
            return cares_type.callbackWrapper(lookup_name, Type, callback).?(ctx, ARES_EBADNAME, 0, null, 0);
        }

        var name_buf: [1024]u8 = undefined;
        const name_ptr: [*:0]const u8 = brk: {
            const len = @min(name.len, name_buf.len - 1);
            @memcpy(name_buf[0..len], name[0..len]);

            name_buf[len] = 0;
            break :brk name_buf[0..len :0];
        };

        const field_name = comptime std.fmt.comptimePrint("ns_t_{s}", .{lookup_name});
        ares_query(this, name_ptr, NSClass.ns_c_in, @field(NSType, field_name), cares_type.callbackWrapper(lookup_name, Type, callback), ctx);
    }

    pub fn getHostByAddr(this: *Channel, ip_addr: []const u8, comptime Type: type, ctx: *Type, comptime callback: struct_hostent.Callback(Type)) void {
        // "0000:0000:0000:0000:0000:ffff:192.168.100.228".length = 45
        const buf_size = 46;
        var addr_buf: [buf_size]u8 = undefined;
        const addr_ptr: ?[*:0]const u8 = brk: {
            if (ip_addr.len == 0 or ip_addr.len >= buf_size) {
                break :brk null;
            }
            const len = @min(ip_addr.len, addr_buf.len - 1);
            @memcpy(addr_buf[0..len], ip_addr[0..len]);

            addr_buf[len] = 0;
            break :brk addr_buf[0..len :0];
        };

        // https://c-ares.org/ares_inet_pton.html
        // https://github.com/c-ares/c-ares/blob/7f3262312f246556d8c1bdd8ccc1844847f42787/src/lib/ares_gethostbyaddr.c#L71-L72
        // `ares_inet_pton` allows passing raw bytes as `dst`,
        // which can avoid the use of `struct_in_addr` to reduce extra bytes.
        var addr: [16]u8 = undefined;
        if (addr_ptr != null) {
            if (ares_inet_pton(AF.INET, addr_ptr, &addr) > 0) {
                ares_gethostbyaddr(this, &addr, 4, AF.INET, struct_hostent.hostCallbackWrapper(Type, callback), ctx);
                return;
            } else if (ares_inet_pton(AF.INET6, addr_ptr, &addr) > 0) {
                return ares_gethostbyaddr(this, &addr, 16, AF.INET6, struct_hostent.hostCallbackWrapper(Type, callback), ctx);
            }
        }
        struct_hostent.hostCallbackWrapper(Type, callback).?(ctx, ARES_ENOTIMP, 0, null);
    }

    // https://c-ares.org/ares_getnameinfo.html
    pub fn getNameInfo(this: *Channel, sa: *std.posix.sockaddr, comptime Type: type, ctx: *Type, comptime callback: struct_nameinfo.Callback(Type)) void {
        return ares_getnameinfo(
            this,
            sa,
            if (sa.*.family == AF.INET) @sizeOf(std.posix.sockaddr.in) else @sizeOf(std.posix.sockaddr.in6),
            // node returns ENOTFOUND for addresses like 255.255.255.255:80
            // So, it requires setting the ARES_NI_NAMEREQD flag
            ARES_NI_NAMEREQD | ARES_NI_LOOKUPHOST | ARES_NI_LOOKUPSERVICE,
            struct_nameinfo.CallbackWrapper(Type, callback),
            ctx,
        );
    }

    pub inline fn process(this: *Channel, fd: ares_socket_t, readable: bool, writable: bool) void {
        ares_process_fd(
            this,
            if (readable) fd else ARES_SOCKET_BAD,
            if (writable) fd else ARES_SOCKET_BAD,
        );
    }
};

var ares_has_loaded = std.atomic.Value(bool).init(false);
fn libraryInit() void {
    if (ares_has_loaded.swap(true, .monotonic))
        return;

    const rc = ares_library_init_mem(
        ARES_LIB_INIT_ALL,
        bun.Mimalloc.mi_malloc,
        bun.Mimalloc.mi_free,
        bun.Mimalloc.mi_realloc,
    );
    if (rc != ARES_SUCCESS) {
        std.debug.panic("ares_library_init_mem failed: {any}", .{rc});
        unreachable;
    }
}

pub const ares_callback = ?*const fn (?*anyopaque, c_int, c_int, [*c]u8, c_int) callconv(.C) void;
pub const ares_host_callback = ?*const fn (?*anyopaque, c_int, c_int, ?*struct_hostent) callconv(.C) void;
pub const ares_nameinfo_callback = ?*const fn (?*anyopaque, c_int, c_int, [*c]u8, [*c]u8) callconv(.C) void;
pub const ares_sock_create_callback = ?*const fn (ares_socket_t, c_int, ?*anyopaque) callconv(.C) c_int;
pub const ares_sock_config_callback = ?*const fn (ares_socket_t, c_int, ?*anyopaque) callconv(.C) c_int;
pub const ares_addrinfo_callback = *const fn (?*anyopaque, c_int, c_int, ?*AddrInfo) callconv(.C) void;
pub extern fn ares_library_init(flags: c_int) c_int;
pub extern fn ares_library_init_mem(flags: c_int, amalloc: ?*const fn (usize) callconv(.C) ?*anyopaque, afree: ?*const fn (?*anyopaque) callconv(.C) void, arealloc: ?*const fn (?*anyopaque, usize) callconv(.C) ?*anyopaque) c_int;
pub extern fn ares_library_initialized() c_int;
pub extern fn ares_library_cleanup() void;
pub extern fn ares_version(version: [*c]c_int) [*c]const u8;
pub extern fn ares_init(channelptr: **Channel) c_int;
pub extern fn ares_init_options(channelptr: **Channel, options: ?*Options, optmask: c_int) c_int;
pub extern fn ares_save_options(channel: *Channel, options: ?*Options, optmask: *c_int) c_int;
pub extern fn ares_destroy_options(options: *Options) void;
pub extern fn ares_dup(dest: ?*Channel, src: *Channel) c_int;
pub extern fn ares_destroy(channel: *Channel) void;
pub extern fn ares_cancel(channel: *Channel) void;
pub extern fn ares_set_local_ip4(channel: *Channel, local_ip: c_uint) void;
pub extern fn ares_set_local_ip6(channel: *Channel, local_ip6: [*c]const u8) void;
pub extern fn ares_set_local_dev(channel: *Channel, local_dev_name: [*c]const u8) void;
pub extern fn ares_set_socket_callback(channel: *Channel, callback: ares_sock_create_callback, user_data: ?*anyopaque) void;
pub extern fn ares_set_socket_configure_callback(channel: *Channel, callback: ares_sock_config_callback, user_data: ?*anyopaque) void;
pub extern fn ares_set_sortlist(channel: *Channel, sortstr: [*c]const u8) c_int;
pub extern fn ares_getaddrinfo(channel: *Channel, node: ?[*:0]const u8, service: ?[*:0]const u8, hints: [*c]const AddrInfo_hints, callback: ares_addrinfo_callback, arg: ?*anyopaque) void;
pub extern fn ares_freeaddrinfo(ai: *AddrInfo) void;
pub const ares_socket_functions = extern struct {
    socket: ?*const fn (c_int, c_int, c_int, ?*anyopaque) callconv(.C) ares_socket_t = null,
    close: ?*const fn (ares_socket_t, ?*anyopaque) callconv(.C) c_int = null,
    connect: ?*const fn (ares_socket_t, [*c]const struct_sockaddr, ares_socklen_t, ?*anyopaque) callconv(.C) c_int = null,
    recvfrom: ?*const fn (ares_socket_t, ?*anyopaque, usize, c_int, [*c]struct_sockaddr, [*c]ares_socklen_t, ?*anyopaque) callconv(.C) ares_ssize_t = null,
    sendv: ?*const fn (ares_socket_t, [*c]const iovec, c_int, ?*anyopaque) callconv(.C) ares_ssize_t = null,
};
pub extern fn ares_set_socket_functions(channel: *Channel, funcs: ?*const ares_socket_functions, user_data: ?*anyopaque) void;
pub extern fn ares_send(channel: *Channel, qbuf: [*c]const u8, qlen: c_int, callback: ares_callback, arg: ?*anyopaque) void;
pub extern fn ares_query(channel: *Channel, name: [*c]const u8, dnsclass: NSClass, @"type": NSType, callback: ares_callback, arg: ?*anyopaque) void;
pub extern fn ares_search(channel: *Channel, name: [*c]const u8, dnsclass: c_int, @"type": c_int, callback: ares_callback, arg: ?*anyopaque) void;
pub extern fn ares_gethostbyname(channel: *Channel, name: [*c]const u8, family: c_int, callback: ares_host_callback, arg: ?*anyopaque) void;
pub extern fn ares_gethostbyname_file(channel: *Channel, name: [*c]const u8, family: c_int, host: [*:null]?*struct_hostent) c_int;
pub extern fn ares_gethostbyaddr(channel: *Channel, addr: ?*const anyopaque, addrlen: c_int, family: c_int, callback: ares_host_callback, arg: ?*anyopaque) void;
pub extern fn ares_getnameinfo(channel: *Channel, sa: [*c]const struct_sockaddr, salen: ares_socklen_t, flags: c_int, callback: ares_nameinfo_callback, arg: ?*anyopaque) void;
// pub extern fn ares_fds(channel: *Channel, read_fds: *fd_set, write_fds: *fd_set) c_int;
pub extern fn ares_getsock(channel: *Channel, socks: [*c]ares_socket_t, numsocks: c_int) c_int;
pub extern fn ares_timeout(channel: *Channel, maxtv: ?*struct_timeval, tv: ?*struct_timeval) ?*struct_timeval;
// pub extern fn ares_process(channel: *Channel, read_fds: *fd_set, write_fds: *fd_set) void;
pub extern fn ares_process_fd(channel: *Channel, read_fd: ares_socket_t, write_fd: ares_socket_t) void;
pub extern fn ares_create_query(name: [*c]const u8, dnsclass: c_int, @"type": c_int, id: c_ushort, rd: c_int, buf: [*c][*c]u8, buflen: [*c]c_int, max_udp_size: c_int) c_int;
pub extern fn ares_mkquery(name: [*c]const u8, dnsclass: c_int, @"type": c_int, id: c_ushort, rd: c_int, buf: [*c][*c]u8, buflen: [*c]c_int) c_int;
pub extern fn ares_expand_name(encoded: [*c]const u8, abuf: [*c]const u8, alen: c_int, s: [*c][*c]u8, enclen: [*c]c_long) c_int;
pub extern fn ares_expand_string(encoded: [*c]const u8, abuf: [*c]const u8, alen: c_int, s: [*c][*c]u8, enclen: [*c]c_long) c_int;
const union_unnamed_2 = extern union {
    _S6_u8: [16]u8,
};
pub const struct_ares_in6_addr = extern struct {
    _S6_un: union_unnamed_2,
};
pub const struct_ares_addrttl = extern struct {
    ipaddr: struct_in_addr,
    ttl: c_int,
};
pub const struct_ares_addr6ttl = extern struct {
    ip6addr: struct_ares_in6_addr,
    ttl: c_int,
};
pub const struct_ares_caa_reply = extern struct {
    next: ?*struct_ares_caa_reply,
    critical: c_int,
    property: [*c]u8,
    plength: usize,
    value: [*c]u8,
    length: usize,

    pub fn toJSResponse(this: *struct_ares_caa_reply, parent_allocator: std.mem.Allocator, globalThis: *JSC.JSGlobalObject, comptime _: []const u8) JSC.JSValue {
        var stack = std.heap.stackFallback(2048, parent_allocator);
        var arena = bun.ArenaAllocator.init(stack.get());
        defer arena.deinit();

        const allocator = arena.allocator();
        var count: usize = 0;
        var caa: ?*struct_ares_caa_reply = this;
        while (caa != null) : (caa = caa.?.next) {
            count += 1;
        }

        const array = JSC.JSValue.createEmptyArray(globalThis, count);

        caa = this;
        var i: u32 = 0;
        while (caa != null) {
            var node = caa.?;
            array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
            caa = node.next;
            i += 1;
        }

        return array;
    }

    pub fn toJS(this: *struct_ares_caa_reply, globalThis: *JSC.JSGlobalObject, _: std.mem.Allocator) JSC.JSValue {
        var obj = JSC.JSValue.createEmptyObject(globalThis, 2);

        obj.put(globalThis, JSC.ZigString.static("critical"), JSC.JSValue.jsNumber(this.critical));

        const property = this.property[0..this.plength];
        const value = this.value[0..this.length];
        const property_str = JSC.ZigString.fromUTF8(property);
        obj.put(globalThis, &property_str, JSC.ZigString.fromUTF8(value).toJS(globalThis));

        return obj;
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, results: ?*struct_ares_caa_reply) void;
    }

    pub fn callbackWrapper(
        comptime _: []const u8,
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_callback {
        return &struct {
            pub fn handle(ctx: ?*anyopaque, status: c_int, timeouts: c_int, buffer: [*c]u8, buffer_length: c_int) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }

                var start: [*c]struct_ares_caa_reply = undefined;
                const result = ares_parse_caa_reply(buffer, buffer_length, &start);
                if (result != ARES_SUCCESS) {
                    function(this, Error.get(result), timeouts, null);
                    return;
                }
                function(this, null, timeouts, start);
            }
        }.handle;
    }

    pub fn deinit(this: *struct_ares_caa_reply) void {
        ares_free_data(this);
    }
};
pub const struct_ares_srv_reply = extern struct {
    next: ?*struct_ares_srv_reply,
    host: [*c]u8,
    priority: c_ushort,
    weight: c_ushort,
    port: c_ushort,

    pub fn toJSResponse(this: *struct_ares_srv_reply, parent_allocator: std.mem.Allocator, globalThis: *JSC.JSGlobalObject, comptime _: []const u8) JSC.JSValue {
        var stack = std.heap.stackFallback(2048, parent_allocator);
        var arena = bun.ArenaAllocator.init(stack.get());
        defer arena.deinit();

        const allocator = arena.allocator();
        var count: usize = 0;
        var srv: ?*struct_ares_srv_reply = this;
        while (srv != null) : (srv = srv.?.next) {
            count += 1;
        }

        const array = JSC.JSValue.createEmptyArray(globalThis, count);

        srv = this;
        var i: u32 = 0;
        while (srv != null) {
            var node = srv.?;
            array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
            srv = node.next;
            i += 1;
        }

        return array;
    }

    pub fn toJS(this: *struct_ares_srv_reply, globalThis: *JSC.JSGlobalObject, _: std.mem.Allocator) JSC.JSValue {
        const obj = JSC.JSValue.createEmptyObject(globalThis, 4);
        // {
        //   priority: 10,
        //   weight: 5,
        //   port: 21223,
        //   name: 'service.example.com'
        // }

        obj.put(globalThis, JSC.ZigString.static("priority"), JSC.JSValue.jsNumber(this.weight));
        obj.put(globalThis, JSC.ZigString.static("weight"), JSC.JSValue.jsNumber(this.weight));
        obj.put(globalThis, JSC.ZigString.static("port"), JSC.JSValue.jsNumber(this.port));

        const len = bun.len(this.host);
        const host = this.host[0..len];
        obj.put(globalThis, JSC.ZigString.static("name"), JSC.ZigString.fromUTF8(host).toJS(globalThis));

        return obj;
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, results: ?*struct_ares_srv_reply) void;
    }

    pub fn callbackWrapper(
        comptime _: []const u8,
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_callback {
        return &struct {
            pub fn handleSrv(ctx: ?*anyopaque, status: c_int, timeouts: c_int, buffer: [*c]u8, buffer_length: c_int) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }

                var srv_start: [*c]struct_ares_srv_reply = undefined;
                const result = ares_parse_srv_reply(buffer, buffer_length, &srv_start);
                if (result != ARES_SUCCESS) {
                    function(this, Error.get(result), timeouts, null);
                    return;
                }
                function(this, null, timeouts, srv_start);
            }
        }.handleSrv;
    }

    pub fn deinit(this: *struct_ares_srv_reply) void {
        ares_free_data(this);
    }
};
pub const struct_ares_mx_reply = extern struct {
    next: ?*struct_ares_mx_reply,
    host: [*c]u8,
    priority: c_ushort,

    pub fn toJSResponse(this: *struct_ares_mx_reply, parent_allocator: std.mem.Allocator, globalThis: *JSC.JSGlobalObject, comptime _: []const u8) JSC.JSValue {
        var stack = std.heap.stackFallback(2048, parent_allocator);
        var arena = bun.ArenaAllocator.init(stack.get());
        defer arena.deinit();

        const allocator = arena.allocator();
        var count: usize = 0;
        var mx: ?*struct_ares_mx_reply = this;
        while (mx != null) : (mx = mx.?.next) {
            count += 1;
        }

        const array = JSC.JSValue.createEmptyArray(globalThis, count);

        mx = this;
        var i: u32 = 0;
        while (mx != null) {
            var node = mx.?;
            array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
            mx = node.next;
            i += 1;
        }

        return array;
    }

    pub fn toJS(this: *struct_ares_mx_reply, globalThis: *JSC.JSGlobalObject, _: std.mem.Allocator) JSC.JSValue {
        const obj = JSC.JSValue.createEmptyObject(globalThis, 2);
        obj.put(globalThis, JSC.ZigString.static("priority"), JSC.JSValue.jsNumber(this.priority));

        const host_len = bun.len(this.host);
        const host = this.host[0..host_len];
        obj.put(globalThis, JSC.ZigString.static("exchange"), JSC.ZigString.fromUTF8(host).toJS(globalThis));

        return obj;
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, results: ?*struct_ares_mx_reply) void;
    }

    pub fn callbackWrapper(
        comptime _: []const u8,
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_callback {
        return &struct {
            pub fn handle(ctx: ?*anyopaque, status: c_int, timeouts: c_int, buffer: [*c]u8, buffer_length: c_int) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }

                var start: [*c]struct_ares_mx_reply = undefined;
                const result = ares_parse_mx_reply(buffer, buffer_length, &start);
                if (result != ARES_SUCCESS) {
                    function(this, Error.get(result), timeouts, null);
                    return;
                }
                function(this, null, timeouts, start);
            }
        }.handle;
    }

    pub fn deinit(this: *struct_ares_mx_reply) void {
        ares_free_data(this);
    }
};
pub const struct_ares_txt_reply = extern struct {
    next: ?*struct_ares_txt_reply,
    txt: [*c]u8,
    length: usize,

    pub fn toJSResponse(this: *struct_ares_txt_reply, parent_allocator: std.mem.Allocator, globalThis: *JSC.JSGlobalObject, comptime _: []const u8) JSC.JSValue {
        var stack = std.heap.stackFallback(2048, parent_allocator);
        var arena = bun.ArenaAllocator.init(stack.get());
        defer arena.deinit();

        const allocator = arena.allocator();
        var count: usize = 0;
        var txt: ?*struct_ares_txt_reply = this;
        while (txt != null) : (txt = txt.?.next) {
            count += 1;
        }

        const array = JSC.JSValue.createEmptyArray(globalThis, count);

        txt = this;
        var i: u32 = 0;
        while (txt != null) {
            var node = txt.?;
            array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
            txt = node.next;
            i += 1;
        }

        return array;
    }

    pub fn toJS(this: *struct_ares_txt_reply, globalThis: *JSC.JSGlobalObject, _: std.mem.Allocator) JSC.JSValue {
        const array = JSC.JSValue.createEmptyArray(globalThis, 1);
        const value = this.txt[0..this.length];
        array.putIndex(globalThis, 0, JSC.ZigString.fromUTF8(value).toJS(globalThis));
        return array;
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, results: ?*struct_ares_txt_reply) void;
    }

    pub fn callbackWrapper(
        comptime _: []const u8,
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_callback {
        return &struct {
            pub fn handleTxt(ctx: ?*anyopaque, status: c_int, timeouts: c_int, buffer: [*c]u8, buffer_length: c_int) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }

                var srv_start: [*c]struct_ares_txt_reply = undefined;
                const result = ares_parse_txt_reply(buffer, buffer_length, &srv_start);
                if (result != ARES_SUCCESS) {
                    function(this, Error.get(result), timeouts, null);
                    return;
                }
                function(this, null, timeouts, srv_start);
            }
        }.handleTxt;
    }

    pub fn deinit(this: *struct_ares_txt_reply) void {
        ares_free_data(this);
    }
};
pub const struct_ares_txt_ext = extern struct {
    next: [*c]struct_ares_txt_ext,
    txt: [*c]u8,
    length: usize,
    record_start: u8,
};
pub const struct_ares_naptr_reply = extern struct {
    next: ?*struct_ares_naptr_reply,
    flags: [*c]u8,
    service: [*c]u8,
    regexp: [*c]u8,
    replacement: [*c]u8,
    order: c_ushort,
    preference: c_ushort,

    pub fn toJSResponse(this: *struct_ares_naptr_reply, parent_allocator: std.mem.Allocator, globalThis: *JSC.JSGlobalObject, comptime _: []const u8) JSC.JSValue {
        var stack = std.heap.stackFallback(2048, parent_allocator);
        var arena = bun.ArenaAllocator.init(stack.get());
        defer arena.deinit();

        const allocator = arena.allocator();
        var count: usize = 0;
        var naptr: ?*struct_ares_naptr_reply = this;
        while (naptr != null) : (naptr = naptr.?.next) {
            count += 1;
        }

        const array = JSC.JSValue.createEmptyArray(globalThis, count);

        naptr = this;
        var i: u32 = 0;
        while (naptr != null) {
            var node = naptr.?;
            array.putIndex(globalThis, i, node.toJS(globalThis, allocator));
            naptr = node.next;
            i += 1;
        }

        return array;
    }

    pub fn toJS(this: *struct_ares_naptr_reply, globalThis: *JSC.JSGlobalObject, _: std.mem.Allocator) JSC.JSValue {
        const obj = JSC.JSValue.createEmptyObject(globalThis, 6);

        obj.put(globalThis, JSC.ZigString.static("preference"), JSC.JSValue.jsNumber(this.preference));
        obj.put(globalThis, JSC.ZigString.static("order"), JSC.JSValue.jsNumber(this.order));

        const flags_len = bun.len(this.flags);
        const flags = this.flags[0..flags_len];
        obj.put(globalThis, JSC.ZigString.static("flags"), JSC.ZigString.fromUTF8(flags).toJS(globalThis));

        const service_len = bun.len(this.service);
        const service = this.service[0..service_len];
        obj.put(globalThis, JSC.ZigString.static("service"), JSC.ZigString.fromUTF8(service).toJS(globalThis));

        const regexp_len = bun.len(this.regexp);
        const regexp = this.regexp[0..regexp_len];
        obj.put(globalThis, JSC.ZigString.static("regexp"), JSC.ZigString.fromUTF8(regexp).toJS(globalThis));

        const replacement_len = bun.len(this.replacement);
        const replacement = this.replacement[0..replacement_len];
        obj.put(globalThis, JSC.ZigString.static("replacement"), JSC.ZigString.fromUTF8(replacement).toJS(globalThis));

        return obj;
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, results: ?*struct_ares_naptr_reply) void;
    }

    pub fn callbackWrapper(
        comptime _: []const u8,
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_callback {
        return &struct {
            pub fn handleNaptr(ctx: ?*anyopaque, status: c_int, timeouts: c_int, buffer: [*c]u8, buffer_length: c_int) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }

                var naptr_start: [*c]struct_ares_naptr_reply = undefined;
                const result = ares_parse_naptr_reply(buffer, buffer_length, &naptr_start);
                if (result != ARES_SUCCESS) {
                    function(this, Error.get(result), timeouts, null);
                    return;
                }
                function(this, null, timeouts, naptr_start);
            }
        }.handleNaptr;
    }

    pub fn deinit(this: *struct_ares_naptr_reply) void {
        ares_free_data(this);
    }
};
pub const struct_ares_soa_reply = extern struct {
    nsname: [*c]u8,
    hostmaster: [*c]u8,
    serial: c_uint,
    refresh: c_uint,
    retry: c_uint,
    expire: c_uint,
    minttl: c_uint,

    pub fn toJSResponse(this: *struct_ares_soa_reply, parent_allocator: std.mem.Allocator, globalThis: *JSC.JSGlobalObject, comptime _: []const u8) JSC.JSValue {
        var stack = std.heap.stackFallback(2048, parent_allocator);
        var arena = bun.ArenaAllocator.init(stack.get());
        defer arena.deinit();

        const allocator = arena.allocator();

        return this.toJS(globalThis, allocator);
    }

    pub fn toJS(this: *struct_ares_soa_reply, globalThis: *JSC.JSGlobalObject, _: std.mem.Allocator) JSC.JSValue {
        const obj = JSC.JSValue.createEmptyObject(globalThis, 7);

        obj.put(globalThis, JSC.ZigString.static("serial"), JSC.JSValue.jsNumber(this.serial));
        obj.put(globalThis, JSC.ZigString.static("refresh"), JSC.JSValue.jsNumber(this.refresh));
        obj.put(globalThis, JSC.ZigString.static("retry"), JSC.JSValue.jsNumber(this.retry));
        obj.put(globalThis, JSC.ZigString.static("expire"), JSC.JSValue.jsNumber(this.expire));
        obj.put(globalThis, JSC.ZigString.static("minttl"), JSC.JSValue.jsNumber(this.minttl));

        const nsname_len = bun.len(this.nsname);
        const nsname = this.nsname[0..nsname_len];
        obj.put(globalThis, JSC.ZigString.static("nsname"), JSC.ZigString.fromUTF8(nsname).toJS(globalThis));

        const hostmaster_len = bun.len(this.hostmaster);
        const hostmaster = this.hostmaster[0..hostmaster_len];
        obj.put(globalThis, JSC.ZigString.static("hostmaster"), JSC.ZigString.fromUTF8(hostmaster).toJS(globalThis));

        return obj;
    }

    pub fn Callback(comptime Type: type) type {
        return fn (*Type, status: ?Error, timeouts: i32, results: ?*struct_ares_soa_reply) void;
    }

    pub fn callbackWrapper(
        comptime _: []const u8,
        comptime Type: type,
        comptime function: Callback(Type),
    ) ares_callback {
        return &struct {
            pub fn handleSoa(ctx: ?*anyopaque, status: c_int, timeouts: c_int, buffer: [*c]u8, buffer_length: c_int) callconv(.C) void {
                const this = bun.cast(*Type, ctx.?);
                if (status != ARES_SUCCESS) {
                    function(this, Error.get(status), timeouts, null);
                    return;
                }

                var soa_start: [*c]struct_ares_soa_reply = undefined;
                const result = ares_parse_soa_reply(buffer, buffer_length, &soa_start);
                if (result != ARES_SUCCESS) {
                    function(this, Error.get(result), timeouts, null);
                    return;
                }
                function(this, null, timeouts, soa_start);
            }
        }.handleSoa;
    }

    pub fn deinit(this: *struct_ares_soa_reply) void {
        ares_free_data(this);
    }
};

pub const struct_ares_uri_reply = extern struct {
    next: [*c]struct_ares_uri_reply,
    priority: c_ushort,
    weight: c_ushort,
    uri: [*c]u8,
    ttl: c_int,
};
pub extern fn ares_parse_a_reply(abuf: [*c]const u8, alen: c_int, host: [*c]?*struct_hostent, addrttls: [*c]struct_ares_addrttl, naddrttls: [*c]c_int) c_int;
pub extern fn ares_parse_aaaa_reply(abuf: [*c]const u8, alen: c_int, host: [*c]?*struct_hostent, addrttls: [*c]struct_ares_addr6ttl, naddrttls: [*c]c_int) c_int;
pub extern fn ares_parse_caa_reply(abuf: [*c]const u8, alen: c_int, caa_out: [*c][*c]struct_ares_caa_reply) c_int;
pub extern fn ares_parse_ptr_reply(abuf: [*c]const u8, alen: c_int, addr: ?*const anyopaque, addrlen: c_int, family: c_int, host: [*c]?*struct_hostent) c_int;
pub extern fn ares_parse_ns_reply(abuf: [*c]const u8, alen: c_int, host: [*c]?*struct_hostent) c_int;
pub extern fn ares_parse_srv_reply(abuf: [*c]const u8, alen: c_int, srv_out: [*c][*c]struct_ares_srv_reply) c_int;
pub extern fn ares_parse_mx_reply(abuf: [*c]const u8, alen: c_int, mx_out: [*c][*c]struct_ares_mx_reply) c_int;
pub extern fn ares_parse_txt_reply(abuf: [*c]const u8, alen: c_int, txt_out: [*c][*c]struct_ares_txt_reply) c_int;
pub extern fn ares_parse_txt_reply_ext(abuf: [*c]const u8, alen: c_int, txt_out: [*c][*c]struct_ares_txt_ext) c_int;
pub extern fn ares_parse_naptr_reply(abuf: [*c]const u8, alen: c_int, naptr_out: [*c][*c]struct_ares_naptr_reply) c_int;
pub extern fn ares_parse_soa_reply(abuf: [*c]const u8, alen: c_int, soa_out: [*c][*c]struct_ares_soa_reply) c_int;
pub extern fn ares_parse_uri_reply(abuf: [*c]const u8, alen: c_int, uri_out: [*c][*c]struct_ares_uri_reply) c_int;
pub extern fn ares_free_string(str: ?*anyopaque) void;
pub extern fn ares_free_hostent(host: ?*struct_hostent) void;
pub extern fn ares_free_data(dataptr: ?*anyopaque) void;
pub extern fn ares_strerror(code: c_int) [*c]const u8;
const union_unnamed_3 = extern union {
    addr4: struct_in_addr,
    addr6: struct_ares_in6_addr,
};
pub const struct_ares_addr_node = extern struct {
    next: ?*struct_ares_addr_node,
    family: c_int,
    addr: union_unnamed_3,
};
const union_unnamed_4 = extern union {
    addr4: struct_in_addr,
    addr6: struct_ares_in6_addr,
};
pub const struct_ares_addr_port_node = extern struct {
    next: ?*struct_ares_addr_port_node,
    family: c_int,
    addr: union_unnamed_4,
    udp_port: c_int,
    tcp_port: c_int,
};
pub extern fn ares_set_servers(channel: *Channel, servers: [*c]struct_ares_addr_node) c_int;
pub extern fn ares_set_servers_ports(channel: *Channel, servers: [*c]struct_ares_addr_port_node) c_int;
pub extern fn ares_set_servers_csv(channel: *Channel, servers: [*c]const u8) c_int;
pub extern fn ares_set_servers_ports_csv(channel: *Channel, servers: [*c]const u8) c_int;
pub extern fn ares_get_servers(channel: *Channel, servers: *?*struct_ares_addr_port_node) c_int;
pub extern fn ares_get_servers_ports(channel: *Channel, servers: *?*struct_ares_addr_port_node) c_int;
pub extern fn ares_inet_ntop(af: c_int, src: ?*const anyopaque, dst: [*c]u8, size: ares_socklen_t) ?[*:0]const u8;
pub extern fn ares_inet_pton(af: c_int, src: [*c]const u8, dst: ?*anyopaque) c_int;
pub const ARES_SUCCESS = 0;
pub const ARES_ENODATA = 1;
pub const ARES_EFORMERR = 2;
pub const ARES_ESERVFAIL = 3;
pub const ARES_ENOTFOUND = 4;
pub const ARES_ENOTIMP = 5;
pub const ARES_EREFUSED = 6;
pub const ARES_EBADQUERY = 7;
pub const ARES_EBADNAME = 8;
pub const ARES_EBADFAMILY = 9;
pub const ARES_EBADRESP = 10;
pub const ARES_ECONNREFUSED = 11;
pub const ARES_ETIMEOUT = 12;
pub const ARES_EOF = 13;
pub const ARES_EFILE = 14;
pub const ARES_ENOMEM = 15;
pub const ARES_EDESTRUCTION = 16;
pub const ARES_EBADSTR = 17;
pub const ARES_EBADFLAGS = 18;
pub const ARES_ENONAME = 19;
pub const ARES_EBADHINTS = 20;
pub const ARES_ENOTINITIALIZED = 21;
pub const ARES_ELOADIPHLPAPI = 22;
pub const ARES_EADDRGETNETWORKPARAMS = 23;
pub const ARES_ECANCELLED = 24;
pub const ARES_ESERVICE = 25;

pub const Error = enum(i32) {
    ENODATA = ARES_ENODATA,
    EFORMERR = ARES_EFORMERR,
    ESERVFAIL = ARES_ESERVFAIL,
    ENOTFOUND = ARES_ENOTFOUND,
    ENOTIMP = ARES_ENOTIMP,
    EREFUSED = ARES_EREFUSED,
    EBADQUERY = ARES_EBADQUERY,
    EBADNAME = ARES_EBADNAME,
    EBADFAMILY = ARES_EBADFAMILY,
    EBADRESP = ARES_EBADRESP,
    ECONNREFUSED = ARES_ECONNREFUSED,
    ETIMEOUT = ARES_ETIMEOUT,
    EOF = ARES_EOF,
    EFILE = ARES_EFILE,
    ENOMEM = ARES_ENOMEM,
    EDESTRUCTION = ARES_EDESTRUCTION,
    EBADSTR = ARES_EBADSTR,
    EBADFLAGS = ARES_EBADFLAGS,
    ENONAME = ARES_ENONAME,
    EBADHINTS = ARES_EBADHINTS,
    ENOTINITIALIZED = ARES_ENOTINITIALIZED,
    ELOADIPHLPAPI = ARES_ELOADIPHLPAPI,
    EADDRGETNETWORKPARAMS = ARES_EADDRGETNETWORKPARAMS,
    ECANCELLED = ARES_ECANCELLED,
    ESERVICE = ARES_ESERVICE,

    pub fn toJS(this: Error, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const error_value = globalThis.createErrorInstance("{s}", .{this.label()});
        error_value.put(
            globalThis,
            JSC.ZigString.static("name"),
            JSC.ZigString.init("DNSException").toJS(globalThis),
        );
        error_value.put(
            globalThis,
            JSC.ZigString.static("code"),
            JSC.ZigString.init(this.code()).toJS(globalThis),
        );
        error_value.put(
            globalThis,
            JSC.ZigString.static("errno"),
            JSC.jsNumber(@intFromEnum(this)),
        );
        return error_value;
    }

    pub fn initEAI(rc: i32) ?Error {
        if (comptime bun.Environment.isWindows) {
            // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
            if (rc == libuv.UV_EAI_NODATA or rc == libuv.UV_EAI_NONAME) {
                return Error.ENOTFOUND;
            }

            // TODO: revisit this
            return switch (rc) {
                0 => null,
                libuv.UV_EAI_AGAIN => Error.ETIMEOUT,
                libuv.UV_EAI_ADDRFAMILY => Error.EBADFAMILY,
                libuv.UV_EAI_BADFLAGS => Error.EBADFLAGS,
                libuv.UV_EAI_BADHINTS => Error.EBADHINTS,
                libuv.UV_EAI_CANCELED => Error.ECANCELLED,
                libuv.UV_EAI_FAIL => Error.ENOTFOUND,
                libuv.UV_EAI_FAMILY => Error.EBADFAMILY,
                libuv.UV_EAI_MEMORY => Error.ENOMEM,
                libuv.UV_EAI_NODATA => Error.ENODATA,
                libuv.UV_EAI_NONAME => Error.ENONAME,
                libuv.UV_EAI_OVERFLOW => Error.ENOMEM,
                libuv.UV_EAI_PROTOCOL => Error.EBADQUERY,
                libuv.UV_EAI_SERVICE => Error.ESERVICE,
                libuv.UV_EAI_SOCKTYPE => Error.ECONNREFUSED,
                else => Error.ENOTFOUND, //UV_ENOENT and non documented errors
            };
        }

        const eai: std.posix.system.EAI = @enumFromInt(rc);

        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
        if (eai == .NODATA or eai == .NONAME) {
            return Error.ENOTFOUND;
        }

        if (comptime bun.Environment.isLinux) {
            switch (eai) {
                .SOCKTYPE => return Error.ECONNREFUSED,
                .IDN_ENCODE => return Error.EBADSTR,
                .ALLDONE => return Error.ENOTFOUND,
                .INPROGRESS => return Error.ETIMEOUT,
                .CANCELED => return Error.ECANCELLED,
                .NOTCANCELED => return Error.ECANCELLED,
                else => {},
            }
        }

        return switch (eai) {
            @as(std.posix.system.EAI, @enumFromInt(0)) => return null,
            .ADDRFAMILY => Error.EBADFAMILY,
            .BADFLAGS => Error.EBADFLAGS, // Invalid hints
            .FAIL => Error.EBADRESP,
            .FAMILY => Error.EBADFAMILY,
            .MEMORY => Error.ENOMEM,
            .SERVICE => Error.ESERVICE,
            .SYSTEM => Error.ESERVFAIL,
            else => bun.todo(@src(), Error.ENOTIMP),
        };
    }

    pub const code = bun.enumMap(Error, .{
        .{ .ENODATA, "DNS_ENODATA" },
        .{ .EFORMERR, "DNS_EFORMERR" },
        .{ .ESERVFAIL, "DNS_ESERVFAIL" },
        .{ .ENOTFOUND, "DNS_ENOTFOUND" },
        .{ .ENOTIMP, "DNS_ENOTIMP" },
        .{ .EREFUSED, "DNS_EREFUSED" },
        .{ .EBADQUERY, "DNS_EBADQUERY" },
        .{ .EBADNAME, "DNS_ENOTFOUND" },
        .{ .EBADFAMILY, "DNS_EBADFAMILY" },
        .{ .EBADRESP, "DNS_EBADRESP" },
        .{ .ECONNREFUSED, "DNS_ECONNREFUSED" },
        .{ .ETIMEOUT, "DNS_ETIMEOUT" },
        .{ .EOF, "DNS_EOF" },
        .{ .EFILE, "DNS_EFILE" },
        .{ .ENOMEM, "DNS_ENOMEM" },
        .{ .EDESTRUCTION, "DNS_EDESTRUCTION" },
        .{ .EBADSTR, "DNS_EBADSTR" },
        .{ .EBADFLAGS, "DNS_EBADFLAGS" },
        .{ .ENONAME, "DNS_ENOTFOUND" },
        .{ .EBADHINTS, "DNS_EBADHINTS" },
        .{ .ENOTINITIALIZED, "DNS_ENOTINITIALIZED" },
        .{ .ELOADIPHLPAPI, "DNS_ELOADIPHLPAPI" },
        .{ .EADDRGETNETWORKPARAMS, "DNS_EADDRGETNETWORKPARAMS" },
        .{ .ECANCELLED, "DNS_ECANCELLED" },
        .{ .ESERVICE, "DNS_ESERVICE" },
    });

    pub const label = bun.enumMap(Error, .{
        .{ .ENODATA, "No data record of requested type" },
        .{ .EFORMERR, "Malformed DNS query" },
        .{ .ESERVFAIL, "Server failed to complete the DNS operation" },
        .{ .ENOTFOUND, "Domain name not found" },
        .{ .ENOTIMP, "DNS resolver does not implement requested operation" },
        .{ .EREFUSED, "DNS operation refused" },
        .{ .EBADQUERY, "Misformatted DNS query" },
        .{ .EBADNAME, "Misformatted domain name" },
        .{ .EBADFAMILY, "Misformatted DNS query (family)" },
        .{ .EBADRESP, "Misformatted DNS reply" },
        .{ .ECONNREFUSED, "Could not contact DNS servers" },
        .{ .ETIMEOUT, "Timeout while contacting DNS servers" },
        .{ .EOF, "End of file" },
        .{ .EFILE, "Error reading file" },
        .{ .ENOMEM, "Out of memory" },
        .{ .EDESTRUCTION, "Channel is being destroyed" },
        .{ .EBADSTR, "Misformatted string" },
        .{ .EBADFLAGS, "Illegal flags specified" },
        .{ .ENONAME, "Given hostname is not numeric" },
        .{ .EBADHINTS, "Illegal hints flags specified" },
        .{ .ENOTINITIALIZED, "Library initialization not yet performed" },
        .{ .ELOADIPHLPAPI, "ELOADIPHLPAPI TODO WHAT DOES THIS MEAN" },
        .{ .EADDRGETNETWORKPARAMS, "EADDRGETNETWORKPARAMS" },
        .{ .ECANCELLED, "DNS query cancelled" },
        .{ .ESERVICE, "Service not available" },
    });

    pub fn get(rc: i32) ?Error {
        // https://github.com/nodejs/node/blob/2eff28fb7a93d3f672f80b582f664a7c701569fb/lib/internal/errors.js#L807-L815
        if (rc == ARES_ENODATA or rc == ARES_ENONAME) {
            return get(ARES_ENOTFOUND);
        }

        return switch (rc) {
            0 => null,
            1...ARES_ESERVICE => @as(Error, @enumFromInt(rc)),
            -ARES_ESERVICE...-1 => @as(Error, @enumFromInt(-rc)),
            else => unreachable,
        };
    }
};

pub const ARES_FLAG_USEVC = @as(c_int, 1) << @as(c_int, 0);
pub const ARES_FLAG_PRIMARY = @as(c_int, 1) << @as(c_int, 1);
pub const ARES_FLAG_IGNTC = @as(c_int, 1) << @as(c_int, 2);
pub const ARES_FLAG_NORECURSE = @as(c_int, 1) << @as(c_int, 3);
pub const ARES_FLAG_STAYOPEN = @as(c_int, 1) << @as(c_int, 4);
pub const ARES_FLAG_NOSEARCH = @as(c_int, 1) << @as(c_int, 5);
pub const ARES_FLAG_NOALIASES = @as(c_int, 1) << @as(c_int, 6);
pub const ARES_FLAG_NOCHECKRESP = @as(c_int, 1) << @as(c_int, 7);
pub const ARES_FLAG_EDNS = @as(c_int, 1) << @as(c_int, 8);
pub const ARES_OPT_FLAGS = @as(c_int, 1) << @as(c_int, 0);
pub const ARES_OPT_TIMEOUT = @as(c_int, 1) << @as(c_int, 1);
pub const ARES_OPT_TRIES = @as(c_int, 1) << @as(c_int, 2);
pub const ARES_OPT_NDOTS = @as(c_int, 1) << @as(c_int, 3);
pub const ARES_OPT_UDP_PORT = @as(c_int, 1) << @as(c_int, 4);
pub const ARES_OPT_TCP_PORT = @as(c_int, 1) << @as(c_int, 5);
pub const ARES_OPT_SERVERS = @as(c_int, 1) << @as(c_int, 6);
pub const ARES_OPT_DOMAINS = @as(c_int, 1) << @as(c_int, 7);
pub const ARES_OPT_LOOKUPS = @as(c_int, 1) << @as(c_int, 8);
pub const ARES_OPT_SOCK_STATE_CB = @as(c_int, 1) << @as(c_int, 9);
pub const ARES_OPT_SORTLIST = @as(c_int, 1) << @as(c_int, 10);
pub const ARES_OPT_SOCK_SNDBUF = @as(c_int, 1) << @as(c_int, 11);
pub const ARES_OPT_SOCK_RCVBUF = @as(c_int, 1) << @as(c_int, 12);
pub const ARES_OPT_TIMEOUTMS = @as(c_int, 1) << @as(c_int, 13);
pub const ARES_OPT_ROTATE = @as(c_int, 1) << @as(c_int, 14);
pub const ARES_OPT_EDNSPSZ = @as(c_int, 1) << @as(c_int, 15);
pub const ARES_OPT_NOROTATE = @as(c_int, 1) << @as(c_int, 16);
pub const ARES_OPT_RESOLVCONF = @as(c_int, 1) << @as(c_int, 17);
pub const ARES_OPT_HOSTS_FILE = @as(c_int, 1) << @as(c_int, 18);
pub const ARES_NI_NOFQDN = @as(c_int, 1) << @as(c_int, 0);
pub const ARES_NI_NUMERICHOST = @as(c_int, 1) << @as(c_int, 1);
pub const ARES_NI_NAMEREQD = @as(c_int, 1) << @as(c_int, 2);
pub const ARES_NI_NUMERICSERV = @as(c_int, 1) << @as(c_int, 3);
pub const ARES_NI_DGRAM = @as(c_int, 1) << @as(c_int, 4);
pub const ARES_NI_TCP = @as(c_int, 0);
pub const ARES_NI_UDP = ARES_NI_DGRAM;
pub const ARES_NI_SCTP = @as(c_int, 1) << @as(c_int, 5);
pub const ARES_NI_DCCP = @as(c_int, 1) << @as(c_int, 6);
pub const ARES_NI_NUMERICSCOPE = @as(c_int, 1) << @as(c_int, 7);
pub const ARES_NI_LOOKUPHOST = @as(c_int, 1) << @as(c_int, 8);
pub const ARES_NI_LOOKUPSERVICE = @as(c_int, 1) << @as(c_int, 9);
pub const ARES_NI_IDN = @as(c_int, 1) << @as(c_int, 10);
pub const ARES_NI_IDN_ALLOW_UNASSIGNED = @as(c_int, 1) << @as(c_int, 11);
pub const ARES_NI_IDN_USE_STD3_ASCII_RULES = @as(c_int, 1) << @as(c_int, 12);
pub const ARES_AI_CANONNAME = @as(c_int, 1) << @as(c_int, 0);
pub const ARES_AI_NUMERICHOST = @as(c_int, 1) << @as(c_int, 1);
pub const ARES_AI_PASSIVE = @as(c_int, 1) << @as(c_int, 2);
pub const ARES_AI_NUMERICSERV = @as(c_int, 1) << @as(c_int, 3);
pub const ARES_AI_V4MAPPED = @as(c_int, 1) << @as(c_int, 4);
pub const ARES_AI_ALL = @as(c_int, 1) << @as(c_int, 5);
pub const ARES_AI_ADDRCONFIG = @as(c_int, 1) << @as(c_int, 6);
pub const ARES_AI_NOSORT = @as(c_int, 1) << @as(c_int, 7);
pub const ARES_AI_ENVHOSTS = @as(c_int, 1) << @as(c_int, 8);
pub const ARES_AI_IDN = @as(c_int, 1) << @as(c_int, 10);
pub const ARES_AI_IDN_ALLOW_UNASSIGNED = @as(c_int, 1) << @as(c_int, 11);
pub const ARES_AI_IDN_USE_STD3_ASCII_RULES = @as(c_int, 1) << @as(c_int, 12);
pub const ARES_AI_CANONIDN = @as(c_int, 1) << @as(c_int, 13);
pub const ARES_AI_MASK = (((((ARES_AI_CANONNAME | ARES_AI_NUMERICHOST) | ARES_AI_PASSIVE) | ARES_AI_NUMERICSERV) | ARES_AI_V4MAPPED) | ARES_AI_ALL) | ARES_AI_ADDRCONFIG;
pub const ARES_GETSOCK_MAXNUM = @as(c_int, 16);
pub inline fn ARES_GETSOCK_READABLE(bits: anytype, num: anytype) @TypeOf(bits & (@as(c_int, 1) << num)) {
    return bits & (@as(c_int, 1) << num);
}
pub inline fn ARES_GETSOCK_WRITABLE(bits: anytype, num: anytype) @TypeOf(bits & (@as(c_int, 1) << (num + ARES_GETSOCK_MAXNUM))) {
    return bits & (@as(c_int, 1) << (num + ARES_GETSOCK_MAXNUM));
}
pub const ARES_LIB_INIT_NONE = @as(c_int, 0);
pub const ARES_LIB_INIT_WIN32 = @as(c_int, 1) << @as(c_int, 0);
pub const ARES_LIB_INIT_ALL = ARES_LIB_INIT_WIN32;
pub const ARES_SOCKET_BAD = if (bun.Environment.isWindows) std.os.windows.ws2_32.INVALID_SOCKET else -@as(c_int, 1);
pub const ares_socket_typedef = "";
pub const ares_addrinfo_cname = AddrInfo_cname;
pub const ares_addrinfo_node = AddrInfo_node;
pub const ares_addrinfo = AddrInfo;
pub const ares_addrinfo_hints = AddrInfo_hints;
pub const ares_in6_addr = struct_ares_in6_addr;
pub const ares_addrttl = struct_ares_addrttl;
pub const ares_addr6ttl = struct_ares_addr6ttl;
pub const ares_caa_reply = struct_ares_caa_reply;
pub const ares_srv_reply = struct_ares_srv_reply;
pub const ares_mx_reply = struct_ares_mx_reply;
pub const ares_txt_reply = struct_ares_txt_reply;
pub const ares_txt_ext = struct_ares_txt_ext;
pub const ares_naptr_reply = struct_ares_naptr_reply;
pub const ares_soa_reply = struct_ares_soa_reply;
pub const ares_uri_reply = struct_ares_uri_reply;
pub const ares_addr_node = struct_ares_addr_node;
pub const ares_addr_port_node = struct_ares_addr_port_node;

pub export fn Bun__canonicalizeIP(
    ctx: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(JSC.conv) JSC.JSValue {
    JSC.markBinding(@src());

    const globalThis = ctx.ptr();
    const arguments = callframe.arguments(1);

    if (arguments.len == 0) {
        globalThis.throwInvalidArguments("canonicalizeIP() expects a string but received no arguments.", .{});
        return .zero;
    }
    // windows uses 65 bytes for ipv6 addresses and linux/macos uses 46
    const INET6_ADDRSTRLEN = if (comptime bun.Environment.isWindows) 65 else 46;

    const script_ctx = globalThis.bunVM();
    var args = JSC.Node.ArgumentsSlice.init(script_ctx, arguments.slice());
    const addr_arg = args.nextEat().?;

    if (bun.String.tryFromJS(addr_arg, globalThis)) |addr| {
        defer addr.deref();
        const addr_slice = addr.toSlice(bun.default_allocator);
        const addr_str = addr_slice.slice();
        if (addr_str.len >= INET6_ADDRSTRLEN) {
            return JSC.JSValue.jsUndefined();
        }

        var ip_std_text: [INET6_ADDRSTRLEN + 1]u8 = undefined;
        // we need a null terminated string as input
        var ip_addr: [INET6_ADDRSTRLEN + 1]u8 = undefined;
        bun.copy(u8, &ip_addr, addr_str);
        ip_addr[addr_str.len] = 0;

        var af: c_int = AF.INET;
        // get the standard text representation of the IP
        if (ares_inet_pton(af, &ip_addr, &ip_std_text) != 1) {
            af = AF.INET6;
            if (ares_inet_pton(af, &ip_addr, &ip_std_text) != 1) {
                return JSC.JSValue.jsUndefined();
            }
        }
        // ip_addr will contain the null-terminated string of the cannonicalized IP
        if (ares_inet_ntop(af, &ip_std_text, &ip_addr, @sizeOf(@TypeOf(ip_addr))) == null) {
            return JSC.JSValue.jsUndefined();
        }
        // use the null-terminated size to return the string
        const size = bun.len(bun.cast([*:0]u8, &ip_addr));
        return JSC.ZigString.init(ip_addr[0..size]).toJS(globalThis);
    } else {
        globalThis.throwInvalidArguments("address must be a string", .{});
        return .zero;
    }
}

/// Creates a sockaddr structure from an address, port.
///
/// # Parameters
/// - `addr`: A byte slice representing the IP address.
/// - `port`: A 16-bit unsigned integer representing the port number.
/// - `sa`: A pointer to a sockaddr structure where the result will be stored.
///
/// # Returns
///
/// This function returns 0 on success.
pub fn getSockaddr(addr: []const u8, port: u16, sa: *std.posix.sockaddr) c_int {
    const buf_size = 128;

    var buf: [buf_size]u8 = undefined;
    const addr_ptr: [*:0]const u8 = brk: {
        if (addr.len == 0 or addr.len >= buf_size) {
            return -1;
        }
        const len = @min(addr.len, buf.len - 1);
        @memcpy(buf[0..len], addr[0..len]);

        buf[len] = 0;
        break :brk buf[0..len :0];
    };

    {
        const in: *std.posix.sockaddr.in = @alignCast(@ptrCast(sa));
        if (ares_inet_pton(AF.INET, addr_ptr, &in.addr) == 1) {
            in.*.family = AF.INET;
            in.*.port = std.mem.nativeToBig(u16, port);
            return 0;
        }
    }
    {
        const in6: *std.posix.sockaddr.in6 = @alignCast(@ptrCast(sa));
        if (ares_inet_pton(AF.INET6, addr_ptr, &in6.addr) == 1) {
            in6.*.family = AF.INET6;
            in6.*.port = std.mem.nativeToBig(u16, port);
            return 0;
        }
    }

    return -1;
}

comptime {
    if (!JSC.is_bindgen) {
        _ = Bun__canonicalizeIP;
    }
}
const GetAddrInfo = bun.dns.GetAddrInfo;
