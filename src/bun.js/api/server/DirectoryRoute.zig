const DirectoryRoute = @This();

ref_count: RefCount,
server: ?AnyServer = null,
directory_path: []const u8,
directory_fd: bun.FileDescriptor,

pub fn init(directory_path: []const u8) !*DirectoryRoute {
    const path_duped = bun.default_allocator.dupe(u8, directory_path) catch bun.outOfMemory();
    errdefer bun.default_allocator.free(path_duped);

    const fd = switch (bun.sys.openA(path_duped, bun.O.DIRECTORY | bun.O.RDONLY | bun.O.CLOEXEC, 0)) {
        .result => |fd| fd,
        .err => {
            bun.default_allocator.free(path_duped);
            return error.AccessDenied;
        },
    };

    return bun.new(DirectoryRoute, .{
        .ref_count = .init(),
        .directory_path = path_duped,
        .directory_fd = fd,
    });
}

pub fn deinit(this: *DirectoryRoute) void {
    this.directory_fd.close();
    bun.default_allocator.free(this.directory_path);
    bun.destroy(this);
}

pub fn memoryCost(this: *const DirectoryRoute) usize {
    return @sizeOf(DirectoryRoute) + this.directory_path.len;
}

pub fn fromJS(globalThis: *JSC.JSGlobalObject, argument: JSC.JSValue) bun.JSError!?*DirectoryRoute {
    if (argument.isObject()) {
        if (try argument.get(globalThis, "dir")) |dir_value| {
            const dir_slice = try dir_value.toSlice(globalThis, bun.default_allocator);
            defer dir_slice.deinit();
            
            return DirectoryRoute.init(dir_slice.slice()) catch |err| {
                return globalThis.throwInvalidArguments("Failed to open directory {s}: {s}", .{ dir_slice.slice(), @errorName(err) });
            };
        }
    }
    return null;
}

pub fn onHEADRequest(this: *DirectoryRoute, req: *uws.Request, resp: AnyResponse) void {
    this.on(req, resp, .HEAD);
}

pub fn onRequest(this: *DirectoryRoute, req: *uws.Request, resp: AnyResponse) void {
    this.on(req, resp, bun.http.Method.find(req.method()) orelse .GET);
}

pub fn on(this: *DirectoryRoute, req: *uws.Request, resp: AnyResponse, method: bun.http.Method) void {
    bun.debugAssert(this.server != null);
    this.ref();
    
    if (this.server) |server| {
        server.onPendingRequest();
        resp.timeout(server.config().idleTimeout);
    }

    const url = req.url();
    
    // Try to resolve the file path
    const file_path = this.resolveFilePath(url) catch {
        req.setYield(true);
        this.deref();
        return;
    };
    defer bun.default_allocator.free(file_path);

    // Try to open the file using openat
    const open_flags = bun.O.RDONLY | bun.O.CLOEXEC | bun.O.NONBLOCK;
    const fd_result = bun.sys.openatA(this.directory_fd, file_path, open_flags, 0);
    
    if (fd_result == .err) {
        // Try with .html extension
        if (this.tryWithHtmlExtension(file_path)) |html_path| {
            defer bun.default_allocator.free(html_path);
            const html_fd_result = bun.sys.openatA(this.directory_fd, html_path, open_flags, 0);
            
            if (html_fd_result == .result) {
                this.serveFile(req, resp, method, html_fd_result.result, html_path);
                return;
            }
        }
        
        // Try index.html or index.htm for directories
        if (this.tryIndexFiles(file_path)) |index_path| {
            defer bun.default_allocator.free(index_path);
            const index_fd_result = bun.sys.openatA(this.directory_fd, index_path, open_flags, 0);
            
            if (index_fd_result == .result) {
                this.serveFile(req, resp, method, index_fd_result.result, index_path);
                return;
            }
        }
        
        // File not found, yield to next handler
        req.setYield(true);
        this.deref();
        return;
    }
    
    const fd = fd_result.result;
    
    // Check if it's a directory
    const stat = switch (bun.sys.fstat(fd)) {
        .result => |s| s,
        .err => {
            bun.Async.Closer.close(fd, if (bun.Environment.isWindows) bun.windows.libuv.Loop.get());
            req.setYield(true);
            this.deref();
            return;
        },
    };
    
    if (bun.S.ISDIR(@intCast(stat.mode))) {
        bun.Async.Closer.close(fd, if (bun.Environment.isWindows) bun.windows.libuv.Loop.get());
        
        // Try index.html or index.htm for directories
        if (this.tryIndexFiles(file_path)) |index_path| {
            defer bun.default_allocator.free(index_path);
            const index_fd_result = bun.sys.openatA(this.directory_fd, index_path, open_flags, 0);
            
            if (index_fd_result == .result) {
                this.serveFile(req, resp, method, index_fd_result.result, index_path);
                return;
            }
        }
        
        req.setYield(true);
        this.deref();
        return;
    }
    
    this.serveFile(req, resp, method, fd, file_path);
}

