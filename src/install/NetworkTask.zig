unsafe_http_client: AsyncHTTP = undefined,
response: bun.http.HTTPClientResult = .{},
task_id: Task.Id,
url_buf: []const u8 = &[_]u8{},
retried: u16 = 0,
allocator: std.mem.Allocator,
request_buffer: MutableString = undefined,
response_buffer: MutableString = undefined,
package_manager: *PackageManager,
callback: union(Task.Tag) {
    package_manifest: struct {
        loaded_manifest: ?Npm.PackageManifest = null,
        name: strings.StringOrTinyString,
        is_extended_manifest: bool = false,
    },
    extract: ExtractTarball,
    git_clone: void,
    git_checkout: void,
    local_tarball: void,
},
/// Key in patchedDependencies in package.json
apply_patch_task: ?*PatchTask = null,
next: ?*NetworkTask = null,

/// Producer/consumer buffer that feeds tarball bytes from the HTTP thread
/// to a worker running libarchive. `null` when streaming extraction is
/// disabled or this task is not a tarball download.
tarball_stream: ?*TarballStream = null,
/// Extract `Task` pre-created on the main thread so the HTTP thread can
/// schedule it on the worker pool as soon as the first body chunk arrives.
streaming_extract_task: ?*Task = null,
/// Set by the HTTP thread the first time it commits this request to
/// the streaming path. Once true, `notify` never pushes this task to
/// `async_network_task_queue` — the extract Task published by
/// `TarballStream.finish()` owns the NetworkTask's lifetime instead
/// (its `resolve_tasks` handler returns it to the pool). Also read by
/// the main-thread fallback / retry paths in `runTasks.zig` to assert
/// the stream was never started.
streaming_committed: bool = false,
/// Backing store for the streaming signal the HTTP client polls.
signal_store: HTTP.Signals.Store = .{},

pub const DedupeMapEntry = struct {
    is_required: bool,
};
pub const DedupeMap = std.HashMap(Task.Id, DedupeMapEntry, IdentityContext(Task.Id), 80);

