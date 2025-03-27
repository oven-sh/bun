const bun = @import("root").bun;
const JSC = bun.JSC;
const std = @import("std");
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ErrorableString = JSC.ErrorableString;

// https://github.com/nodejs/node/blob/40ef9d541ed79470977f90eb445c291b95ab75a0/lib/internal/modules/cjs/loader.js#L666
pub export fn NodeModuleModule__findPath(
    global: *JSGlobalObject,
    request_bun_str: bun.String,
    paths_maybe: ?*JSC.JSArray,
) JSValue {
    var stack_buf = std.heap.stackFallback(8192, bun.default_allocator);
    const alloc = stack_buf.get();

    const request_slice = request_bun_str.toUTF8(alloc);
    defer request_slice.deinit();
    const request = request_slice.slice();

    const absolute_request = std.fs.path.isAbsolute(request);
    if (!absolute_request and paths_maybe == null) {
        return .false;
    }

    // for each path
    const found = if (paths_maybe) |paths| found: {
        var iter = paths.iterator(global);
        while (iter.next()) |path| {
            const cur_path = bun.String.fromJS(path, global) catch |err| switch (err) {
                error.JSError => return .zero,
                error.OutOfMemory => return global.throwOutOfMemoryValue(),
            };
            defer cur_path.deref();

            if (findPathInner(request_bun_str, cur_path, global)) |found| {
                break :found found;
            }
        }

        break :found null;
    } else findPathInner(request_bun_str, bun.String.static(""), global);

    if (found) |str| {
        return str.toJS(global);
    }

    return .false;
}

fn findPathInner(
    request: bun.String,
    cur_path: bun.String,
    global: *JSGlobalObject,
) ?bun.String {
    var errorable: ErrorableString = undefined;
    JSC.VirtualMachine.resolveMaybeNeedsTrailingSlash(
        &errorable,
        global,
        request,
        cur_path,
        null,
        false,
        true,
        true,
    ) catch |err| switch (err) {
        error.JSError => {
            global.clearException();
            return null;
        },
        else => return null,
    };
    return errorable.unwrap() catch null;
}

pub fn _stat(path: []const u8) i32 {
    const exists = bun.sys.existsAtType(.cwd(), path).unwrap() catch
        return -1; // Returns a negative integer for any other kind of strings.
    return switch (exists) {
        .file => 0, // Returns 0 for files.
        .directory => 1, // Returns 1 for directories.
    };
}

pub const CustomLoader = union(enum) {
    loader: bun.options.Loader,
    /// Retrieve via WriteBarrier in `global->lazyRequireExtensionsObject().get(index)`
    custom: u32,

    pub const Packed = enum(u32) {
        const loader_start: u32 = std.math.maxInt(u32) - 4;
        js = loader_start,
        json = loader_start + 1,
        napi = loader_start + 2,
        ts = loader_start + 3,
        /// custom
        _,

        pub fn pack(loader: CustomLoader) Packed {
            return switch (loader) {
                .loader => |basic| switch (basic) {
                    .js => .js,
                    .json => .json,
                    .napi => .napi,
                    .ts => .ts,
                    else => brk: {
                        bun.debugAssert(false);
                        break :brk .js;
                    },
                },
                .custom => |custom| @enumFromInt(custom),
            };
        }

        pub fn unpack(self: Packed) CustomLoader {
            return switch (self) {
                .js => .{ .loader = .js },
                .json => .{ .loader = .json },
                .napi => .{ .loader = .napi },
                .ts => .{ .loader = .ts },
                _ => .{ .custom = @intFromEnum(self) },
            };
        }
    };
};

extern fn JSCommonJSExtensions__appendFunction(global: *JSC.JSGlobalObject, value: JSC.JSValue) u32;
extern fn JSCommonJSExtensions__setFunction(global: *JSC.JSGlobalObject, index: u32, value: JSC.JSValue) void;
/// Returns the index of the last value, which must have it's references updated to `index`
extern fn JSCommonJSExtensions__swapRemove(global: *JSC.JSGlobalObject, index: u32) u32;