fn resolveFilePath(this: *DirectoryRoute, url: []const u8) ![]const u8 {
    _ = this;
    
    // Remove leading slash if present
    const clean_url = if (url.len > 0 and url[0] == '/') url[1..] else url;
    
    // Basic path traversal protection - reject paths containing ".."
    if (std.mem.indexOf(u8, clean_url, "..") != null) {
        return error.InvalidPath;
    }
    
    // If empty path, serve index
    if (clean_url.len == 0) {
        return bun.default_allocator.dupe(u8, ".");
    }
    
    return bun.default_allocator.dupe(u8, clean_url);
}

fn tryWithHtmlExtension(this: *DirectoryRoute, file_path: []const u8) ?[]const u8 {
    _ = this;
    
    // Don't add .html if path already has an extension
    if (std.mem.lastIndexOfScalar(u8, file_path, '.') != null) {
        return null;
    }
    
    return std.fmt.allocPrint(bun.default_allocator, "{s}.html", .{file_path}) catch null;
}

fn tryIndexFiles(this: *DirectoryRoute, file_path: []const u8) ?[]const u8 {
    _ = this;
    
    // Don't add index.html if path already ends with it
    if (std.mem.endsWith(u8, file_path, "/index.html")) {
        return null;
    }
    
    const base_path = if (std.mem.eql(u8, file_path, ".")) "" else file_path;
    
    // Try index.html first
    const index_html = if (base_path.len == 0) 
        bun.default_allocator.dupe(u8, "index.html") catch null
    else
        std.fmt.allocPrint(bun.default_allocator, "{s}/index.html", .{base_path}) catch null;
    
    if (index_html) |path| {
        return path;
    }
    
    // Try index.htm as fallback
    if (base_path.len == 0) {
        return bun.default_allocator.dupe(u8, "index.htm") catch null;
    } else {
        return std.fmt.allocPrint(bun.default_allocator, "{s}/index.htm", .{base_path}) catch null;
    }
}

fn serveFile(this: *DirectoryRoute, req: *uws.Request, resp: AnyResponse, method: bun.http.Method, fd: bun.FileDescriptor, file_path: []const u8) void {
    // Close the file descriptor since we'll let FileRoute open it with a path
    bun.Async.Closer.close(fd, if (bun.Environment.isWindows) bun.windows.libuv.Loop.get());
    
    // Create full path by combining directory path with file path
    const full_path = std.fmt.allocPrint(bun.default_allocator, "{s}/{s}", .{ this.directory_path, file_path }) catch {
        req.setYield(true);
        this.deref();
        return;
    };
    defer bun.default_allocator.free(full_path);
    
    // Create a PathOrFileDescriptor from the full path
    const path_or_fd = JSC.Node.PathOrFileDescriptor{ .path = .{ .slice_with_underlying_string = bun.SliceWithUnderlyingString.fromUTF8(full_path) } };
    
    // Create a blob from the file path
    const store = Blob.Store.initFile(path_or_fd, null, bun.default_allocator) catch {
        req.setYield(true);
        this.deref();
        return;
    };
    
    const blob = Blob.initWithStore(store, this.server.?.globalThis());
    
    // Create a FileRoute to handle the actual file serving
    const file_route = FileRoute.initFromBlob(blob, .{
        .server = this.server,
        .status_code = 200,
        .headers = null,
    });
    
    // Let the FileRoute handle the request
    file_route.on(req, resp, method);
    
    // FileRoute will handle its own cleanup, so we just need to deref ourselves
    this.deref();
}

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const uws = bun.uws;
const AnyServer = JSC.API.AnyServer;
const Blob = JSC.WebCore.Blob;
const FileRoute = @import("./FileRoute.zig");
const AnyResponse = uws.AnyResponse;
const strings = bun.strings;