pub fn notify(this: *NetworkTask, async_http: *AsyncHTTP, result: bun.http.HTTPClientResult) void {
    if (this.tarball_stream) |stream| {
        // Runs on the HTTP thread. With response-body streaming enabled,
        // `notify` is called once per body chunk (has_more=true) and once
        // more at the end (has_more=false). `result.body` is our own
        // `response_buffer`; the HTTP client reuses it for the next
        // chunk, so we must consume + reset it before returning.

        // `metadata` is only populated on the first callback that
        // carries response headers. Cache the status code so both the
        // main thread and later chunk callbacks can see it.
        if (result.metadata) |m| {
            this.response.metadata = m;
            stream.status_code = m.response.status_code;
        }

        const chunk = this.response_buffer.list.items;

        // Only commit to streaming extraction once we've seen a 2xx
        // status *and* the tarball is large enough to be worth the
        // overhead. For small bodies, or any 4xx/5xx / transport error,
        // fall back to the buffered path so the existing retry and
        // error-reporting code in runTasks.zig keeps working.
        const ok_status = stream.status_code >= 200 and stream.status_code <= 299;
        const big_enough = switch (result.body_size) {
            .content_length => |len| len >= TarballStream.minSize(),
            // No Content-Length (chunked encoding): we can't know up
            // front, so stream — it avoids an unbounded buffer.
            else => true,
        };
        const committed = this.streaming_committed;

        if (committed or (ok_status and big_enough and result.fail == null)) {
            if (result.has_more) {
                if (chunk.len > 0) {
                    // The drain task is scheduled by `onChunk`
                    // (guarded by its own `draining` atomic) so it
                    // runs at most once at a time, releases the
                    // worker on ARCHIVE_RETRY, and is re-enqueued by
                    // the next chunk. Pending-task accounting stays
                    // balanced: this NetworkTask is never pushed to
                    // `async_network_task_queue` once committed, so
                    // its `incrementPendingTasks()` is satisfied by
                    // the extract Task that `TarballStream.finish()`
                    // publishes to `resolve_tasks`.
                    this.streaming_committed = true;
                    stream.onChunk(chunk, false, null);
                    // Hand the buffer back to the HTTP client empty so
                    // the next chunk starts at offset 0.
                    this.response_buffer.reset();
                }
                return;
            }

            // Final callback. If we've already started streaming, hand
            // over the last bytes and close; the drain task will run
            // once more, finish up and push to `resolve_tasks`. If not
            // (whole body arrived in one go, or too small), leave
            // `response_buffer` intact so the buffered extractor
            // handles it.
            if (committed) {
                stream.onChunk(chunk, true, result.fail);
                // Do NOT touch `this` — or anything it owns — after
                // this point: `onChunk(…, true, …)` sets `closed` and
                // schedules a drain that may reach `finish()` on a
                // worker thread before we return here. `finish()`
                // frees `response_buffer`, publishes the extract Task
                // to `resolve_tasks`, and the main thread's processing
                // of that Task returns this NetworkTask to
                // `preallocated_network_tasks` (poisoning it under
                // ASAN). The NetworkTask is therefore *not* pushed to
                // `async_network_task_queue` here; the extract Task
                // owns its lifetime from now on.
                return;
            }
        } else if (result.has_more) {
            // Non-2xx response (or too small to stream) still
            // delivering its body: accumulate in `response_buffer`
            // (we did *not* reset above) so the main thread can
            // inspect it. Do not enqueue until the stream ends.
            return;
        }
        // Fall through to the normal completion path for anything that
        // did not commit: the buffered extractor / retry logic in
        // runTasks.zig handles it exactly as it would without
        // streaming support.
    }

    defer this.package_manager.wake();
    async_http.real.?.* = async_http.*;
    async_http.real.?.response_buffer = async_http.response_buffer;
    // Preserve metadata captured on an earlier streaming callback; the
    // final `result` won't have it.
    const saved_metadata = this.response.metadata;
    this.response = result;
    if (this.response.metadata == null) this.response.metadata = saved_metadata;
    this.package_manager.async_network_task_queue.push(this);
}

pub const Authorization = enum {
    no_authorization,
    allow_authorization,
};

// We must use a less restrictive Accept header value
// https://github.com/oven-sh/bun/issues/341
// https://www.jfrog.com/jira/browse/RTFACT-18398
const accept_header_value = "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";
const accept_header_value_extended = "application/json, */*";

const default_headers_buf: string = "Accept" ++ accept_header_value;
const extended_headers_buf: string = "Accept" ++ accept_header_value_extended;

fn appendAuth(header_builder: *HeaderBuilder, scope: *const Npm.Registry.Scope) void {
    if (scope.token.len > 0) {
        header_builder.appendFmt("Authorization", "Bearer {s}", .{scope.token});
    } else if (scope.auth.len > 0) {
        header_builder.appendFmt("Authorization", "Basic {s}", .{scope.auth});
    } else {
        return;
    }
    header_builder.append("npm-auth-type", "legacy");
}

fn countAuth(header_builder: *HeaderBuilder, scope: *const Npm.Registry.Scope) void {
    if (scope.token.len > 0) {
        header_builder.count("Authorization", "");
        header_builder.content.cap += "Bearer ".len + scope.token.len;
    } else if (scope.auth.len > 0) {
        header_builder.count("Authorization", "");
        header_builder.content.cap += "Basic ".len + scope.auth.len;
    } else {
        return;
    }
    header_builder.count("npm-auth-type", "legacy");
}

const ForManifestError = OOM || error{
    InvalidURL,
};

