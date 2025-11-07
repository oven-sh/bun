pub const Encoding = enum {
    identity,
    gzip,
    deflate,
    brotli,
    zstd,
    chunked,

    pub fn canUseLibDeflate(this: Encoding) bool {
        return switch (this) {
            .gzip, .deflate => true,
            else => false,
        };
    }

    pub fn isCompressed(this: Encoding) bool {
        return switch (this) {
            .brotli, .gzip, .deflate, .zstd => true,
            else => false,
        };
    }

    /// Convert encoding to Content-Encoding header value
    pub fn toString(this: Encoding) []const u8 {
        return switch (this) {
            .brotli => "br",
            .gzip => "gzip",
            .zstd => "zstd",
            .deflate => "deflate",
            .identity => "identity",
            .chunked => unreachable, // chunked is Transfer-Encoding only
        };
    }
};
