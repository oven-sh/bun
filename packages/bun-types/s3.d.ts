declare module "bun" {
  /**
   * Fast incremental writer for files and pipes.
   *
   * This uses the same interface as {@link ArrayBufferSink}, but writes to a file or pipe.
   */
  interface FileSink {
    /**
     * Write a chunk of data to the file.
     *
     * If the file descriptor is not writable yet, the data is buffered.
     */
    write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number;
    /**
     * Flush the internal buffer, committing the data to disk or the pipe.
     */
    flush(): number | Promise<number>;
    /**
     * Close the file descriptor. This also flushes the internal buffer.
     */
    end(error?: Error): number | Promise<number>;

    start(options?: {
      /**
       * Preallocate an internal buffer of this size
       * This can significantly improve performance when the chunk size is small
       */
      highWaterMark?: number;
    }): void;

    /**
     * For FIFOs & pipes, this lets you decide whether Bun's process should
     * remain alive until the pipe is closed.
     *
     * By default, it is automatically managed. While the stream is open, the
     * process remains alive and once the other end hangs up or the stream
     * closes, the process exits.
     *
     * If you previously called {@link unref}, you can call this again to re-enable automatic management.
     *
     * Internally, it will reference count the number of times this is called. By default, that number is 1
     *
     * If the file is not a FIFO or pipe, {@link ref} and {@link unref} do
     * nothing. If the pipe is already closed, this does nothing.
     */
    ref(): void;

    /**
     * For FIFOs & pipes, this lets you decide whether Bun's process should
     * remain alive until the pipe is closed.
     *
     * If you want to allow Bun's process to terminate while the stream is open,
     * call this.
     *
     * If the file is not a FIFO or pipe, {@link ref} and {@link unref} do
     * nothing. If the pipe is already closed, this does nothing.
     */
    unref(): void;
  }

  interface NetworkSink extends FileSink {
    /**
     * Write a chunk of data to the network.
     *
     * If the network is not writable yet, the data is buffered.
     */
    write(chunk: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer): number;
    /**
     * Flush the internal buffer, committing the data to the network.
     */
    flush(): number | Promise<number>;
    /**
     * Finish the upload. This also flushes the internal buffer.
     */
    end(error?: Error): number | Promise<number>;

    /**
     * Get the stat of the file.
     */
    stat(): Promise<import("node:fs").Stats>;
  }

  /**
   * Configuration options for S3 operations
   */
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

  /**
   * Options for generating presigned URLs
   */
  interface S3FilePresignOptions extends S3Options {
    /**
     * Number of seconds until the presigned URL expires.
     * - Default: 86400 (1 day)
     *
     * @example
     *     // Short-lived URL
     *     const url = file.presign({
     *       expiresIn: 3600 // 1 hour
     *     });
     *
     * @example
     *     // Long-lived public URL
     *     const url = file.presign({
     *       expiresIn: 7 * 24 * 60 * 60, // 7 days
     *       acl: "public-read"
     *     });
     */
    expiresIn?: number;

    /**
     * The HTTP method allowed for the presigned URL.
     *
     * @example
     *     // GET URL for downloads
     *     const downloadUrl = file.presign({
     *       method: "GET",
     *       expiresIn: 3600
     *     });
     *
     * @example
     *     // PUT URL for uploads
     *     const uploadUrl = file.presign({
     *       method: "PUT",
     *       expiresIn: 3600,
     *       type: "application/json"
     *     });
     */
    method?: "GET" | "POST" | "PUT" | "DELETE" | "HEAD";
  }

  interface S3Stats {
    size: number;
    lastModified: Date;
    etag: string;
    type: string;
  }

  /**
   * Represents a file in an S3-compatible storage service.
   * Extends the Blob interface for compatibility with web APIs.
   */
  interface S3File extends Blob {
    /**
     * The size of the file in bytes.
     * This is a Promise because it requires a network request to determine the size.
     *
     * @example
     *     // Getting file size
     *     const size = await file.size;
     *     console.log(`File size: ${size} bytes`);
     *
     * @example
     *     // Check if file is larger than 1MB
     *     if (await file.size > 1024 * 1024) {
     *       console.log("Large file detected");
     *     }
     */
    /**
     * TODO: figure out how to get the typescript types to not error for this property.
     */
    // size: Promise<number>;

    /**
     * Creates a new S3File representing a slice of the original file.
     * Uses HTTP Range headers for efficient partial downloads.
     *
     * @param begin - Starting byte offset
     * @param end - Ending byte offset (exclusive)
     * @param contentType - Optional MIME type for the slice
     * @returns A new S3File representing the specified range
     *
     * @example
     *  // Reading file header
     *     const header = file.slice(0, 1024);
     *     const headerText = await header.text();
     *
     * @example
     *     // Reading with content type
     *     const jsonSlice = file.slice(1024, 2048, "application/json");
     *     const data = await jsonSlice.json();
     *
     * @example
     *     // Reading from offset to end
     *     const remainder = file.slice(1024);
     *     const content = await remainder.text();
     */
    slice(begin?: number, end?: number, contentType?: string): S3File;
    slice(begin?: number, contentType?: string): S3File;
    slice(contentType?: string): S3File;

    /**
     * Creates a writable stream for uploading data.
     * Suitable for large files as it uses multipart upload.
     *
     * @param options - Configuration for the upload
     * @returns A NetworkSink for writing data
     *
     * @example
     *     // Basic streaming write
     *     const writer = file.writer({
     *       type: "application/json"
     *     });
     *     writer.write('{"hello": ');
     *     writer.write('"world"}');
     *     await writer.end();
     *
     * @example
     *     // Optimized large file upload
     *     const writer = file.writer({
     *       partSize: 10 * 1024 * 1024, // 10MB parts
     *       queueSize: 4, // Upload 4 parts in parallel
     *       retry: 3 // Retry failed parts
     *     });
     *
     *     // Write large chunks of data efficiently
     *     for (const chunk of largeDataChunks) {
     *       writer.write(chunk);
     *     }
     *     await writer.end();
     *
     * @example
     *     // Error handling
     *     const writer = file.writer();
     *     try {
     *       writer.write(data);
     *       await writer.end();
     *     } catch (err) {
     *       console.error('Upload failed:', err);
     *       // Writer will automatically abort multipart upload on error
     *     }
     */
    writer(options?: S3Options): NetworkSink;

    /**
     * Gets a readable stream of the file's content.
     * Useful for processing large files without loading them entirely into memory.
     *
     * @returns A ReadableStream for the file content
     *
     * @example
     *     // Basic streaming read
     *     const stream = file.stream();
     *     for await (const chunk of stream) {
     *       console.log('Received chunk:', chunk);
     *     }
     *
     * @example
     *     // Piping to response
     *     const stream = file.stream();
     *     return new Response(stream, {
     *       headers: { 'Content-Type': file.type }
     *     });
     *
     * @example
     *     // Processing large files
     *     const stream = file.stream();
     *     const textDecoder = new TextDecoder();
     *     for await (const chunk of stream) {
     *       const text = textDecoder.decode(chunk);
     *       // Process text chunk by chunk
     *     }
     */
    readonly readable: ReadableStream;
    stream(): ReadableStream;

    /**
     * The name or path of the file in the bucket.
     *
     * @example
     * const file = s3("folder/image.jpg");
     * console.log(file.name); // "folder/image.jpg"
     */
    readonly name?: string;

    /**
     * The bucket name containing the file.
     *
     * @example
     *    const file = s3("s3://my-bucket/file.txt");
     *    console.log(file.bucket); // "my-bucket"
     */
    readonly bucket?: string;

    /**
     * Checks if the file exists in S3.
     * Uses HTTP HEAD request to efficiently check existence without downloading.
     *
     * @returns Promise resolving to true if file exists, false otherwise
     *
     * @example
     *     // Basic existence check
     *    if (await file.exists()) {
     *      console.log("File exists in S3");
     *    }
     *
     * @example
     *  // With error handling
     *  try {
     *    const exists = await file.exists();
     *    if (!exists) {
     *      console.log("File not found");
     *    }
     *  } catch (err) {
     *    console.error("Error checking file:", err);
     *  }
     */
    exists(): Promise<boolean>;

    /**
     * Uploads data to S3.
     * Supports various input types and automatically handles large files.
     *
     * @param data - The data to upload
     * @param options - Upload configuration options
     * @returns Promise resolving to number of bytes written
     *
     * @example
     *     // Writing string data
     *     await file.write("Hello World", {
     *       type: "text/plain"
     *     });
     *
     * @example
     *     // Writing JSON
     *     const data = { hello: "world" };
     *     await file.write(JSON.stringify(data), {
     *       type: "application/json"
     *     });
     *
     * @example
     *     // Writing from Response
     *     const response = await fetch("https://example.com/data");
     *     await file.write(response);
     *
     * @example
     *     // Writing with ACL
     *     await file.write(data, {
     *       acl: "public-read",
     *       type: "application/octet-stream"
     *     });
     */
    write(
      data: string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer | Request | Response | BunFile | S3File | Blob,
      options?: S3Options,
    ): Promise<number>;

    /**
     * Generates a presigned URL for the file.
     * Allows temporary access to the file without exposing credentials.
     *
     * @param options - Configuration for the presigned URL
     * @returns Presigned URL string
     *
     * @example
     *     // Basic download URL
     *     const url = file.presign({
     *       expiresIn: 3600 // 1 hour
     *     });
     *
     * @example
     *     // Upload URL with specific content type
     *     const uploadUrl = file.presign({
     *       method: "PUT",
     *       expiresIn: 3600,
     *       type: "image/jpeg",
     *       acl: "public-read"
     *     });
     *
     * @example
     *     // URL with custom permissions
     *     const url = file.presign({
     *       method: "GET",
     *       expiresIn: 7 * 24 * 60 * 60, // 7 days
     *       acl: "public-read"
     *     });
     */
    presign(options?: S3FilePresignOptions): string;

    /**
     * Deletes the file from S3.
     *
     * @returns Promise that resolves when deletion is complete
     *
     * @example
     *     // Basic deletion
     *     await file.delete();
     *
     * @example
     *     // With error handling
     *     try {
     *       await file.delete();
     *       console.log("File deleted successfully");
     *     } catch (err) {
     *       console.error("Failed to delete file:", err);
     *     }
     */
    delete(): Promise<void>;

    /**
     * Alias for delete() method.
     * Provided for compatibility with Node.js fs API naming.
     *
     * @example
     * await file.unlink();
     */
    unlink: S3File["delete"];

    /**
     * Get the stat of a file in an S3-compatible storage service.
     *
     * @returns Promise resolving to S3Stat
     */
    stat(): Promise<S3Stats>;
  }

  /**
   * A configured S3 bucket instance for managing files.
   * The instance is callable to create S3File instances and provides methods
   * for common operations.
   *
   * @example
   *     // Basic bucket setup
   *     const bucket = new S3Client({
   *       bucket: "my-bucket",
   *       accessKeyId: "key",
   *       secretAccessKey: "secret"
   *     });
   *
   *     // Get file instance
   *     const file = bucket("image.jpg");
   *
   *     // Common operations
   *     await bucket.write("data.json", JSON.stringify({hello: "world"}));
   *     const url = bucket.presign("file.pdf");
   *     await bucket.unlink("old.txt");
   */
  class S3Client {
    prototype: S3Client;
    /**
     * Create a new instance of an S3 bucket so that credentials can be managed
     * from a single instance instead of being passed to every method.
     *
     * @param options The default options to use for the S3 client. Can be
     * overriden by passing options to the methods.
     *
     * ## Keep S3 credentials in a single instance
     *
     * @example
     *     const bucket = new Bun.S3Client({
     *       accessKeyId: "your-access-key",
     *       secretAccessKey: "your-secret-key",
     *       bucket: "my-bucket",
     *       endpoint: "https://s3.us-east-1.amazonaws.com",
     *       sessionToken: "your-session-token",
     *     });
     *
     *     // S3Client is callable, so you can do this:
     *     const file = bucket.file("my-file.txt");
     *
     *     // or this:
     *     await file.write("Hello Bun!");
     *     await file.text();
     *
     *     // To delete the file:
     *     await bucket.delete("my-file.txt");
     *
     *     // To write a file without returning the instance:
     *     await bucket.write("my-file.txt", "Hello Bun!");
     *
     */
    constructor(options?: S3Options);

    /**
     * Creates an S3File instance for the given path.
     *
     * @example
     * const file = bucket.file("image.jpg");
     * await file.write(imageData);
     * const configFile = bucket("config.json", {
     *   type: "application/json",
     *   acl: "private"
     * });
     */
    file(path: string, options?: S3Options): S3File;

    /**
     * Writes data directly to a path in the bucket.
     * Supports strings, buffers, streams, and web API types.
     *
     * @example
     *     // Write string
     *     await bucket.write("hello.txt", "Hello World");
     *
     *     // Write JSON with type
     *     await bucket.write(
     *       "data.json",
     *       JSON.stringify({hello: "world"}),
     *       {type: "application/json"}
     *     );
     *
     *     // Write from fetch
     *     const res = await fetch("https://example.com/data");
     *     await bucket.write("data.bin", res);
     *
     *     // Write with ACL
     *     await bucket.write("public.html", html, {
     *       acl: "public-read",
     *       type: "text/html"
     *     });
     */
    write(
      path: string,
      data:
        | string
        | ArrayBufferView
        | ArrayBuffer
        | SharedArrayBuffer
        | Request
        | Response
        | BunFile
        | S3File
        | Blob
        | File,
      options?: S3Options,
    ): Promise<number>;

    /**
     * Generate a presigned URL for temporary access to a file.
     * Useful for generating upload/download URLs without exposing credentials.
     *
     * @example
     *     // Download URL
     *     const downloadUrl = bucket.presign("file.pdf", {
     *       expiresIn: 3600 // 1 hour
     *     });
     *
     *     // Upload URL
     *     const uploadUrl = bucket.presign("uploads/image.jpg", {
     *       method: "PUT",
     *       expiresIn: 3600,
     *       type: "image/jpeg",
     *       acl: "public-read"
     *     });
     *
     *     // Long-lived public URL
     *     const publicUrl = bucket.presign("public/doc.pdf", {
     *       expiresIn: 7 * 24 * 60 * 60, // 7 days
     *       acl: "public-read"
     *     });
     */
    presign(path: string, options?: S3FilePresignOptions): string;

    /**
     * Delete a file from the bucket.
     *
     * @example
     *     // Simple delete
     *     await bucket.unlink("old-file.txt");
     *
     *     // With error handling
     *     try {
     *       await bucket.unlink("file.dat");
     *       console.log("File deleted");
     *     } catch (err) {
     *       console.error("Delete failed:", err);
     *     }
     */
    unlink(path: string, options?: S3Options): Promise<void>;
    delete: S3Client["unlink"];

    /**
     * Get the size of a file in bytes.
     * Uses HEAD request to efficiently get size.
     *
     * @example
     *     // Get size
     *     const bytes = await bucket.size("video.mp4");
     *     console.log(`Size: ${bytes} bytes`);
     *
     *     // Check if file is large
     *     if (await bucket.size("data.zip") > 100 * 1024 * 1024) {
     *       console.log("File is larger than 100MB");
     *     }
     */
    size(path: string, options?: S3Options): Promise<number>;

    /**
     * Check if a file exists in the bucket.
     * Uses HEAD request to check existence.
     *
     * @example
     *     // Check existence
     *     if (await bucket.exists("config.json")) {
     *       const file = bucket("config.json");
     *       const config = await file.json();
     *     }
     *
     *     // With error handling
     *     try {
     *       if (!await bucket.exists("required.txt")) {
     *         throw new Error("Required file missing");
     *       }
     *     } catch (err) {
     *       console.error("Check failed:", err);
     *     }
     */
    exists(path: string, options?: S3Options): Promise<boolean>;
    /**
     * Get the stat of a file in an S3-compatible storage service.
     *
     * @param path The path to the file.
     * @param options The options to use for the S3 client.
     */
    stat(path: string, options?: S3Options): Promise<S3Stats>;
  }

  /**
   * A default instance of S3Client
   *
   * Pulls credentials from environment variables. Use `new Bun.S3Client()` if you need to explicitly set credentials.
   */
  var s3: S3Client;
}