pub fn forManifest(
    this: *NetworkTask,
    name: string,
    allocator: std.mem.Allocator,
    scope: *const Npm.Registry.Scope,
    loaded_manifest: ?*const Npm.PackageManifest,
    is_optional: bool,
    needs_extended: bool,
) ForManifestError!void {
    this.url_buf = blk: {
        const is_gitlab_registry = registry_utils.isGitLabRegistry(scope.url.href);

        if (is_gitlab_registry) {
            // For GitLab registries, construct URL as: {registry}/{package_name}
            // Don't URL-encode the package name for GitLab
            const gitlab_url = try std.fmt.allocPrint(allocator, "{s}/{s}", .{ strings.withoutTrailingSlash(scope.url.href), name });
            break :blk gitlab_url;
        }

        // Not all registries support scoped package names when fetching the manifest.
        // registry.npmjs.org supports both "@storybook%2Faddons" and "@storybook/addons"
        // Other registries like AWS codeartifact only support the former.
        // "npm" CLI requests the manifest with the encoded name.
        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var stack_fallback_allocator = std.heap.stackFallback(512, arena.allocator());
        var encoded_name = name;
        if (strings.containsChar(name, '/')) {
            encoded_name = try std.mem.replaceOwned(u8, stack_fallback_allocator.get(), name, "/", "%2f");
        }

        const tmp = bun.jsc.URL.join(
            bun.String.borrowUTF8(scope.url.href),
            bun.String.borrowUTF8(encoded_name),
        );
        defer tmp.deref();

        if (tmp.tag == .Dead) {
            if (!is_optional) {
                this.package_manager.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "Failed to join registry {f} and package {f} URLs",
                    .{ bun.fmt.QuotedFormatter{ .text = scope.url.href }, bun.fmt.QuotedFormatter{ .text = name } },
                ) catch |err| bun.handleOom(err);
            } else {
                this.package_manager.log.addWarningFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "Failed to join registry {f} and package {f} URLs",
                    .{ bun.fmt.QuotedFormatter{ .text = scope.url.href }, bun.fmt.QuotedFormatter{ .text = name } },
                ) catch |err| bun.handleOom(err);
            }
            return error.InvalidURL;
        }

        if (!(tmp.hasPrefixComptime("https://") or tmp.hasPrefixComptime("http://"))) {
            if (!is_optional) {
                this.package_manager.log.addErrorFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "Registry URL must be http:// or https://\nReceived: \"{f}\"",
                    .{tmp},
                ) catch |err| bun.handleOom(err);
            } else {
                this.package_manager.log.addWarningFmt(
                    null,
                    logger.Loc.Empty,
                    allocator,
                    "Registry URL must be http:// or https://\nReceived: \"{f}\"",
                    .{tmp},
                ) catch |err| bun.handleOom(err);
            }
            return error.InvalidURL;
        }

        // This actually duplicates the string! So we defer deref the WTF managed one above.
        break :blk try tmp.toOwnedSlice(allocator);
    };

    var last_modified: string = "";
    var etag: string = "";
    if (loaded_manifest) |manifest| {
        if ((needs_extended and manifest.pkg.has_extended_manifest) or !needs_extended) {
            last_modified = manifest.pkg.last_modified.slice(manifest.string_buf);
            etag = manifest.pkg.etag.slice(manifest.string_buf);
        }
    }

    var header_builder = HeaderBuilder{};

    countAuth(&header_builder, scope);

    if (etag.len != 0) {
        header_builder.count("If-None-Match", etag);
    }

    if (last_modified.len != 0) {
        header_builder.count("If-Modified-Since", last_modified);
    }

    if (header_builder.header_count > 0) {
        const accept_header = if (needs_extended) accept_header_value_extended else accept_header_value;
        header_builder.count("Accept", accept_header);
        if (last_modified.len > 0 and etag.len > 0) {
            header_builder.content.count(last_modified);
        }
        try header_builder.allocate(allocator);

        appendAuth(&header_builder, scope);

        if (etag.len != 0) {
            header_builder.append("If-None-Match", etag);
        } else if (last_modified.len != 0) {
            header_builder.append("If-Modified-Since", last_modified);
        }

        header_builder.append("Accept", accept_header);

        if (last_modified.len > 0 and etag.len > 0) {
            last_modified = header_builder.content.append(last_modified);
        }
    } else {
        const header_buf = if (needs_extended) &extended_headers_buf else &default_headers_buf;
        try header_builder.entries.append(
            allocator,
            .{
                .name = .{ .offset = 0, .length = @as(u32, @truncate("Accept".len)) },
                .value = .{ .offset = "Accept".len, .length = @as(u32, @truncate(header_buf.len - "Accept".len)) },
            },
        );
        header_builder.header_count = 1;
        header_builder.content = GlobalStringBuilder{ .ptr = @as([*]u8, @ptrCast(@constCast(header_buf.ptr))), .len = header_buf.len, .cap = header_buf.len };
    }

    this.response_buffer = try MutableString.init(allocator, 0);
    this.allocator = allocator;

    const url = URL.parse(this.url_buf);
    this.unsafe_http_client = AsyncHTTP.init(allocator, .GET, url, header_builder.entries, header_builder.content.ptr.?[0..header_builder.content.len], &this.response_buffer, "", this.getCompletionCallback(), HTTP.FetchRedirect.follow, .{
        .http_proxy = this.package_manager.httpProxy(url),
    });
    this.unsafe_http_client.client.flags.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();

    if (PackageManager.verbose_install) {
        this.unsafe_http_client.client.verbose = .headers;
    }

    this.callback = .{
        .package_manifest = .{
            .name = try strings.StringOrTinyString.initAppendIfNeeded(name, *FileSystem.FilenameStore, FileSystem.FilenameStore.instance),
            .loaded_manifest = if (loaded_manifest) |manifest| manifest.* else null,
            .is_extended_manifest = needs_extended,
        },
    };

    if (PackageManager.verbose_install) {
        this.unsafe_http_client.verbose = .headers;
        this.unsafe_http_client.client.verbose = .headers;
    }

    // Incase the ETag causes invalidation, we fallback to the last modified date.
    if (last_modified.len != 0 and bun.feature_flag.BUN_FEATURE_FLAG_LAST_MODIFIED_PRETEND_304.get()) {
        this.unsafe_http_client.client.flags.force_last_modified = true;
        this.unsafe_http_client.client.if_modified_since = last_modified;
    }
}

