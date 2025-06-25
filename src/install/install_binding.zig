const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const logger = bun.logger;
const Path = bun.path;
const string = bun.string;
const Lockfile = bun.install.Lockfile;

pub const bun_install_js_bindings = struct {
    const JSValue = JSC.JSValue;
    const ZigString = JSC.ZigString;
    const JSGlobalObject = JSC.JSGlobalObject;

    pub fn generate(global: *JSGlobalObject) JSValue {
        const obj = JSValue.createEmptyObject(global, 2);
        const parseLockfile = ZigString.static("parseLockfile");
        obj.put(global, parseLockfile, JSC.createCallback(global, parseLockfile, 1, jsParseLockfile));
        return obj;
    }

    pub fn jsParseLockfile(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
        const allocator = bun.default_allocator;
        var log = logger.Log.init(allocator);
        defer log.deinit();

        const args = callFrame.arguments_old(1).slice();
        const cwd = try args[0].toSliceOrNull(globalObject);
        defer cwd.deinit();

        var dir = bun.openDirAbsoluteNotForDeletingOrRenaming(cwd.slice()) catch |err| {
            return globalObject.throw("failed to open: {s}, '{s}'", .{ @errorName(err), cwd.slice() });
        };
        defer dir.close();

        const lockfile_path = Path.joinAbsStringZ(cwd.slice(), &[_]string{"bun.lockb"}, .auto);

        var lockfile: Lockfile = undefined;
        lockfile.initEmpty(allocator);
        if (globalObject.bunVM().transpiler.resolver.env_loader == null) {
            globalObject.bunVM().transpiler.resolver.env_loader = globalObject.bunVM().transpiler.env;
        }

        // as long as we aren't migration from `package-lock.json`, leaving this undefined is okay
        const manager = globalObject.bunVM().transpiler.resolver.getPackageManager();

        const load_result: Lockfile.LoadResult = lockfile.loadFromDir(.fromStdDir(dir), manager, allocator, &log, true);

        switch (load_result) {
            .err => |err| {
                return globalObject.throw("failed to load lockfile: {s}, '{s}'", .{ @errorName(err.value), lockfile_path });
            },
            .not_found => {
                return globalObject.throw("lockfile not found: '{s}'", .{lockfile_path});
            },
            .ok => {},
        }

        var buffer = bun.MutableString.initEmpty(allocator);
        defer buffer.deinit();

        var buffered_writer = buffer.bufferedWriter();

        std.json.stringify(
            lockfile,
            .{
                .whitespace = .indent_2,
                .emit_null_optional_fields = true,
                .emit_nonportable_numbers_as_strings = true,
            },
            buffered_writer.writer(),
        ) catch |err| {
            return globalObject.throw("failed to print lockfile as JSON: {s}", .{@errorName(err)});
        };

        buffered_writer.flush() catch |err| {
            return globalObject.throw("failed to print lockfile as JSON: {s}", .{@errorName(err)});
        };

        var str = bun.String.createUTF8(buffer.list.items);
        defer str.deref();

        return str.toJSByParseJSON(globalObject);
    }
};
