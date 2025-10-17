const DirectoryRoute = @This();

dirfd: bun.FileDescriptor,
path: jsc.ZigString.Slice,
base_url: bun.String,
prefix_path: []const u8,
ref_count: RefCount,
server: ?AnyServer = null,

pub fn on(this: *DirectoryRoute, req: *uws.Request, resp: AnyResponse, method: bun.http.Method) void {
    const original_pathname = req.url();
    const pathname = if (bun.strings.hasPrefix(original_pathname, this.prefix_path)) original_pathname[this.prefix_path.len..] else original_pathname;
    const url = jsc.URL.join(this.base_url, bun.String.init(pathname));
    defer url.deref();
    if (url.isEmpty()) {
        req.setYield(true);
        log("{s} {s} => empty", .{ req.method(), pathname });

        return;
    }

    const file_path = jsc.URL.pathFromFileURL(url);
    defer file_path.deref();

    const file_path_slice = file_path.toUTF8(bun.default_allocator);
    defer file_path_slice.deinit();

    var path = file_path_slice.slice();
    if (path.len > 0 and bun.strings.charIsAnySlash(path[0])) {
        path = path[1..];
    }

    const fd = switch (bun.sys.openatA(
        this.dirfd,
        path,
        bun.O.RDONLY | bun.O.CLOEXEC | bun.O.NONBLOCK | bun.O.NOCTTY,
        0,
    )) {
        .result => |file| file,
        .err => |*err| {
            req.setYield(true);
            log("{s} {s} => {f}", .{ req.method(), pathname, err.* });
            return;
        },
    };

    const store = jsc.WebCore.Blob.Store.initFile(.{ .fd = fd }, null, bun.default_allocator) catch |err| bun.handleOom(err);
    const blob = jsc.WebCore.Blob.initWithStore(store, this.server.?.globalThis());
    const file_route = FileRoute.initFromBlob(blob, .{ .server = this.server });

    file_route.ref();
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }
    log("{s} {s} => {s}", .{ req.method(), pathname, file_path_slice.slice() });
    file_route.onOpenedFile(req, resp, method, file_path_slice.slice(), fd);
}

pub fn onHEADRequest(this: *DirectoryRoute, req: *uws.Request, resp: AnyResponse) void {
    bun.debugAssert(this.server != null);

    this.on(req, resp, .HEAD);
}

pub fn onRequest(this: *DirectoryRoute, req: *uws.Request, resp: AnyResponse) void {
    this.on(req, resp, bun.http.Method.find(req.method()) orelse .GET);
}

pub fn create(path: jsc.ZigString.Slice, prefix_path: []const u8, server: ?AnyServer) bun.sys.Maybe(*DirectoryRoute) {
    const fd = switch (bun.sys.openA(path.slice(), bun.O.DIRECTORY | bun.O.PATH, 0)) {
        .result => |res| res,
        .err => |err| return .{ .err = err },
    };
    return .{ .result = init(fd, path, prefix_path, server) };
}

pub fn init(dirfd: bun.FileDescriptor, path: jsc.ZigString.Slice, prefix_path: []const u8, server: ?AnyServer) *DirectoryRoute {
    return bun.new(DirectoryRoute, .{
        .dirfd = dirfd,
        .path = path,
        .server = server,
        .ref_count = .init(),
        .base_url = jsc.URL.fileURLFromString(.init(path.slice())),
        .prefix_path = bun.default_allocator.dupe(u8, prefix_path) catch |err| bun.handleOom(err),
    });
}

pub fn deinit(this: *DirectoryRoute) void {
    const dirfd = this.dirfd;
    this.dirfd = bun.invalid_fd;
    if (dirfd.isValid()) {
        dirfd.close();
    }

    this.path.deinit();
    this.base_url.deref();
    bun.default_allocator.free(this.prefix_path);

    bun.destroy(this);
}

pub fn memoryCost(this: *const DirectoryRoute) usize {
    var cost: usize = @sizeOf(@This());
    cost += this.base_url.byteSlice().len;
    cost += this.path.byteSlice().len;
    return cost;
}

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

const bun = @import("bun");
const std = @import("std");
const jsc = bun.jsc;
const uws = bun.uws;
const AnyServer = jsc.API.AnyServer;
const AnyResponse = uws.AnyResponse;
const FileRoute = @import("./FileRoute.zig");
const log = bun.Output.scoped(.DirectoryRoute, .hidden);