pub fn getCompletionCallback(this: *NetworkTask) HTTP.HTTPClientResult.Callback {
    return HTTP.HTTPClientResult.Callback.New(*NetworkTask, notify).init(this);
}

pub fn schedule(this: *NetworkTask, batch: *ThreadPool.Batch) void {
    this.unsafe_http_client.schedule(this.allocator, batch);
}

pub const ForTarballError = OOM || error{
    InvalidURL,
};

pub fn forTarball(
    this: *NetworkTask,
    allocator: std.mem.Allocator,
    tarball_: *const ExtractTarball,
    scope: *const Npm.Registry.Scope,
    authorization: NetworkTask.Authorization,
) ForTarballError!void {
    this.callback = .{ .extract = tarball_.* };
    const tarball = &this.callback.extract;
    const tarball_url = tarball.url.slice();
    if (tarball_url.len == 0) {
        this.url_buf = try ExtractTarball.buildURL(
            scope.url.href,
            tarball.name,
            tarball.resolution.value.npm.version,
            this.package_manager.lockfile.buffers.string_bytes.items,
        );
    } else {
        this.url_buf = tarball_url;
    }

    if (!(strings.hasPrefixComptime(this.url_buf, "https://") or strings.hasPrefixComptime(this.url_buf, "http://"))) {
        const msg = .{
            .fmt = "Expected tarball URL to start with https:// or http://, got {f} while fetching package {f}",
            .args = .{ bun.fmt.QuotedFormatter{ .text = this.url_buf }, bun.fmt.QuotedFormatter{ .text = tarball.name.slice() } },
        };

        try this.package_manager.log.addErrorFmt(null, .{}, allocator, msg.fmt, msg.args);
        return error.InvalidURL;
    }

    this.response_buffer = MutableString.initEmpty(allocator);
    this.allocator = allocator;

    var header_builder = HeaderBuilder{};
    var header_buf: string = "";

    if (authorization == .allow_authorization) {
        countAuth(&header_builder, scope);
    }

    if (header_builder.header_count > 0) {
        try header_builder.allocate(allocator);

        if (authorization == .allow_authorization) {
            appendAuth(&header_builder, scope);
        }

        header_buf = header_builder.content.ptr.?[0..header_builder.content.len];
    }

    const url = URL.parse(this.url_buf);

    var http_options: AsyncHTTP.Options = .{
        .http_proxy = this.package_manager.httpProxy(url),
    };

    if (ExtractTarball.usesStreamingExtraction()) {
        // Tell the HTTP client to invoke `notify` for every body chunk
        // instead of buffering the whole response. `notify` pushes each
        // chunk into `tarball_stream`, which schedules a drain task on
        // `thread_pool`; the drain task calls into libarchive until it
        // reports ARCHIVE_RETRY (out of input), then returns so the
        // worker can be reused for other install work. The next chunk
        // reschedules it and libarchive — whose state lives on the heap
        // — resumes exactly where it stopped.
        //
        // The stream itself is created by the caller (see
        // `generateNetworkTaskForTarball`) because it needs the
        // pre-allocated `Task` that carries the final result.
        //
        // Only wire up the one signal we need; `Signals.Store.to()`
        // would also publish `aborted`/`cert_errors`/etc., which makes
        // the HTTP client allocate an abort-tracker id and changes
        // keep-alive behaviour we don't want here.
        this.signal_store = .{};
        this.signal_store.response_body_streaming.store(true, .monotonic);
        http_options.signals = .{
            .response_body_streaming = &this.signal_store.response_body_streaming,
        };
    }

    this.unsafe_http_client = AsyncHTTP.init(allocator, .GET, url, header_builder.entries, header_buf, &this.response_buffer, "", this.getCompletionCallback(), HTTP.FetchRedirect.follow, http_options);
    this.unsafe_http_client.client.flags.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();
    if (PackageManager.verbose_install) {
        this.unsafe_http_client.client.verbose = .headers;
    }
}