// Memory management is complicated because JSValues are stored in gc-visitable
// WriteBarriers in C++ but the hash map for extensions is in Zig for flexibility.
fn onRequireExtensionModify(global: *JSC.JSGlobalObject, str: []const u8, kind: i32, value: JSC.JSValue) !void {
    bun.assert(kind >= -1 and kind <= 4);
    const vm = global.bunVM();
    const list = &vm.commonjs_custom_extensions;
    defer vm.transpiler.resolver.opts.extra_cjs_extensions = list.keys();
    const is_built_in = bun.options.defaultLoaders.get(str) != null;
    if (kind >= 0) {
        const loader: CustomLoader = switch (kind) {
            1 => .{ .loader = .js },
            2 => .{ .loader = .json },
            3 => .{ .loader = .napi },
            4 => .{ .loader = .ts },
            else => .{ .custom = undefined }, // to be filled in later
        };
        const gop = try list.getOrPut(bun.default_allocator, str);
        if (!gop.found_existing) {
            const dupe = try bun.default_allocator.dupe(u8, str);
            errdefer bun.default_allocator.free(dupe);
            gop.key_ptr.* = dupe;
            if (is_built_in) {
                vm.has_mutated_built_in_extensions += 1;
            }
            gop.value_ptr.* = .pack(switch (loader) {
                .loader => loader,
                .custom => .{
                    .custom = JSCommonJSExtensions__appendFunction(global, value),
                },
            });
        } else {
            const existing = gop.value_ptr.*.unpack();
            if (existing == .custom and loader != .custom) {
                swapRemoveExtension(vm, existing.custom);
            }
            gop.value_ptr.* = .pack(switch (loader) {
                .loader => loader,
                .custom => .{
                    .custom = if (existing == .custom) new: {
                        JSCommonJSExtensions__setFunction(global, existing.custom, value);
                        break :new existing.custom;
                    } else JSCommonJSExtensions__appendFunction(global, value),
                },
            });
        }
    } else if (list.fetchSwapRemove(str)) |prev| {
        bun.default_allocator.free(prev.key);
        if (is_built_in) {
            vm.has_mutated_built_in_extensions -= 1;
        }
        switch (prev.value.unpack()) {
            .loader => {},
            .custom => |index| swapRemoveExtension(vm, index),
        }
    }
}

fn swapRemoveExtension(vm: *JSC.VirtualMachine, index: u32) void {
    const last_index = JSCommonJSExtensions__swapRemove(vm.global, index);
    if (last_index == index) return;
    // Find and rewrite the last index to the new index.
    // Since packed structs are sugar over the backing int, this code can use
    // the simd path in the standard library search.
    const find: u32 = @intFromEnum(CustomLoader.Packed.pack(.{ .custom = last_index }));
    const values = vm.commonjs_custom_extensions.values();
    const values_reinterpret = bun.reinterpretSlice(u32, values);
    const i = std.mem.indexOfScalar(u32, values_reinterpret, find) orelse
        return bun.debugAssert(false);
    values[i] = .pack(.{ .custom = last_index });
}

pub fn findLongestRegisteredExtension(vm: *JSC.VirtualMachine, filename: []const u8) ?CustomLoader {
    const basename = std.fs.path.basename(filename);
    var next: usize = 0;
    while (bun.strings.indexOfCharPos(basename, '.', next)) |i| {
        next = i + 1;
        if (i == 0) continue;
        const ext = basename[i..];
        if (vm.commonjs_custom_extensions.get(ext)) |value| {
            return value.unpack();
        }
    }
    return null;
}

fn onRequireExtensionModifyBinding(
    global: *JSC.JSGlobalObject,
    str: *const bun.String,
    kind: i32,
    value: JSC.JSValue,
) callconv(.c) void {
    var sfa_state = std.heap.stackFallback(8192, bun.default_allocator);
    const alloc = sfa_state.get();
    const str_slice = str.toUTF8(alloc);
    defer str_slice.deinit();
    onRequireExtensionModify(global, str_slice.slice(), kind, value) catch |err| switch (err) {
        error.OutOfMemory => bun.outOfMemory(),
    };
}

comptime {
    @export(&onRequireExtensionModifyBinding, .{ .name = "NodeModuleModule__onRequireExtensionModify" });
}
