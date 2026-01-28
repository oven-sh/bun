/// S3 Storage Classes for cost/performance trade-offs.
/// See: https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html
pub const StorageClass = enum {
    /// General purpose storage for frequently accessed data (default)
    STANDARD,
    /// Infrequent access, lower cost but retrieval fee
    STANDARD_IA,
    /// Automatic tiering based on access patterns
    INTELLIGENT_TIERING,
    /// Single-AZ, low-latency storage for frequently accessed data
    EXPRESS_ONEZONE,
    /// Single-AZ infrequent access, lower cost than STANDARD_IA
    ONEZONE_IA,
    /// Archive storage with minutes to hours retrieval
    GLACIER,
    /// Glacier Instant Retrieval - millisecond access for rarely accessed data
    GLACIER_IR,
    /// Deprecated: use STANDARD_IA or ONEZONE_IA instead
    REDUCED_REDUNDANCY,
    /// S3 on Outposts for on-premises storage
    OUTPOSTS,
    /// Lowest-cost archive with 12-48 hour retrieval
    DEEP_ARCHIVE,
    /// AWS Snowball Edge devices
    SNOW,

    pub fn toString(this: @This()) []const u8 {
        return switch (this) {
            .STANDARD => "STANDARD",
            .STANDARD_IA => "STANDARD_IA",
            .INTELLIGENT_TIERING => "INTELLIGENT_TIERING",
            .EXPRESS_ONEZONE => "EXPRESS_ONEZONE",
            .ONEZONE_IA => "ONEZONE_IA",
            .GLACIER => "GLACIER",
            .GLACIER_IR => "GLACIER_IR",
            .REDUCED_REDUNDANCY => "REDUCED_REDUNDANCY",
            .OUTPOSTS => "OUTPOSTS",
            .DEEP_ARCHIVE => "DEEP_ARCHIVE",
            .SNOW => "SNOW",
        };
    }

    pub const Map = bun.ComptimeStringMap(StorageClass, .{
        .{ "STANDARD", .STANDARD },
        .{ "STANDARD_IA", .STANDARD_IA },
        .{ "INTELLIGENT_TIERING", .INTELLIGENT_TIERING },
        .{ "EXPRESS_ONEZONE", .EXPRESS_ONEZONE },
        .{ "ONEZONE_IA", .ONEZONE_IA },
        .{ "GLACIER", .GLACIER },
        .{ "GLACIER_IR", .GLACIER_IR },
        .{ "REDUCED_REDUNDANCY", .REDUCED_REDUNDANCY },
        .{ "OUTPOSTS", .OUTPOSTS },
        .{ "DEEP_ARCHIVE", .DEEP_ARCHIVE },
        .{ "SNOW", .SNOW },
    });
};

const bun = @import("bun");
