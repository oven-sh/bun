const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const Output = bun.Output;
const options = @import("../options.zig");
const JSC = bun.JSC;

pub fn uploadOutputFilesToS3(
    output_files: []const options.OutputFile,
    s3_url: []const u8,
    s3_credentials: ?*bun.S3.S3Credentials,
    globalThis: *JSC.JSGlobalObject,
) !void {
    // Parse S3 URL to extract bucket and prefix
    var bucket: []const u8 = "";
    var prefix: []const u8 = "";
    if (strings.hasPrefixComptime(s3_url, "s3://")) {
        const url_without_protocol = s3_url[5..];
        if (strings.indexOfChar(url_without_protocol, '/')) |slash_index| {
            bucket = url_without_protocol[0..slash_index];
            prefix = url_without_protocol[slash_index + 1 ..];
        } else {
            bucket = url_without_protocol;
        }
    } else {
        return error.InvalidS3URL;
    }

    // Get or create S3 credentials
    const credentials = s3_credentials orelse brk: {
        const env = globalThis.bunVM().transpiler.env;
        const access_key_id = env.map.get("AWS_ACCESS_KEY_ID") orelse "";
        const secret_access_key = env.map.get("AWS_SECRET_ACCESS_KEY") orelse "";

        if (access_key_id.len == 0 or secret_access_key.len == 0) {
            return error.MissingS3Credentials;
        }

        const creds = bun.new(bun.S3.S3Credentials, .{
            .ref_count = .init(),
            .accessKeyId = bun.default_allocator.dupe(u8, access_key_id) catch unreachable,
            .secretAccessKey = bun.default_allocator.dupe(u8, secret_access_key) catch unreachable,
            .bucket = bun.default_allocator.dupe(u8, bucket) catch unreachable,
            .region = if (env.map.get("AWS_REGION")) |region|
                bun.default_allocator.dupe(u8, region) catch unreachable
            else
                "us-east-1",
            .endpoint = if (env.map.get("AWS_ENDPOINT_URL_S3")) |endpoint|
                bun.default_allocator.dupe(u8, endpoint) catch unreachable
            else
                "",
            .sessionToken = if (env.map.get("AWS_SESSION_TOKEN")) |token|
                bun.default_allocator.dupe(u8, token) catch unreachable
            else
                "",
            .insecure_http = false,
            .virtual_hosted_style = false,
        });
        creds.ref();
        break :brk creds;
    };
    defer if (s3_credentials == null) credentials.deref();

    const total_files = output_files.len;
    Output.prettyln("<r><d>Uploading {d} files to S3...<r>", .{total_files});

    var upload_state = S3UploadState{
        .total_count = total_files,
        .completed_count = 0,
        .error_count = 0,
        .globalThis = globalThis,
        .credentials = credentials,
        .prefix = prefix,
    };

    // Create upload tasks for all files
    const tasks = bun.default_allocator.alloc(S3UploadTask, output_files.len) catch unreachable;
    defer bun.default_allocator.free(tasks);

    for (output_files, 0..) |*output_file, i| {
        // Skip files without buffer data
        const content = switch (output_file.value) {
            .buffer => |buf| buf.bytes,
            else => continue,
        };

        // Prepare S3 path
        const s3_path = if (prefix.len > 0)
            std.fmt.allocPrint(bun.default_allocator, "{s}/{s}", .{ prefix, output_file.dest_path }) catch unreachable
        else
            bun.default_allocator.dupe(u8, output_file.dest_path) catch unreachable;

        const content_type = output_file.loader.toMimeType(&.{});

        tasks[i] = .{
            .state = &upload_state,
            .path = s3_path,
            .content = content,
            .content_type = content_type.value,
            .index = i,
        };

        // Start the upload
        credentials.ref();
        bun.S3.upload(
            credentials,
            s3_path,
            content,
            content_type.value,
            null, // acl
            null, // proxy_url
            null, // storage_class
            S3UploadTask.onComplete,
            &tasks[i],
        );
    }

    // Wait for all uploads to complete using the event loop
    while (upload_state.completed_count < upload_state.total_count) {
        _ = globalThis.bunVM().tick();

        // Check if we should timeout
        // TODO: Add proper timeout handling
    }

    if (upload_state.error_count > 0) {
        return error.S3UploadFailed;
    }

    Output.prettyln("<r><green>✓<r> Successfully uploaded {d} files to S3", .{total_files});
}

const S3UploadState = struct {
    total_count: usize,
    completed_count: usize,
    error_count: usize,
    globalThis: *JSC.JSGlobalObject,
    credentials: *bun.S3.S3Credentials,
    prefix: []const u8,
};

const S3UploadTask = struct {
    state: *S3UploadState,
    path: []const u8,
    content: []const u8,
    content_type: []const u8,
    index: usize,

    pub fn onComplete(result: bun.S3.S3UploadResult, ctx: *anyopaque) void {
        const task: *S3UploadTask = @ptrCast(@alignCast(ctx));
        defer {
            task.state.credentials.deref();
            bun.default_allocator.free(task.path);
        }

        switch (result) {
            .success => {
                task.state.completed_count += 1;
                Output.prettyln("<r><d>  Uploaded: {s}<r>", .{task.path});
            },
            .failure => |err| {
                task.state.error_count += 1;
                task.state.completed_count += 1;
                Output.prettyErrorln("<r><red>Failed to upload {s}: {s}<r>", .{ task.path, err.message });
            },
        }
    }
};
