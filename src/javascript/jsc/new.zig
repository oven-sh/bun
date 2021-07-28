const std = @import("std");

const Fs = @import("../../fs.zig");
const resolver = @import("../../resolver/resolver.zig");
const ast = @import("../../import_record.zig");
const NodeModuleBundle = @import("../../node_module_bundle.zig").NodeModuleBundle;
const logger = @import("../../logger.zig");
const Api = @import("../../api/schema.zig").Api;
const options = @import("../../options.zig");
const Bundler = @import("../../bundler.zig").ServeBundler;
const js_printer = @import("../../js_printer.zig");
const hash_map = @import("../../hash_map.zig");
const http = @import("../../http.zig");

usingnamespace @import("./node_env_buf_map.zig");
usingnamespace @import("./config.zig");
usingnamespace @import("./bindings/bindings.zig");
usingnamespace @import("./bindings/exports.zig");

pub const VirtualMachine = struct {
    global: *JSGlobalObject,
    allocator: *std.mem.Allocator,
    node_modules: ?*NodeModuleBundle = null,
    bundler: Bundler,
    watcher: ?*http.Watcher = null,
    console: ZigConsoleClient,
    pub threadlocal var vm: *VirtualMachine = undefined;

    pub fn init(
        allocator: *std.mem.Allocator,
        _args: Api.TransformOptions,
        existing_bundle: ?*NodeModuleBundle,
        _log: ?*logger.Log,
    ) !*VirtualMachine {
        var log: *logger.Log = undefined;
        if (_log) |__log| {
            log = __log;
        } else {
            log = try allocator.create(logger.Log);
        }

        vm = try allocator.create(VirtualMachine);
        vm.* = VirtualMachine{
            .global = undefined,
            .allocator = allocator,
            .bundler = try Bundler.init(
                allocator,
                log,
                try configureTransformOptionsForSpeedy(allocator, _args),
                existing_bundle,
            ),
            .console = ZigConsoleClient.init(Output.errorWriter(), Output.writer()),
            .node_modules = existing_bundle,
            .log = log,
        };

        vm.global = js.ZigGlobalObject.create(null, &vm.console);
        return vm;
    }
};

pub const ModuleLoader = struct {
    pub threadlocal var global_error_buf: [4096]u8 = undefined;
    pub const RequireCacheType = std.AutoHashMap(http.Watcher.HashType, *CommonJSModule);
    pub threadlocal var require_cache: RequireCacheType = undefined;
    pub fn require(global: *JSGlobalObject, input: []const u8, from: *CommonJSModule) anyerror!resolver.Result {}

    pub inline fn hashid(input: []const u8) http.Watcher.HashType {
        return http.Watcher.getHash(input);
    }

    pub inline fn resolve(global: *JSGlobalObject, input: []const u8, from: *CommonJSModule) anyerror!resolver.Result {
        std.debug.assert(global == VirtualMachine.vm.global);
        return try VirtualMachine.vm.bundler.resolver.resolve(input, from.path.dirWithTrailingSlash(), .require);
    }

    inline fn _requireResolve(global: *JSGlobalObject, specifier: []const u8, referrer: []const u8) anyerror![]const u8 {
        std.debug.assert(global == VirtualMachine.vm.global);
        var result: resolver.Result = try VirtualMachine.vm.bundler.resolver.resolve(specifier, Fs.PathName.init(referrer).dirWithTrailingSlash(), .import);

        return result.path_pair.primary.text;
    }

    pub fn load(global: *JSGlobalObject, )

    pub fn requireResolve(global: *JSGlobalObject, specifier: ZigString, referrer: ZigString) ErrorableZigString {
        return _requireResolve(global, specifier.slice(), referrer.slice()) catch |err| {
            return ErrorableZigString.err(err, std.fmt.bufPrint(
                &global_error_buf,
                "Resolve failed: {s} while resolving \"{s}\" in \"{s}\"",
                .{
                    @errorName(err),
                    specifier.slice(),
                    referrer.slice(),
                },
            ) catch "ResolveError");
        };
    }
};
