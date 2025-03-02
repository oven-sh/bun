const bun = @import("root").bun;
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
const Shimmer = @import("./shimmer.zig").Shimmer;

/// Process information and control APIs
pub const Process = extern struct {
    pub const shim = Shimmer("Bun", "Process", @This());
    pub const name = "Process";
    pub const namespace = shim.namespace;
    var title_mutex = bun.Mutex{};

    pub fn getTitle(_: *JSGlobalObject, title: *ZigString) callconv(.C) void {
        title_mutex.lock();
        defer title_mutex.unlock();
        const str = bun.CLI.Bun__Node__ProcessTitle;
        title.* = ZigString.init(str orelse "bun");
    }

    // TODO: https://github.com/nodejs/node/blob/master/deps/uv/src/unix/darwin-proctitle.c
    pub fn setTitle(globalObject: *JSGlobalObject, newvalue: *ZigString) callconv(.C) JSValue {
        title_mutex.lock();
        defer title_mutex.unlock();
        if (bun.CLI.Bun__Node__ProcessTitle) |_| bun.default_allocator.free(bun.CLI.Bun__Node__ProcessTitle.?);
        bun.CLI.Bun__Node__ProcessTitle = newvalue.dupe(bun.default_allocator) catch bun.outOfMemory();
        return newvalue.toJS(globalObject);
    }

    pub const getArgv = JSC.Node.Process.getArgv;
    pub const getCwd = JSC.Node.Process.getCwd;
    pub const setCwd = JSC.Node.Process.setCwd;
    pub const exit = JSC.Node.Process.exit;
    pub const getArgv0 = JSC.Node.Process.getArgv0;
    pub const getExecPath = JSC.Node.Process.getExecPath;
    pub const getExecArgv = JSC.Node.Process.getExecArgv;

    pub const Export = shim.exportFunctions(.{
        .getTitle = getTitle,
        .setTitle = setTitle,
        .getArgv = getArgv,
        .getCwd = getCwd,
        .setCwd = setCwd,
        .exit = exit,
        .getArgv0 = getArgv0,
        .getExecPath = getExecPath,
        .getExecArgv = getExecArgv,
    });

    comptime {
        @export(&getTitle, .{
            .name = Export[0].symbol_name,
        });
        @export(&setTitle, .{
            .name = Export[1].symbol_name,
        });
        @export(&getArgv, .{
            .name = Export[2].symbol_name,
        });
        @export(&getCwd, .{
            .name = Export[3].symbol_name,
        });
        @export(&setCwd, .{
            .name = Export[4].symbol_name,
        });
        @export(&exit, .{
            .name = Export[5].symbol_name,
        });
        @export(&getArgv0, .{
            .name = Export[6].symbol_name,
        });
        @export(&getExecPath, .{
            .name = Export[7].symbol_name,
        });
        @export(&getExecArgv, .{
            .name = Export[8].symbol_name,
        });
    }
};
