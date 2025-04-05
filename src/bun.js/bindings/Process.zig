/// Process information and control APIs
pub const Process = opaque {
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

    comptime {
        @export(&getTitle, .{ .name = "Bun__Process__getTitle" });
        @export(&setTitle, .{ .name = "Bun__Process__setTitle" });
        @export(&getArgv, .{ .name = "Bun__Process__getArgv" });
        @export(&getCwd, .{ .name = "Bun__Process__getCwd" });
        @export(&setCwd, .{ .name = "Bun__Process__setCwd" });
        @export(&exit, .{ .name = "Bun__Process__exit" });
        @export(&getArgv0, .{ .name = "Bun__Process__getArgv0" });
        @export(&getExecPath, .{ .name = "Bun__Process__getExecPath" });
        @export(&getExecArgv, .{ .name = "Bun__Process__getExecArgv" });
    }
};

const bun = @import("root").bun;
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
