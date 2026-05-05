//! JSC host fns extracted from `src/install/npm.zig` so that `install/` has
//! no `JSValue`/`JSGlobalObject`/`CallFrame` references. Each enum keeps a
//! `pub const jsFunction… = @import(...)` alias so call sites and the
//! `$newZigFunction("npm.zig", "…")` codegen path are unchanged.

pub fn operatingSystemIsMatch(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(1);
    var operating_system = npm.OperatingSystem.negatable(.none);
    var iter = try args.ptr[0].arrayIterator(globalObject);
    while (try iter.next()) |item| {
        const slice = try item.toSlice(globalObject, bun.default_allocator);
        defer slice.deinit();
        operating_system.apply(slice.slice());
        if (globalObject.hasException()) return .zero;
    }
    if (globalObject.hasException()) return .zero;
    return jsc.JSValue.jsBoolean(operating_system.combine().isMatch(npm.OperatingSystem.current));
}

pub fn libcIsMatch(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(1);
    var libc = npm.Libc.negatable(.none);
    var iter = args.ptr[0].arrayIterator(globalObject);
    while (iter.next()) |item| {
        const slice = item.toSlice(globalObject, bun.default_allocator);
        defer slice.deinit();
        libc.apply(slice.slice());
        if (globalObject.hasException()) return .zero;
    }
    if (globalObject.hasException()) return .zero;
    return jsc.JSValue.jsBoolean(libc.combine().isMatch(npm.Libc.current));
}

pub fn architectureIsMatch(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(1);
    var architecture = npm.Architecture.negatable(.none);
    var iter = try args.ptr[0].arrayIterator(globalObject);
    while (try iter.next()) |item| {
        const slice = try item.toSlice(globalObject, bun.default_allocator);
        defer slice.deinit();
        architecture.apply(slice.slice());
        if (globalObject.hasException()) return .zero;
    }
    if (globalObject.hasException()) return .zero;
    return jsc.JSValue.jsBoolean(architecture.combine().isMatch(npm.Architecture.current));
}

/// Formerly `npm.PackageManifest.bindings` — testing-only (`internal-for-testing.ts`).
pub const ManifestBindings = struct {
    pub fn generate(global: *jsc.JSGlobalObject) jsc.JSValue {
        const obj = jsc.JSValue.createEmptyObject(global, 1);
        const parseManifestString = jsc.ZigString.static("parseManifest");
        obj.put(global, parseManifestString, jsc.JSFunction.create(global, "parseManifest", jsParseManifest, 2, .{}));
        return obj;
    }

    pub fn jsParseManifest(global: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callFrame.arguments_old(2).slice();
        if (args.len < 2 or !args[0].isString() or !args[1].isString()) {
            return global.throw("expected manifest filename and registry string arguments", .{});
        }

        const manifest_filename_str = try args[0].toBunString(global);
        defer manifest_filename_str.deref();

        const manifest_filename = manifest_filename_str.toUTF8(bun.default_allocator);
        defer manifest_filename.deinit();

        const registry_str = try args[1].toBunString(global);
        defer registry_str.deref();

        const registry = registry_str.toUTF8(bun.default_allocator);
        defer registry.deinit();

        const manifest_file = std.fs.cwd().openFile(manifest_filename.slice(), .{}) catch |err| {
            return global.throw("failed to open manifest file \"{s}\": {s}", .{ manifest_filename.slice(), @errorName(err) });
        };
        defer manifest_file.close();

        const scope: npm.Registry.Scope = .{
            .url_hash = npm.Registry.Scope.hash(strings.withoutTrailingSlash(registry.slice())),
            .url = .{
                .host = strings.withoutTrailingSlash(strings.withoutPrefixComptime(registry.slice(), "http://")),
                .hostname = strings.withoutTrailingSlash(strings.withoutPrefixComptime(registry.slice(), "http://")),
                .href = registry.slice(),
                .origin = strings.withoutTrailingSlash(registry.slice()),
                .protocol = if (strings.indexOfChar(registry.slice(), ':')) |colon| registry.slice()[0..colon] else "",
            },
        };

        const maybe_package_manifest = npm.PackageManifest.Serializer.loadByFile(bun.default_allocator, &scope, bun.sys.File.from(manifest_file)) catch |err| {
            return global.throw("failed to load manifest file: {s}", .{@errorName(err)});
        };

        const package_manifest: npm.PackageManifest = maybe_package_manifest orelse {
            return global.throw("manifest is invalid ", .{});
        };

        var buf: std.ArrayListUnmanaged(u8) = .{};
        const writer = buf.writer(bun.default_allocator);

        // TODO: we can add more information. for now just versions is fine

        try writer.print("{{\"name\":\"{s}\",\"versions\":[", .{package_manifest.name()});

        for (package_manifest.versions, 0..) |version, i| {
            if (i == package_manifest.versions.len - 1)
                try writer.print("\"{f}\"]}}", .{version.fmt(package_manifest.string_buf)})
            else
                try writer.print("\"{f}\",", .{version.fmt(package_manifest.string_buf)});
        }

        var result = bun.String.borrowUTF8(buf.items);
        defer result.deref();

        return result.toJSByParseJSON(global);
    }
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const strings = bun.strings;
const npm = bun.install.Npm;
