const std = @import("std");
const Api = @import("../../../api/schema.zig").Api;
const RequestContext = @import("../../../http.zig").RequestContext;
const MimeType = @import("../../../http.zig").MimeType;
const ZigURL = @import("../../../query_string_map.zig").URL;
const HTTPClient = @import("http");
const NetworkThread = HTTPClient.NetworkThread;
const strings = @import("../../../global.zig").strings;
const string = @import("../../../global.zig").string;
const default_allocator = @import("../../../global.zig").default_allocator;
const FeatureFlags = @import("../../../global.zig").FeatureFlags;
const Path = @import("../../../fs.zig").Path;
const logger = @import("../../../logger.zig");

const JSC = @import("../../../jsc.zig");
const Bundler = @import("../../../bundler.zig").Bundler;
const Resolver = @import("../../../bundler.zig").Resolver;
const js = JSC.C;

pub const Plugin = struct {
    name: string,

    pub const Registry = struct {
        bundler: *Bundler,
        resolver: *Resolver,
        allocator: std.mem.Allocator,

        load: LoadCallback.Map,
        resolve: ResolveCallback.Map,

        pub const Class = JSC.NewClass(
            Registry,
            .{ .name = "Registry" },
            .{
                .onLoad = .{
                    .rfn = handleOnLoad,
                },
                .onResolve = .{
                    .rfn = handleOnResolve,
                },
                .onStart = .{
                    .rfn = handleOnStart,
                },
                .onEnd = .{
                    .rfn = handleOnEnd,
                },
                .resolve = .{
                    .rfn = handleResolve,
                },
            },
            .{},
        );

        pub fn addLoadCallback(this: *Registry, namespace_: string, callback: LoadCallback) void {
            var entry = this.load.getOrPut(this.allocator, namespace_) catch unreachable;
        }

        pub fn handleOnLoad(
            this: *Registry,
            ctx: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            args_: []const js.JSValueRef,
            exception: js.ExceptionRef,
        ) js.JSValueRef {
            const args: []const JSC.JSValue = @ptrCast([*]const JSC.JSValue, args_.ptr)[0..args_.len];
            if (args.len < 2) {
                JSC.throwInvalidArguments("onLoad expects a filter object and a callback", .{}, ctx, exception);
                return null;
            }

            const object = args[0];
            if (!object.jsType().isObject()) {
                JSC.throwInvalidArguments("onLoad expects an object with \"filter\"", .{}, ctx, exception);
                return null;
            }

var namespace_slice = JSC.ZigString.init("file").toSlice(this.allocator);

            if (object.get(ctx.ptr(), "namespace")) |namespace_prop| {
namespace_slice = namespace_prop.toSlice(ctx.ptr(), this.allocator);                
            }

            if (object.get(ctx.ptr(), "filter")) |filter_prop| {
                switch (filter_prop.jsType()) {
                    JSC.JSValue.JSType.RegExpObject => {

                    },
                }
            }
        }

        pub fn noop(
            _: *Registry,
            _: js.JSContextRef,
            _: js.JSObjectRef,
            _: js.JSObjectRef,
            _: []const js.JSValueRef,
            _: js.ExceptionRef,
        ) js.JSValueRef {
            return JSC.JSValue.jsUndefined();
        }
        const handleOnResolve = noop;
        const handleOnStart = noop;
        const handleOnEnd = noop;
        const handleResolve = noop;
    };
};

pub const LoadCallback = struct {
    plugin: *Plugin,
    javascript_function: JSC.JSValue,
    filter: FilterList,

    pub const List = std.MultiArrayList(LoadCallback);
    pub const Map = std.AutoHashMapUnmanaged(u64, List);

    pub const Context = struct {
        registry: 
        log: *logger.Log,
        namespace: string,
        import_path: string,
    };
};
pub const ResolveCallback = struct {
    plugin: *Plugin,
    javascript_function: JSC.JSValue,
    filter: FilterList,

    pub const List = std.MultiArrayList(ResolveCallback);
    pub const Map =  std.AutoHashMapUnmanaged(u64, List);
};

pub const FilterList = []const JSC.JSValue;
