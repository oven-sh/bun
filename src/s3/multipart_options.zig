pub const MultiPartUploadOptions = struct {
    pub const OneMiB: usize = 1048576;
    pub const MAX_SINGLE_UPLOAD_SIZE: usize = 5120 * OneMiB; // we limit to 5 GiB
    pub const MIN_SINGLE_UPLOAD_SIZE: usize = 5 * OneMiB;

    pub const DefaultPartSize = MIN_SINGLE_UPLOAD_SIZE;
    pub const MAX_QUEUE_SIZE = 64; // dont make sense more than this because we use fetch anything greater will be 64

    /// more than 255 dont make sense http thread cannot handle more than that
    queueSize: u8 = 5,
    /// in s3 client sdk they set it in bytes but the min is still 5 MiB
    /// var params = {Bucket: 'bucket', Key: 'key', Body: stream};
    /// var options = {partSize: 10 * 1024 * 1024, queueSize: 1};
    /// s3.upload(params, options, function(err, data) {
    ///   console.log(err, data);
    /// });
    /// See. https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property
    /// The value is in MiB min is 5 and max 5120 (but we limit to 4 GiB aka 4096)
    partSize: u64 = DefaultPartSize,
    /// default is 3 max 255
    retry: u8 = 3,
};
