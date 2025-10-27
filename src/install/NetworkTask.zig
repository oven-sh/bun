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

pub const DedupeMapEntry = struct {
    is_required: bool,
};
pub const DedupeMap = std.HashMap(Task.Id, DedupeMapEntry, IdentityContext(Task.Id), 80);

pub fn notify(this: *NetworkTask, async_http: *AsyncHTTP, result: bun.http.HTTPClientResult) void {
    defer this.package_manager.wake();
    async_http.real.?.* = async_http.*;
    async_http.real.?.response_buffer = async_http.response_buffer;
    this.response = result;
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

    this.unsafe_http_client = AsyncHTTP.init(allocator, .GET, url, header_builder.entries, header_buf, &this.response_buffer, "", this.getCompletionCallback(), HTTP.FetchRedirect.follow, .{
        .http_proxy = this.package_manager.httpProxy(url),
    });
    this.unsafe_http_client.client.flags.reject_unauthorized = this.package_manager.tlsRejectUnauthorized();
    if (PackageManager.verbose_install) {
        this.unsafe_http_client.client.verbose = .headers;
    }
}

const string = []const u8;

const std = @import("std");

const install = @import("./install.zig");
const ExtractTarball = install.ExtractTarball;
const NetworkTask = install.NetworkTask;
const Npm = install.Npm;
const PackageManager = install.PackageManager;
const PatchTask = install.PatchTask;
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
