const bun = @import("bun");

pub const ACL = enum {
    /// Owner gets FULL_CONTROL. No one else has access rights (default).
    private,
    /// Owner gets FULL_CONTROL. The AllUsers group (see Who is a grantee?) gets READ access.
    public_read,
    /// Owner gets FULL_CONTROL. The AllUsers group gets READ and WRITE access. Granting this on a bucket is generally not recommended.
    public_read_write,
    /// Owner gets FULL_CONTROL. Amazon EC2 gets READ access to GET an Amazon Machine Image (AMI) bundle from Amazon S3.
    aws_exec_read,
    /// Owner gets FULL_CONTROL. The AuthenticatedUsers group gets READ access.
    authenticated_read,
    /// Object owner gets FULL_CONTROL. Bucket owner gets READ access. If you specify this canned ACL when creating a bucket, Amazon S3 ignores it.
    bucket_owner_read,
    /// Both the object owner and the bucket owner get FULL_CONTROL over the object. If you specify this canned ACL when creating a bucket, Amazon S3 ignores it.
    bucket_owner_full_control,
    log_delivery_write,

    pub fn toString(this: @This()) []const u8 {
        return switch (this) {
            .private => "private",
            .public_read => "public-read",
            .public_read_write => "public-read-write",
            .aws_exec_read => "aws-exec-read",
            .authenticated_read => "authenticated-read",
            .bucket_owner_read => "bucket-owner-read",
            .bucket_owner_full_control => "bucket-owner-full-control",
            .log_delivery_write => "log-delivery-write",
        };
    }

    pub const Map = bun.ComptimeStringMap(ACL, .{
        .{ "private", .private },
        .{ "public-read", .public_read },
        .{ "public-read-write", .public_read_write },
        .{ "aws-exec-read", .aws_exec_read },
        .{ "authenticated-read", .authenticated_read },
        .{ "bucket-owner-read", .bucket_owner_read },
        .{ "bucket-owner-full-control", .bucket_owner_full_control },
        .{ "log-delivery-write", .log_delivery_write },
    });
};
