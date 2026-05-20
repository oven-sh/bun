use phf::phf_map;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ACL {
    /// Owner gets FULL_CONTROL. No one else has access rights (default).
    Private,
    /// Owner gets FULL_CONTROL. The AllUsers group (see Who is a grantee?) gets READ access.
    PublicRead,
    /// Owner gets FULL_CONTROL. The AllUsers group gets READ and WRITE access. Granting this on a bucket is generally not recommended.
    PublicReadWrite,
    /// Owner gets FULL_CONTROL. Amazon EC2 gets READ access to GET an Amazon Machine Image (AMI) bundle from Amazon S3.
    AwsExecRead,
    /// Owner gets FULL_CONTROL. The AuthenticatedUsers group gets READ access.
    AuthenticatedRead,
    /// Object owner gets FULL_CONTROL. Bucket owner gets READ access. If you specify this canned ACL when creating a bucket, Amazon S3 ignores it.
    BucketOwnerRead,
    /// Both the object owner and the bucket owner get FULL_CONTROL over the object. If you specify this canned ACL when creating a bucket, Amazon S3 ignores it.
    BucketOwnerFullControl,
    LogDeliveryWrite,
}

impl ACL {
    pub const fn to_string(self) -> &'static str {
        match self {
            ACL::Private => "private",
            ACL::PublicRead => "public-read",
            ACL::PublicReadWrite => "public-read-write",
            ACL::AwsExecRead => "aws-exec-read",
            ACL::AuthenticatedRead => "authenticated-read",
            ACL::BucketOwnerRead => "bucket-owner-read",
            ACL::BucketOwnerFullControl => "bucket-owner-full-control",
            ACL::LogDeliveryWrite => "log-delivery-write",
        }
    }

    pub const MAP: phf::Map<&'static [u8], ACL> = phf_map! {
        b"private" => ACL::Private,
        b"public-read" => ACL::PublicRead,
        b"public-read-write" => ACL::PublicReadWrite,
        b"aws-exec-read" => ACL::AwsExecRead,
        b"authenticated-read" => ACL::AuthenticatedRead,
        b"bucket-owner-read" => ACL::BucketOwnerRead,
        b"bucket-owner-full-control" => ACL::BucketOwnerFullControl,
        b"log-delivery-write" => ACL::LogDeliveryWrite,
    };
}

// ported from: src/s3_signing/acl.zig
