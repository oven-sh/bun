pub const bun_install_js_bindings = struct {
    const JSValue = jsc.JSValue;
    const ZigString = jsc.ZigString;
    const JSGlobalObject = jsc.JSGlobalObject;

    pub fn generate(global: *JSGlobalObject) JSValue {
        const obj = JSValue.createEmptyObject(global, 1);
        const parseLockfile = ZigString.static("parseLockfile");
        obj.put(global, parseLockfile, jsc.JSFunction.create(global, "parseLockfile", jsParseLockfile, 1, .{}));
        return obj;
    }

    pub fn jsParseLockfile(globalObject: *JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
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

        const stringified = bun.handleOom(std.fmt.allocPrint(allocator, "{f}", .{std.json.fmt(lockfile, .{
            .whitespace = .indent_2,
            .emit_null_optional_fields = true,
            .emit_nonportable_numbers_as_strings = true,
        })}));
        defer allocator.free(stringified);

        var str = bun.String.cloneUTF8(stringified);
        defer str.deref();

        return str.toJSByParseJSON(globalObject);
    }
};

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const Path = bun.path;
const jsc = bun.jsc;
const logger = bun.logger;
const Lockfile = bun.install.Lockfile;
