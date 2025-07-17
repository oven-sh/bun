pub const Socket = opaque {
    pub fn create(loop: *Loop, data_cb: *const fn (*udp.Socket, *PacketBuffer, c_int) callconv(.C) void, drain_cb: *const fn (*udp.Socket) callconv(.C) void, close_cb: *const fn (*udp.Socket) callconv(.C) void, host: [*c]const u8, port: c_ushort, options: c_int, err: ?*c_int, user_data: ?*anyopaque) ?*udp.Socket {
        return us_create_udp_socket(loop, data_cb, drain_cb, close_cb, host, port, options, err, user_data);
    }

    pub fn send(this: *udp.Socket, payloads: []const [*]const u8, lengths: []const usize, addresses: []const ?*const anyopaque) c_int {
        bun.assert(payloads.len == lengths.len and payloads.len == addresses.len);
        return us_udp_socket_send(this, payloads.ptr, lengths.ptr, addresses.ptr, @intCast(payloads.len));
    }

    pub fn user(this: *udp.Socket) ?*anyopaque {
        return us_udp_socket_user(this);
    }

    pub fn bind(this: *udp.Socket, hostname: [*c]const u8, port: c_uint) c_int {
        return us_udp_socket_bind(this, hostname, port);
    }

    /// Get the bound port in host byte order
    pub fn boundPort(this: *udp.Socket) c_int {
        return us_udp_socket_bound_port(this);
    }

    pub fn boundIp(this: *udp.Socket, buf: [*c]u8, length: *i32) void {
        return us_udp_socket_bound_ip(this, buf, length);
    }

    pub fn remoteIp(this: *udp.Socket, buf: [*c]u8, length: *i32) void {
        return us_udp_socket_remote_ip(this, buf, length);
    }

    pub fn close(this: *udp.Socket) void {
        return us_udp_socket_close(this);
    }

    pub fn connect(this: *udp.Socket, hostname: [*c]const u8, port: c_uint) c_int {
        return us_udp_socket_connect(this, hostname, port);
    }

    pub fn disconnect(this: *udp.Socket) c_int {
        return us_udp_socket_disconnect(this);
    }

    pub fn setBroadcast(this: *udp.Socket, enabled: bool) c_int {
        return us_udp_socket_set_broadcast(this, @intCast(@intFromBool(enabled)));
    }

    pub fn setUnicastTTL(this: *udp.Socket, ttl: i32) c_int {
        return us_udp_socket_set_ttl_unicast(this, @intCast(ttl));
    }

    pub fn setMulticastTTL(this: *udp.Socket, ttl: i32) c_int {
        return us_udp_socket_set_ttl_multicast(this, @intCast(ttl));
    }

    pub fn setMulticastLoopback(this: *udp.Socket, enabled: bool) c_int {
        return us_udp_socket_set_multicast_loopback(this, @intCast(@intFromBool(enabled)));
    }

    pub fn setMulticastInterface(this: *udp.Socket, iface: *const std.posix.sockaddr.storage) c_int {
        return us_udp_socket_set_multicast_interface(this, iface);
    }

    pub fn setMembership(this: *udp.Socket, address: *const std.posix.sockaddr.storage, iface: ?*const std.posix.sockaddr.storage, drop: bool) c_int {
        return us_udp_socket_set_membership(this, address, iface, @intFromBool(drop));
    }

    pub fn setSourceSpecificMembership(this: *udp.Socket, source: *const std.posix.sockaddr.storage, group: *const std.posix.sockaddr.storage, iface: ?*const std.posix.sockaddr.storage, drop: bool) c_int {
        return us_udp_socket_set_source_specific_membership(this, source, group, iface, @intFromBool(drop));
    }

    extern fn us_create_udp_socket(loop: ?*Loop, data_cb: *const fn (*udp.Socket, *PacketBuffer, c_int) callconv(.C) void, drain_cb: *const fn (*udp.Socket) callconv(.C) void, close_cb: *const fn (*udp.Socket) callconv(.C) void, host: [*c]const u8, port: c_ushort, options: c_int, err: ?*c_int, user_data: ?*anyopaque) ?*udp.Socket;
    extern fn us_udp_socket_connect(socket: *udp.Socket, hostname: [*c]const u8, port: c_uint) c_int;
    extern fn us_udp_socket_disconnect(socket: *udp.Socket) c_int;
    extern fn us_udp_socket_send(socket: *udp.Socket, [*c]const [*c]const u8, [*c]const usize, [*c]const ?*const anyopaque, c_int) c_int;
    extern fn us_udp_socket_user(socket: *udp.Socket) ?*anyopaque;
    extern fn us_udp_socket_bind(socket: *udp.Socket, hostname: [*c]const u8, port: c_uint) c_int;
    extern fn us_udp_socket_bound_port(socket: *udp.Socket) c_int;
    extern fn us_udp_socket_bound_ip(socket: *udp.Socket, buf: [*c]u8, length: [*c]i32) void;
    extern fn us_udp_socket_remote_ip(socket: *udp.Socket, buf: [*c]u8, length: [*c]i32) void;
    extern fn us_udp_socket_close(socket: *udp.Socket) void;
    extern fn us_udp_socket_set_broadcast(socket: *udp.Socket, enabled: c_int) c_int;
    extern fn us_udp_socket_set_ttl_unicast(socket: *udp.Socket, ttl: c_int) c_int;
    extern fn us_udp_socket_set_ttl_multicast(socket: *udp.Socket, ttl: c_int) c_int;
    extern fn us_udp_socket_set_multicast_loopback(socket: *udp.Socket, enabled: c_int) c_int;
    extern fn us_udp_socket_set_multicast_interface(socket: *udp.Socket, iface: *const std.posix.sockaddr.storage) c_int;
    extern fn us_udp_socket_set_membership(socket: *udp.Socket, address: *const std.posix.sockaddr.storage, iface: ?*const std.posix.sockaddr.storage, drop: c_int) c_int;
    extern fn us_udp_socket_set_source_specific_membership(socket: *udp.Socket, source: *const std.posix.sockaddr.storage, group: *const std.posix.sockaddr.storage, iface: ?*const std.posix.sockaddr.storage, drop: c_int) c_int;
};

pub const PacketBuffer = opaque {
    pub fn getPeer(this: *PacketBuffer, index: c_int) *std.posix.sockaddr.storage {
        return us_udp_packet_buffer_peer(this, index);
    }

    pub fn getPayload(this: *PacketBuffer, index: c_int) []u8 {
        const payload = us_udp_packet_buffer_payload(this, index);
        const len = us_udp_packet_buffer_payload_length(this, index);
        return payload[0..@as(usize, @intCast(len))];
    }

    extern fn us_udp_packet_buffer_peer(buf: ?*PacketBuffer, index: c_int) *std.posix.sockaddr.storage;
    extern fn us_udp_packet_buffer_payload(buf: ?*PacketBuffer, index: c_int) [*]u8;
    extern fn us_udp_packet_buffer_payload_length(buf: ?*PacketBuffer, index: c_int) c_int;
};

const udp = @This();
const Loop = uws.Loop;
const bun = @import("bun");
const uws = bun.uws;
const std = @import("std");
