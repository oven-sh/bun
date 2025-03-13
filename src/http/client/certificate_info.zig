const HTTPCertError = @import("./errors.zig").HTTPCertError;
const std = @import("std");
pub const CertificateInfo = struct {
    cert: []const u8,
    cert_error: HTTPCertError,
    hostname: []const u8,
    pub fn deinit(this: *const CertificateInfo, allocator: std.mem.Allocator) void {
        allocator.free(this.cert);
        allocator.free(this.cert_error.code);
        allocator.free(this.cert_error.reason);
        allocator.free(this.hostname);
    }
};
