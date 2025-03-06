declare module "bun" {
	interface S3Options extends BlobPropertyBag {
		/**
		 * The Access Control List (ACL) policy for the file.
		 * Controls who can access the file and what permissions they have.
		 *
		 * @example
		 *     // Setting public read access
		 *     const file = s3("public-file.txt", {
		 *       acl: "public-read",
		 *       bucket: "my-bucket"
		 *     });
		 *
		 * @example
		 *     // Using with presigned URLs
		 *     const url = file.presign({
		 *       acl: "public-read",
		 *       expiresIn: 3600
		 *     });
		 */
		acl?:
			| "private"
			| "public-read"
			| "public-read-write"
			| "aws-exec-read"
			| "authenticated-read"
			| "bucket-owner-read"
			| "bucket-owner-full-control"
			| "log-delivery-write";

		/**
		 * The S3 bucket name. Can be set via `S3_BUCKET` or `AWS_BUCKET` environment variables.
		 *
		 * @example
		 *     // Using explicit bucket
		 *     const file = s3("my-file.txt", { bucket: "my-bucket" });
		 *
		 * @example
		 *     // Using environment variables
		 *     // With S3_BUCKET=my-bucket in .env
		 *     const file = s3("my-file.txt");
		 */
		bucket?: string;

		/**
		 * The AWS region. Can be set via `S3_REGION` or `AWS_REGION` environment variables.
		 *
		 * @example
		 *     const file = s3("my-file.txt", {
		 *       bucket: "my-bucket",
		 *       region: "us-west-2"
		 *     });
		 */
		region?: string;

		/**
		 * The access key ID for authentication.
		 * Can be set via `S3_ACCESS_KEY_ID` or `AWS_ACCESS_KEY_ID` environment variables.
		 */
		accessKeyId?: string;

		/**
		 * The secret access key for authentication.
		 * Can be set via `S3_SECRET_ACCESS_KEY` or `AWS_SECRET_ACCESS_KEY` environment variables.
		 */
		secretAccessKey?: string;

		/**
		 * Optional session token for temporary credentials.
		 * Can be set via `S3_SESSION_TOKEN` or `AWS_SESSION_TOKEN` environment variables.
		 *
		 * @example
		 *     // Using temporary credentials
		 *     const file = s3("my-file.txt", {
		 *       accessKeyId: tempAccessKey,
		 *       secretAccessKey: tempSecretKey,
		 *       sessionToken: tempSessionToken
		 *     });
		 */
		sessionToken?: string;

		/**
		 * The S3-compatible service endpoint URL.
		 * Can be set via `S3_ENDPOINT` or `AWS_ENDPOINT` environment variables.
		 *
		 * @example
		 *     // AWS S3
		 *     const file = s3("my-file.txt", {
		 *       endpoint: "https://s3.us-east-1.amazonaws.com"
		 *     });
		 *
		 * @example
		 *     // Cloudflare R2
		 *     const file = s3("my-file.txt", {
		 *       endpoint: "https://<account-id>.r2.cloudflarestorage.com"
		 *     });
		 *
		 * @example
		 *     // DigitalOcean Spaces
		 *     const file = s3("my-file.txt", {
		 *       endpoint: "https://<region>.digitaloceanspaces.com"
		 *     });
		 *
		 * @example
		 *     // MinIO (local development)
		 *     const file = s3("my-file.txt", {
		 *       endpoint: "http://localhost:9000"
		 *     });
		 */
		endpoint?: string;

		/**
		 * Use virtual hosted style endpoint. default to false, when true if `endpoint` is informed it will ignore the `bucket`
		 *
		 * @example
		 *     // Using virtual hosted style
		 *     const file = s3("my-file.txt", {
		 *       virtualHostedStyle: true,
		 *       endpoint: "https://my-bucket.s3.us-east-1.amazonaws.com"
		 *     });
		 */
		virtualHostedStyle?: boolean;

		/**
		 * The size of each part in multipart uploads (in bytes).
		 * - Minimum: 5 MiB
		 * - Maximum: 5120 MiB
		 * - Default: 5 MiB
		 *
		 * @example
		 *     // Configuring multipart uploads
		 *     const file = s3("large-file.dat", {
		 *       partSize: 10 * 1024 * 1024, // 10 MiB parts
		 *       queueSize: 4  // Upload 4 parts in parallel
		 *     });
		 *
		 *     const writer = file.writer();
		 *     // ... write large file in chunks
		 */
		partSize?: number;

		/**
		 * Number of parts to upload in parallel for multipart uploads.
		 * - Default: 5
		 * - Maximum: 255
		 *
		 * Increasing this value can improve upload speeds for large files
		 * but will use more memory.
		 */
		queueSize?: number;

		/**
		 * Number of retry attempts for failed uploads.
		 * - Default: 3
		 * - Maximum: 255
		 *
		 * @example
		 *    // Setting retry attempts
		 *     const file = s3("my-file.txt", {
		 *       retry: 5 // Retry failed uploads up to 5 times
		 *     });
		 */
		retry?: number;

		/**
		 * The Content-Type of the file.
		 * Automatically set based on file extension when possible.
		 *
		 * @example
		 *    // Setting explicit content type
		 *     const file = s3("data.bin", {
		 *       type: "application/octet-stream"
		 *     });
		 */
		type?: string;

		/**
		 * By default, Amazon S3 uses the STANDARD Storage Class to store newly created objects.
		 *
		 * @example
		 *    // Setting explicit Storage class
		 *     const file = s3("my-file.json", {
		 *       storageClass: "STANDARD_IA"
		 *     });
		 */
		storageClass?:
			| "STANDARD"
			| "DEEP_ARCHIVE"
			| "EXPRESS_ONEZONE"
			| "GLACIER"
			| "GLACIER_IR"
			| "INTELLIGENT_TIERING"
			| "ONEZONE_IA"
			| "OUTPOSTS"
			| "REDUCED_REDUNDANCY"
			| "SNOW"
			| "STANDARD_IA";

		/**
		 * @deprecated The size of the internal buffer in bytes. Defaults to 5 MiB. use `partSize` and `queueSize` instead.
		 */
		highWaterMark?: number;
	}
}
