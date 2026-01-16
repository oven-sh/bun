pub const MultiPartUploadOptions = struct {
    /// 1 MiB = 1024 * 1024 = 1,048,576 bytes
    pub const OneMiB: usize = 1048576;

    /// AWS S3 maximum object size for single PUT is 5 GiB
    /// See: https://docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html
    pub const MAX_SINGLE_UPLOAD_SIZE: usize = 5120 * OneMiB;

    /// AWS S3 minimum part size for multipart upload is 5 MiB (except last part)
    /// See: https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html
    pub const MIN_SINGLE_UPLOAD_SIZE: usize = 5 * OneMiB;

    pub const DefaultPartSize = MIN_SINGLE_UPLOAD_SIZE;

    /// Max concurrent upload parts. HTTP thread pool limits practical concurrency to ~64.
    pub const MAX_QUEUE_SIZE = 64;

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
