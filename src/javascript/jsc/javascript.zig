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
usingnamespace @import("./base.zig");
usingnamespace @import("./webcore/response.zig");
usingnamespace @import("./config.zig");
usingnamespace @import("./bindings/exports.zig");
usingnamespace @import("./bindings/bindings.zig");

pub const GlobalClasses = [_]type{
    Request.Class,
    Response.Class,
    Headers.Class,
};

pub const Module = struct {
    reload_pending: bool = false,
};

// If you read JavascriptCore/API/JSVirtualMachine.mm - https://github.com/WebKit/WebKit/blob/acff93fb303baa670c055cb24c2bad08691a01a0/Source/JavaScriptCore/API/JSVirtualMachine.mm#L101
// We can see that it's sort of like std.mem.Allocator but for JSGlobalContextRef, to support Automatic Reference Counting
// Its unavailable on Linux
pub const VirtualMachine = struct {
    const RequireCacheType = std.AutoHashMap(u32, *Module);
    global: *JSGlobalObject,
    allocator: *std.mem.Allocator,
    node_modules: ?*NodeModuleBundle = null,
    bundler: Bundler,
    watcher: ?*http.Watcher = null,
    console: ZigConsoleClient,
    require_cache: RequireCacheType,
    log: *logger.Log,
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
            .require_cache = RequireCacheType.init(allocator),
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

        var global_classes: [GlobalClasses.len]js.JSClassRef = undefined;
        inline for (GlobalClasses) |Class, i| {
            global_classes[i] = Class.get().*;
        }
        vm.global = ZigGlobalObject.create(
            &global_classes,
            @intCast(i32, global_classes.len),
            &vm.console,
        );

        return vm;
    }
};

pub const Object = struct {
    ref: js.jsObjectRef,
};

const GetterFn = fn (
    this: anytype,
    ctx: js.JSContextRef,
    thisObject: js.JSValueRef,
    prop: js.JSStringRef,
    exception: js.ExceptionRef,
) js.JSValueRef;
const SetterFn = fn (
    this: anytype,
    ctx: js.JSContextRef,
    thisObject: js.JSValueRef,
    prop: js.JSStringRef,
    value: js.JSValueRef,
    exception: js.ExceptionRef,
) js.JSValueRef;

const JSProp = struct {
    get: ?GetterFn = null,
    set: ?SetterFn = null,
    ro: bool = false,
};

pub const EventListenerMixin = struct {
    threadlocal var event_listener_names_buf: [128]u8 = undefined;
    pub const List = std.ArrayList(js.JSObjectRef);
    pub const Map = std.AutoHashMap(EventListenerMixin.EventType, EventListenerMixin.List);

    pub const EventType = enum {
        fetch,
        err,

        const SizeMatcher = strings.ExactSizeMatcher(8);

        pub fn match(str: string) ?EventType {
            return switch (SizeMatcher.match(str)) {
                SizeMatcher.case("fetch") => EventType.fetch,
                SizeMatcher.case("error") => EventType.err,
                else => null,
            };
        }
    };

    pub fn emitFetchEventError(
        request: *http.RequestContext,
        comptime fmt: string,
        args: anytype,
    ) void {
        Output.prettyErrorln(fmt, args);
        request.sendInternalError(error.FetchEventError) catch {};
    }

    pub fn emitFetchEvent(
        vm: *VirtualMachine,
        request_context: *http.RequestContext,
    ) !void {
        var listeners = vm.event_listeners.get(EventType.fetch) orelse return emitFetchEventError(
            request_context,
            "Missing \"fetch\" handler. Did you run \"addEventListener(\"fetch\", (event) => {{}})\"?",
            .{},
        );
        if (listeners.items.len == 0) return emitFetchEventError(
            request_context,
            "Missing \"fetch\" handler. Did you run \"addEventListener(\"fetch\", (event) => {{}})\"?",
            .{},
        );

        var exception: js.JSValueRef = null;
        // Rely on JS finalizer
        var fetch_event = try vm.allocator.create(FetchEvent);
        fetch_event.* = FetchEvent{
            .request_context = request_context,
            .request = Request{ .request_context = request_context },
        };

        var fetch_args: [1]js.JSObjectRef = undefined;
        for (listeners.items) |listener| {
            fetch_args[0] = js.JSObjectMake(
                vm.ctx,
                FetchEvent.Class.get().*,
                fetch_event,
            );

            _ = js.JSObjectCallAsFunction(
                vm.ctx,
                listener,
                js.JSContextGetGlobalObject(vm.ctx),
                1,
                &fetch_args,
                &exception,
            );
            if (request_context.has_called_done) {
                break;
            }
        }

        if (exception != null) {
            var message = js.JSValueToStringCopy(vm.ctx, exception, null);
            defer js.JSStringRelease(message);
            var buf = vm.allocator.alloc(u8, js.JSStringGetLength(message) + 1) catch unreachable;
            defer vm.allocator.free(buf);
            var note = buf[0 .. js.JSStringGetUTF8CString(message, buf.ptr, buf.len) - 1];

            Output.prettyErrorln("<r><red>error<r>: <b>{s}<r>", .{note});
            Output.flush();

            if (!request_context.has_called_done) {
                request_context.sendInternalError(error.JavaScriptError) catch {};
            }
            return;
        }

        if (!request_context.has_called_done) {
            return emitFetchEventError(
                request_context,
                "\"fetch\" handler never called event.respondWith()",
                .{},
            );
        }
    }

    pub fn addEventListener(
        comptime Struct: type,
    ) type {
        const Handler = struct {
            pub fn addListener(
                ptr: *Struct,
                ctx: js.JSContextRef,
                function: js.JSObjectRef,
                thisObject: js.JSObjectRef,
                arguments: []const js.JSValueRef,
                exception: js.ExceptionRef,
            ) js.JSValueRef {
                if (arguments.len == 0 or arguments.len == 1 or !js.JSValueIsString(ctx, arguments[0]) or !js.JSValueIsObject(ctx, arguments[arguments.len - 1]) or !js.JSObjectIsFunction(ctx, arguments[arguments.len - 1])) {
                    return js.JSValueMakeUndefined(ctx);
                }

                const name_len = js.JSStringGetLength(arguments[0]);
                if (name_len > event_listener_names_buf.len) {
                    return js.JSValueMakeUndefined(ctx);
                }

                const name_used_len = js.JSStringGetUTF8CString(arguments[0], &event_listener_names_buf, event_listener_names_buf.len);
                const name = event_listener_names_buf[0 .. name_used_len - 1];
                const event = EventType.match(name) orelse return js.JSValueMakeUndefined(ctx);
                var entry = VirtualMachine.instance.event_listeners.getOrPut(event) catch unreachable;

                if (!entry.found_existing) {
                    entry.value_ptr.* = List.initCapacity(VirtualMachine.instance.allocator, 1) catch unreachable;
                }

                var callback = arguments[arguments.len - 1];
                js.JSValueProtect(ctx, callback);
                entry.value_ptr.append(callback) catch unreachable;

                return js.JSValueMakeUndefined(ctx);
            }
        };

        return Handler;
    }
};
