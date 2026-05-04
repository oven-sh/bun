pub struct MultiPartUploadOptions {
    /// more than 255 dont make sense http thread cannot handle more than that
    pub queue_size: u8,
    /// in s3 client sdk they set it in bytes but the min is still 5 MiB
    /// var params = {Bucket: 'bucket', Key: 'key', Body: stream};
    /// var options = {partSize: 10 * 1024 * 1024, queueSize: 1};
    /// s3.upload(params, options, function(err, data) {
    ///   console.log(err, data);
    /// });
    /// See. https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
    /// The value is in MiB min is 5 and max 5120 (but we limit to 4 GiB aka 4096)
    pub part_size: u64,
    /// default is 3 max 255
    pub retry: u8,
}

impl MultiPartUploadOptions {
    pub const ONE_MIB: usize = 1048576;
    pub const MAX_SINGLE_UPLOAD_SIZE: usize = 5120 * Self::ONE_MIB; // we limit to 5 GiB
    pub const MIN_SINGLE_UPLOAD_SIZE: usize = 5 * Self::ONE_MIB;

    pub const DEFAULT_PART_SIZE: usize = Self::MIN_SINGLE_UPLOAD_SIZE;
    pub const MAX_QUEUE_SIZE: u8 = 64; // dont make sense more than this because we use fetch anything greater will be 64
}

impl Default for MultiPartUploadOptions {
    fn default() -> Self {
        Self {
            queue_size: 5,
            part_size: Self::DEFAULT_PART_SIZE as u64,
            retry: 3,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/s3/multipart_options.zig (22 lines)
//   confidence: high
//   todos:      0
//   notes:      const names SCREAMING_SNAKE_CASE'd; MAX_QUEUE_SIZE typed u8 (was comptime_int)
// ──────────────────────────────────────────────────────────────────────────
