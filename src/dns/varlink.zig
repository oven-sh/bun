const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const Output = bun.Output;

const log = Output.scoped(.Varlink, true);

pub fn resolveHostnameSync(allocator: std.mem.Allocator, hostname: []const u8, family: ?i32) ![]std.c.addrinfo {
    const socket_path = "/run/systemd/resolve/io.systemd.Resolve";
    
    // Connect to socket
    const sock = try std.posix.socket(std.posix.AF.UNIX, std.posix.SOCK.STREAM, 0);
    defer std.posix.close(sock);
    
    var addr = std.posix.sockaddr.un{
        .family = std.posix.AF.UNIX,
        .path = undefined,
    };
    @memset(&addr.path, 0);
    @memcpy(addr.path[0..socket_path.len], socket_path);
    
    try std.posix.connect(sock, @ptrCast(&addr), @sizeOf(@TypeOf(addr)));
    
    // Create Varlink request
    var request_buf: [4096]u8 = undefined;
    const request = try std.fmt.bufPrint(&request_buf, 
        \\{{"method":"io.systemd.Resolve.ResolveHostname","parameters":{{"name":"{s}","family":{?d}}}}}
    , .{ hostname, family });
    
    // Send null-terminated request
    var send_buf: [4097]u8 = undefined;
    @memcpy(send_buf[0..request.len], request);
    send_buf[request.len] = 0;
    
    _ = try std.posix.send(sock, send_buf[0..request.len + 1], 0);
    
    // Read response
    var response_buf: [8192]u8 = undefined;
    const bytes_read = try std.posix.recv(sock, &response_buf, 0);
    
    // Find null terminator
    var null_pos: ?usize = null;
    for (response_buf[0..bytes_read], 0..) |byte, i| {
        if (byte == 0) {
            null_pos = i;
            break;
        }
    }
    
    if (null_pos == null) {
        return error.InvalidResponse;
    }
    
    // Parse JSON response
    const response = response_buf[0..null_pos.?];
    log("Varlink response: {s}", .{response});
    
    // Simple JSON parsing for addresses
    // Look for "addresses":[
    const addresses_marker = "\"addresses\":[";
    const addresses_start = std.mem.indexOf(u8, response, addresses_marker) orelse return error.NoAddresses;
    const addresses_data = response[addresses_start + addresses_marker.len..];
    
    // Find the end of addresses array
    const addresses_end = std.mem.indexOf(u8, addresses_data, "]") orelse return error.InvalidJSON;
    const addresses_json = addresses_data[0..addresses_end];
    
    // Count addresses (crude but works)
    var addr_count: usize = 0;
    var iter = std.mem.tokenize(u8, addresses_json, "{}");
    while (iter.next()) |_| {
        addr_count += 1;
    }
    
    if (addr_count == 0) {
        return error.NoAddresses;
    }
    
    // Allocate result array
    var results = try allocator.alloc(std.c.addrinfo, addr_count);
    var result_idx: usize = 0;
    
    // Parse each address
    iter = std.mem.tokenize(u8, addresses_json, "{}");
    while (iter.next()) |addr_obj| {
        // Look for "family":2 (IPv4) or "family":10 (IPv6)
        const family_marker = "\"family\":";
        const family_pos = std.mem.indexOf(u8, addr_obj, family_marker) orelse continue;
        const family_str = addr_obj[family_pos + family_marker.len..];
        const family_val = std.fmt.parseInt(i32, family_str[0..1], 10) catch continue;
        
        // Look for "address":[
        const addr_marker = "\"address\":[";
        const addr_pos = std.mem.indexOf(u8, addr_obj, addr_marker) orelse continue;
        const addr_data = addr_obj[addr_pos + addr_marker.len..];
        const addr_end = std.mem.indexOf(u8, addr_data, "]") orelse continue;
        const addr_bytes_str = addr_data[0..addr_end];
        
        // Parse address bytes
        if (family_val == 2) { // IPv4
            var sockaddr = try allocator.create(std.posix.sockaddr.in);
            sockaddr.* = std.mem.zeroes(std.posix.sockaddr.in);
            sockaddr.family = std.posix.AF.INET;
            sockaddr.port = 0;
            
            // Parse bytes like "23,220,75,245"
            var byte_iter = std.mem.tokenize(u8, addr_bytes_str, ",");
            var byte_idx: usize = 0;
            var addr_value: u32 = 0;
            while (byte_iter.next()) |byte_str| : (byte_idx += 1) {
                if (byte_idx >= 4) break;
                const byte_val = std.fmt.parseInt(u8, byte_str, 10) catch continue;
                addr_value |= @as(u32, byte_val) << @intCast(byte_idx * 8);
            }
            sockaddr.addr.s_addr = addr_value;
            
            results[result_idx] = std.mem.zeroes(std.c.addrinfo);
            results[result_idx].family = std.posix.AF.INET;
            results[result_idx].socktype = std.posix.SOCK.STREAM;
            results[result_idx].protocol = std.posix.IPPROTO.TCP;
            results[result_idx].addr = @ptrCast(sockaddr);
            results[result_idx].addrlen = @sizeOf(std.posix.sockaddr.in);
            
            if (result_idx > 0) {
                results[result_idx - 1].next = &results[result_idx];
            }
            
            result_idx += 1;
        }
    }
    
    if (result_idx == 0) {
        allocator.free(results);
        return error.NoValidAddresses;
    }
    
    return results[0..result_idx];
}