/// Release any streaming-extraction resources that were never used because
/// the request errored before a drain was scheduled. Called on the main
/// thread from `runTasks` when falling back to the buffered path.
pub fn discardUnusedStreamingState(this: *NetworkTask, manager: *PackageManager) void {
    bun.debugAssert(!this.streaming_committed);
    if (this.tarball_stream) |stream| {
        stream.deinit();
        this.tarball_stream = null;
    }
    if (this.streaming_extract_task) |task| {
        manager.preallocated_resolve_tasks.put(task);
        this.streaming_extract_task = null;
    }
}

/// Prepare this task for another HTTP attempt (used by retry logic when
/// streaming extraction never started). Keeps the stream allocation so the
/// retry can still benefit from streaming.
pub fn resetStreamingForRetry(this: *NetworkTask) void {
    bun.debugAssert(!this.streaming_committed);
    if (this.tarball_stream) |stream| stream.resetForRetry();
    this.response = .{};
}

const string = []const u8;

const std = @import("std");

const install = @import("./install.zig");
const ExtractTarball = install.ExtractTarball;
const NetworkTask = install.NetworkTask;
const Npm = install.Npm;
const PackageManager = install.PackageManager;
const PatchTask = install.PatchTask;
const TarballStream = install.TarballStream;
const Task = install.Task;

const bun = @import("bun");
const GlobalStringBuilder = bun.StringBuilder;
const IdentityContext = bun.IdentityContext;
const MutableString = bun.MutableString;
const OOM = bun.OOM;
const ThreadPool = bun.ThreadPool;
const URL = bun.URL;
const logger = bun.logger;
const strings = bun.strings;

const Fs = bun.fs;
const FileSystem = Fs.FileSystem;

const HTTP = bun.http;
const AsyncHTTP = HTTP.AsyncHTTP;
const HeaderBuilder = HTTP.HeaderBuilder;

const registry_utils = @import("./registry_utils.zig");
