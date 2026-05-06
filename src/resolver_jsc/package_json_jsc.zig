//! JSC bridges for `src/resolver/package_json.zig`. Kept out of `resolver/`
//! so that directory has no JSC references. Referenced back via
//! `PackageJSON.SideEffects.TestingAPIs`.

pub const TestingAPIs = struct {
    /// Exercise `SideEffects.buildAbsolutePattern` + `hasSideEffects` on a
    /// synthetic `(package_dir, patterns, runtime_path, use_pre_fix)` tuple
    /// so the test harness can verify the Windows-path fix for #30320 on
    /// any platform.
    ///
    /// Signature:
    ///   `sideEffectsHasSideEffects(dir, patterns, path, usePreFix) -> bool`
    ///
    ///   - `dir`       — absolute directory the package.json "lives in",
    ///                   with trailing separator. Pass `C:\pkg\` to simulate
    ///                   Windows.
    ///   - `patterns`  — the `sideEffects` string array, e.g.
    ///                   `["adapters/**/*.js"]` or `["adapters/foo.js"]`.
    ///   - `path`      — the runtime file path the resolver would hand to
    ///                   `hasSideEffects`. Pass `C:\pkg\adapters\foo.js` to
    ///                   simulate a Windows runtime path.
    ///   - `usePreFix` — when truthy, build patterns with the pre-#30320
    ///                   `r.fs.join` path so the test can assert the bug
    ///                   actually reproduces. Defaults to false (fixed
    ///                   path via `r.fs.abs`).
    ///
    /// Returns `true` if `path` matches any pattern (i.e. has side effects),
    /// `false` otherwise. Before the fix, Windows-shaped inputs always
    /// returned `false` because the stored pattern carried a leading `/` that
    /// the runtime path never did.
    pub fn sideEffectsHasSideEffects(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const args = callframe.arguments();
        if (args.len < 3) {
            return globalThis.throw("sideEffectsHasSideEffects(dir, patterns, path, usePreFix?) takes 3 or 4 arguments", .{});
        }

        const dir_str = try args[0].toBunString(globalThis);
        defer dir_str.deref();
        const patterns_val = args[1];
        const path_str = try args[2].toBunString(globalThis);
        defer path_str.deref();
        const use_pre_fix = args.len >= 4 and args[3].toBoolean();

        if (!patterns_val.jsType().isArray()) {
            return globalThis.throwTypeError("sideEffectsHasSideEffects: patterns must be an array", .{});
        }

        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        const allocator = arena.allocator();

        const dir = dir_str.toUTF8(allocator);
        const path = path_str.toUTF8(allocator);
        defer dir.deinit();
        defer path.deinit();

        const resolver_ptr = &globalThis.bunVM().transpiler.resolver;

        const len = try patterns_val.getLength(globalThis);

        var map = package_json.PackageJSON.SideEffects.Map{};
        var glob_list = package_json.PackageJSON.SideEffects.GlobList{};
        map.ensureTotalCapacity(allocator, @intCast(len)) catch return globalThis.throwOutOfMemoryValue();
        glob_list.ensureTotalCapacity(allocator, @intCast(len)) catch return globalThis.throwOutOfMemoryValue();
        var has_globs = false;
        var has_exact = false;

        var i: u32 = 0;
        while (i < len) : (i += 1) {
            const item = try patterns_val.getIndex(globalThis, i);
            const item_str = try item.toBunString(globalThis);
            defer item_str.deref();
            const name_slice = item_str.toUTF8(allocator);
            defer name_slice.deinit();
            const name = allocator.dupe(u8, name_slice.slice()) catch return globalThis.throwOutOfMemoryValue();

            const normalized_pattern = if (use_pre_fix)
                package_json.PackageJSON.SideEffects.buildAbsolutePatternPreFix(
                    allocator,
                    resolver_ptr,
                    dir.slice(),
                    name,
                ) catch continue
            else
                package_json.PackageJSON.SideEffects.buildAbsolutePattern(
                    allocator,
                    resolver_ptr,
                    dir.slice(),
                    name,
                ) catch continue;

            const is_glob = std.mem.indexOfAny(u8, name, "*?[{") != null;
            if (is_glob) {
                glob_list.appendAssumeCapacity(normalized_pattern);
                has_globs = true;
            } else {
                _ = map.getOrPutAssumeCapacity(bun.StringHashMapUnowned.Key.init(normalized_pattern));
                has_exact = true;
            }
        }

        const side_effects: package_json.PackageJSON.SideEffects = if (has_globs and has_exact)
            .{ .mixed = .{ .exact = map, .globs = glob_list } }
        else if (has_globs)
            .{ .glob = glob_list }
        else if (has_exact)
            .{ .map = map }
        else
            .{ .unspecified = {} };

        // When exercising the pre-fix path, also bypass the normalization
        // `hasSideEffects` now does on the runtime key — that normalization
        // is part of the fix too.
        if (use_pre_fix) {
            return switch (side_effects) {
                .unspecified => .jsBoolean(true),
                .false => .jsBoolean(false),
                .map => |m| .jsBoolean(m.contains(bun.StringHashMapUnowned.Key.init(path.slice()))),
                .glob => |gl| blk: {
                    const normalized_path = package_json.PackageJSON.normalizePathForGlob(bun.default_allocator, path.slice()) catch break :blk .jsBoolean(true);
                    defer bun.default_allocator.free(normalized_path);
                    for (gl.items) |pattern| {
                        if (bun.glob.match(pattern, normalized_path).matches()) break :blk .jsBoolean(true);
                    }
                    break :blk .jsBoolean(false);
                },
                .mixed => |mx| blk: {
                    if (mx.exact.contains(bun.StringHashMapUnowned.Key.init(path.slice()))) break :blk .jsBoolean(true);
                    const normalized_path = package_json.PackageJSON.normalizePathForGlob(bun.default_allocator, path.slice()) catch break :blk .jsBoolean(true);
                    defer bun.default_allocator.free(normalized_path);
                    for (mx.globs.items) |pattern| {
                        if (bun.glob.match(pattern, normalized_path).matches()) break :blk .jsBoolean(true);
                    }
                    break :blk .jsBoolean(false);
                },
            };
        }

        const matches = side_effects.hasSideEffects(path.slice());
        return .jsBoolean(matches);
    }
};

const package_json = @import("../resolver/package_json.zig");
const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
