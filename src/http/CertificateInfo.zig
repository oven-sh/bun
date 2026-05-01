const CertificateInfo = @This();

cert: []const u8,
cert_error: HTTPCertError,
hostname: []const u8,
pub fn deinit(this: *const CertificateInfo, allocator: std.mem.Allocator) void {
    allocator.free(this.cert);
    allocator.free(this.cert_error.code);
    allocator.free(this.cert_error.reason);
    allocator.free(this.hostname);
}

const HTTPCertError = @import("./HTTPCertError.zig");
const std = @import("std");
