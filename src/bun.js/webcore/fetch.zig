pub const fetch_error_no_args = "fetch() expects a string but received no arguments.";
pub const fetch_error_blank_url = "fetch() URL must not be a blank string.";
pub const fetch_error_unexpected_body = "fetch() request with GET/HEAD/OPTIONS method cannot have body.";
pub const fetch_error_proxy_unix = "fetch() cannot use a proxy with a unix socket.";
const JSTypeErrorEnum = std.enums.EnumArray(JSType, string);
pub const fetch_type_error_names: JSTypeErrorEnum = brk: {
    var errors = JSTypeErrorEnum.initUndefined();
    errors.set(JSType.kJSTypeUndefined, "Undefined");
    errors.set(JSType.kJSTypeNull, "Null");
    errors.set(JSType.kJSTypeBoolean, "Boolean");
    errors.set(JSType.kJSTypeNumber, "Number");
    errors.set(JSType.kJSTypeString, "String");
    errors.set(JSType.kJSTypeObject, "Object");
    errors.set(JSType.kJSTypeSymbol, "Symbol");
    break :brk errors;
};

pub const fetch_type_error_string_values = .{
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeUndefined)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeNull)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeBoolean)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeNumber)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeString)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeObject)}),
    std.fmt.comptimePrint("fetch() expects a string, but received {s}", .{fetch_type_error_names.get(JSType.kJSTypeSymbol)}),
};

pub const fetch_type_error_strings: JSTypeErrorEnum = brk: {
    var errors = JSTypeErrorEnum.initUndefined();
    errors.set(
        JSType.kJSTypeUndefined,
        bun.asByteSlice(fetch_type_error_string_values[0]),
    );
    errors.set(
        JSType.kJSTypeNull,
        bun.asByteSlice(fetch_type_error_string_values[1]),
    );
    errors.set(
        JSType.kJSTypeBoolean,
        bun.asByteSlice(fetch_type_error_string_values[2]),
    );
    errors.set(
        JSType.kJSTypeNumber,
        bun.asByteSlice(fetch_type_error_string_values[3]),
    );
    errors.set(
        JSType.kJSTypeString,
        bun.asByteSlice(fetch_type_error_string_values[4]),
    );
    errors.set(
        JSType.kJSTypeObject,
        bun.asByteSlice(fetch_type_error_string_values[5]),
    );
    errors.set(
        JSType.kJSTypeSymbol,
        bun.asByteSlice(fetch_type_error_string_values[6]),
    );
    break :brk errors;
};

pub const FetchTasklet = @import("./fetch/FetchTasklet.zig").FetchTasklet;

fn dataURLResponse(
    _data_url: DataURL,
    globalThis: *JSGlobalObject,
    allocator: std.mem.Allocator,
) JSValue {
    var data_url = _data_url;

    const data = data_url.decodeData(allocator) catch {
        const err = globalThis.createError("failed to fetch the data URL", .{});
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    };
    var blob = Blob.init(data, allocator, globalThis);

    var allocated = false;
    const mime_type = bun.http.MimeType.init(data_url.mime_type, allocator, &allocated);
    blob.content_type = mime_type.value;
    if (allocated) {
        blob.content_type_allocated = true;
    }

    var response = bun.new(Response, Response.init(
        .{
            .status_code = 200,
            .status_text = bun.String.createAtomASCII("OK"),
        },
        Body{
            .value = .{ .Blob = blob },
        },
        data_url.url.dupeRef(),
        false,
    ));

    return JSPromise.resolvedPromiseValue(globalThis, response.toJS(globalThis));
}

comptime {
    const Bun__fetchPreconnect = jsc.toJSHostFn(Bun__fetchPreconnect_);
    @export(&Bun__fetchPreconnect, .{ .name = "Bun__fetchPreconnect" });
}
pub fn Bun__fetchPreconnect_(
    globalObject: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments_old(1).slice();

    if (arguments.len < 1) {
        return globalObject.throwNotEnoughArguments("fetch.preconnect", 1, arguments.len);
    }

    var url_str = try jsc.URL.hrefFromJS(arguments[0], globalObject);
    defer url_str.deref();

    if (globalObject.hasException()) {
        return .zero;
    }

    if (url_str.tag == .Dead) {
        return globalObject.ERR(.INVALID_ARG_TYPE, "Invalid URL", .{}).throw();
    }

    if (url_str.isEmpty()) {
        return globalObject.ERR(.INVALID_ARG_TYPE, fetch_error_blank_url, .{}).throw();
    }

    const url = ZigURL.parse(bun.handleOom(url_str.toOwnedSlice(bun.default_allocator)));
    if (!url.isHTTP() and !url.isHTTPS() and !url.isS3()) {
        bun.default_allocator.free(url.href);
        return globalObject.throwInvalidArguments("URL must be HTTP or HTTPS", .{});
    }

    if (url.hostname.len == 0) {
        bun.default_allocator.free(url.href);
        return globalObject.ERR(.INVALID_ARG_TYPE, fetch_error_blank_url, .{}).throw();
    }

    if (!url.hasValidPort()) {
        bun.default_allocator.free(url.href);
        return globalObject.throwInvalidArguments("Invalid port", .{});
    }

    bun.http.AsyncHTTP.preconnect(url, true);
    return .js_undefined;
}

const StringOrURL = struct {
    pub fn fromJS(value: jsc.JSValue, globalThis: *jsc.JSGlobalObject) bun.JSError!?bun.String {
        if (value.isString()) {
            return try bun.String.fromJS(value, globalThis);
        }

        const out = try jsc.URL.hrefFromJS(value, globalThis);
        if (out.tag == .Dead) return null;
        return out;
    }
};

comptime {
    const Bun__fetch = jsc.toJSHostFn(Bun__fetch_);
    @export(&Bun__fetch, .{ .name = "Bun__fetch" });
}

/// Public entry point for `Bun.fetch` - validates body on GET/HEAD/OPTIONS
pub fn Bun__fetch_(
    ctx: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    return fetchImpl(false, ctx, callframe);
}

/// Internal entry point for Node.js HTTP client - allows body on GET/HEAD/OPTIONS
pub fn nodeHttpClient(
    ctx: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    return fetchImpl(true, ctx, callframe);
}

/// Shared implementation of fetch
fn fetchImpl(
    comptime allow_get_body: bool,
    ctx: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    jsc.markBinding(@src());
    const globalThis = ctx;
    const arguments = callframe.arguments_old(2);
    bun.analytics.Features.fetch += 1;
    const vm = jsc.VirtualMachine.get();

    // used to clean up dynamically allocated memory on error (a poor man's errdefer)
    var is_error = false;
    var upgraded_connection = false;
    var allocator = bun.default_allocator;

    if (arguments.len == 0) {
        const err = ctx.toTypeError(.MISSING_ARGS, fetch_error_no_args, .{});
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    var headers: ?Headers = null;
    var method = Method.GET;

    var args = jsc.CallFrame.ArgumentsSlice.init(vm, arguments.slice());

    var url = ZigURL{};
    var first_arg = args.nextEat().?;

    // We must always get the Body before the Headers That way, we can set
    // the Content-Type header from the Blob if no Content-Type header is
    // set in the Headers
    //
    // which is important for FormData.
    // https://github.com/oven-sh/bun/issues/2264
    //
    var body: FetchTasklet.HTTPRequestBody = FetchTasklet.HTTPRequestBody.Empty;

    var disable_timeout = false;
    var disable_keepalive = false;
    var disable_decompression = false;
    var verbose: http.HTTPVerboseLevel = if (vm.log.level.atLeast(.debug)) .headers else .none;
    if (verbose == .none) {
        verbose = vm.getVerboseFetch();
    }

    var proxy: ?ZigURL = null;
    var redirect_type: FetchRedirect = FetchRedirect.follow;
    var signal: ?*jsc.WebCore.AbortSignal = null;
    // Custom Hostname
    var hostname: ?[]u8 = null;
    var range: ?[]u8 = null;
    var unix_socket_path: ZigString.Slice = ZigString.Slice.empty;

    var url_proxy_buffer: []const u8 = "";
    const URLType = enum {
        remote,
        file,
        blob,
    };
    var url_type = URLType.remote;

    var ssl_config: ?*SSLConfig = null;
    var reject_unauthorized = vm.getTLSRejectUnauthorized();
    var check_server_identity: JSValue = .zero;

    defer {
        if (signal) |sig| {
            signal = null;
            sig.unref();
        }

        unix_socket_path.deinit();

        allocator.free(url_proxy_buffer);
        url_proxy_buffer = "";

        if (headers) |*headers_| {
            headers_.buf.deinit(allocator);
            headers_.entries.deinit(allocator);
            headers = null;
        }

        body.detach();

        // clean hostname if any
        if (hostname) |hn| {
            bun.default_allocator.free(hn);
            hostname = null;
        }
        if (range) |range_| {
            bun.default_allocator.free(range_);
            range = null;
        }

        if (ssl_config) |conf| {
            ssl_config = null;
            conf.deinit();
            bun.default_allocator.destroy(conf);
        }
    }

    const options_object: ?JSValue = brk: {
        if (args.nextEat()) |options| {
            if (options.isObject() or options.jsType() == .DOMWrapper) {
                break :brk options;
            }
        }

        break :brk null;
    };
    const request: ?*Request = brk: {
        if (first_arg.isCell()) {
            if (first_arg.asDirect(Request)) |request_| {
                break :brk request_;
            }
        }

        break :brk null;
    };
    // If it's NOT a Request or a subclass of Request, treat the first argument as a URL.
    const url_str_optional = if (first_arg.as(Request) == null) try StringOrURL.fromJS(first_arg, globalThis) else null;
    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    const request_init_object: ?JSValue = brk: {
        if (request != null) break :brk null;
        if (url_str_optional != null) break :brk null;
        if (first_arg.isObject()) break :brk first_arg;
        break :brk null;
    };

    var url_str = extract_url: {
        if (url_str_optional) |str| break :extract_url str;

        if (request) |req| {
            bun.handleOom(req.ensureURL());
            break :extract_url req.url.dupeRef();
        }

        if (request_init_object) |request_init| {
            if (try request_init.fastGet(globalThis, .url)) |url_| {
                if (!url_.isUndefined()) {
                    break :extract_url try bun.String.fromJS(url_, globalThis);
                }
            }
        }

        break :extract_url bun.String.empty;
    };
    defer url_str.deref();

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    if (url_str.isEmpty()) {
        is_error = true;
        const err = ctx.toTypeError(.INVALID_URL, fetch_error_blank_url, .{});
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    if (url_str.hasPrefixComptime("data:")) {
        var url_slice = url_str.toUTF8WithoutRef(allocator);
        defer url_slice.deinit();

        var data_url = DataURL.parseWithoutCheck(url_slice.slice()) catch {
            const err = ctx.createError("failed to fetch the data URL", .{});
            is_error = true;
            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
        };

        data_url.url = url_str;
        return dataURLResponse(data_url, globalThis, allocator);
    }

    url = ZigURL.fromString(allocator, url_str) catch {
        const err = ctx.toTypeError(.INVALID_URL, "fetch() URL is invalid", .{});
        is_error = true;
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(
            globalThis,
            err,
        );
    };
    if (url.isFile()) {
        url_type = URLType.file;
    } else if (url.isBlob()) {
        url_type = URLType.blob;
    }
    url_proxy_buffer = url.href;

    // **Start with the harmless ones.**

    // "method"
    method = extract_method: {
        if (options_object) |options| {
            if (try options.getTruthyComptime(globalThis, "method")) |method_| {
                break :extract_method try Method.fromJS(globalThis, method_);
            }
        }

        if (request) |req| {
            break :extract_method req.method;
        }

        if (request_init_object) |req| {
            if (try req.getTruthyComptime(globalThis, "method")) |method_| {
                break :extract_method try Method.fromJS(globalThis, method_);
            }
        }

        break :extract_method null;
    } orelse .GET;

    // "decompress: boolean"
    disable_decompression = extract_disable_decompression: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "decompress")) |decompression_value| {
                    if (decompression_value.isBoolean()) {
                        break :extract_disable_decompression !decompression_value.asBoolean();
                    } else if (decompression_value.isNumber()) {
                        break :extract_disable_decompression decompression_value.to(i32) == 0;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }

        break :extract_disable_decompression disable_decompression;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // "tls: TLSConfig"
    ssl_config = extract_ssl_config: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "tls")) |tls| {
                    if (tls.isObject()) {
                        if (try tls.get(ctx, "rejectUnauthorized")) |reject| {
                            if (reject.isBoolean()) {
                                reject_unauthorized = reject.asBoolean();
                            } else if (reject.isNumber()) {
                                reject_unauthorized = reject.to(i32) != 0;
                            }
                        }

                        if (globalThis.hasException()) {
                            is_error = true;
                            return .zero;
                        }

                        if (try tls.get(ctx, "checkServerIdentity")) |checkServerIdentity| {
                            if (checkServerIdentity.isCell() and checkServerIdentity.isCallable()) {
                                check_server_identity = checkServerIdentity;
                            }
                        }

                        if (globalThis.hasException()) {
                            is_error = true;
                            return .zero;
                        }

                        if (SSLConfig.fromJS(vm, globalThis, tls) catch {
                            is_error = true;
                            return .zero;
                        }) |config| {
                            const ssl_config_object = bun.handleOom(bun.default_allocator.create(SSLConfig));
                            ssl_config_object.* = config;
                            break :extract_ssl_config ssl_config_object;
                        }
                    }
                }
            }
        }

        break :extract_ssl_config ssl_config;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // unix: string | undefined
    unix_socket_path = extract_unix_socket_path: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "unix")) |socket_path| {
                    if (socket_path.isString() and try socket_path.getLength(ctx) > 0) {
                        break :extract_unix_socket_path try socket_path.toSliceCloneWithAllocator(globalThis, allocator);
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }
        break :extract_unix_socket_path unix_socket_path;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // timeout: false | number | undefined
    disable_timeout = extract_disable_timeout: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "timeout")) |timeout_value| {
                    if (timeout_value.isBoolean()) {
                        break :extract_disable_timeout !timeout_value.asBoolean();
                    } else if (timeout_value.isNumber()) {
                        break :extract_disable_timeout timeout_value.to(i32) == 0;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }

        break :extract_disable_timeout disable_timeout;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // redirect: "follow" | "error" | "manual" | undefined;
    redirect_type = extract_redirect_type: {
        // First, try to use the Request object's redirect if available
        if (request) |req| {
            redirect_type = req.flags.redirect;
        }

        // Then check options/init objects which can override the Request's redirect
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (objects_to_try[i].getOptionalEnum(globalThis, "redirect", FetchRedirect) catch {
                    is_error = true;
                    return .zero;
                }) |redirect_value| {
                    break :extract_redirect_type redirect_value;
                }
            }
        }

        break :extract_redirect_type redirect_type;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // keepalive: boolean | undefined;
    disable_keepalive = extract_disable_keepalive: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "keepalive")) |keepalive_value| {
                    if (keepalive_value.isBoolean()) {
                        break :extract_disable_keepalive !keepalive_value.asBoolean();
                    } else if (keepalive_value.isNumber()) {
                        break :extract_disable_keepalive keepalive_value.to(i32) == 0;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }

        break :extract_disable_keepalive disable_keepalive;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // verbose: boolean | "curl" | undefined;
    verbose = extract_verbose: {
        const objects_to_try = [_]JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };

        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "verbose")) |verb| {
                    if (verb.isString()) {
                        if ((try verb.getZigString(globalThis)).eqlComptime("curl")) {
                            break :extract_verbose .curl;
                        }
                    } else if (verb.isBoolean()) {
                        break :extract_verbose if (verb.toBoolean()) .headers else .none;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }
        break :extract_verbose verbose;
    };

    // proxy: string | { url: string, headers?: Headers } | undefined;
    var proxy_headers: ?Headers = null;
    defer if (proxy_headers) |*hdrs| {
        hdrs.deinit();
    };
    url_proxy_buffer = extract_proxy: {
        const objects_to_try = [_]jsc.JSValue{
            options_object orelse .zero,
            request_init_object orelse .zero,
        };
        inline for (0..2) |i| {
            if (objects_to_try[i] != .zero) {
                if (try objects_to_try[i].get(globalThis, "proxy")) |proxy_arg| {
                    // Handle string format: proxy: "http://proxy.example.com:8080"
                    if (proxy_arg.isString() and try proxy_arg.getLength(ctx) > 0) {
                        var href = try jsc.URL.hrefFromJS(proxy_arg, globalThis);
                        if (href.tag == .Dead) {
                            const err = ctx.toTypeError(.INVALID_ARG_VALUE, "fetch() proxy URL is invalid", .{});
                            is_error = true;
                            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
                        }
                        defer href.deref();
                        const buffer = try std.fmt.allocPrint(allocator, "{s}{f}", .{ url_proxy_buffer, href });
                        url = ZigURL.parse(buffer[0..url.href.len]);
                        if (url.isFile()) {
                            url_type = URLType.file;
                        } else if (url.isBlob()) {
                            url_type = URLType.blob;
                        }

                        proxy = ZigURL.parse(buffer[url.href.len..]);
                        allocator.free(url_proxy_buffer);
                        break :extract_proxy buffer;
                    }
                    // Handle object format: proxy: { url: "http://proxy.example.com:8080", headers?: Headers }
                    // If the proxy object doesn't have a 'url' property, ignore it.
                    // This handles cases like passing a URL object directly as proxy (which has 'href' not 'url').
                    if (proxy_arg.isObject()) {
                        // Get the URL from the proxy object
                        if (try proxy_arg.get(globalThis, "url")) |proxy_url_arg| {
                            if (!proxy_url_arg.isUndefinedOrNull()) {
                                if (proxy_url_arg.isString() and try proxy_url_arg.getLength(ctx) > 0) {
                                    var href = try jsc.URL.hrefFromJS(proxy_url_arg, globalThis);
                                    if (href.tag == .Dead) {
                                        const err = ctx.toTypeError(.INVALID_ARG_VALUE, "fetch() proxy URL is invalid", .{});
                                        is_error = true;
                                        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
                                    }
                                    defer href.deref();
                                    const buffer = try std.fmt.allocPrint(allocator, "{s}{f}", .{ url_proxy_buffer, href });
                                    url = ZigURL.parse(buffer[0..url.href.len]);
                                    if (url.isFile()) {
                                        url_type = URLType.file;
                                    } else if (url.isBlob()) {
                                        url_type = URLType.blob;
                                    }

                                    proxy = ZigURL.parse(buffer[url.href.len..]);
                                    allocator.free(url_proxy_buffer);
                                    url_proxy_buffer = buffer;

                                    // Get the headers from the proxy object (optional)
                                    if (try proxy_arg.get(globalThis, "headers")) |headers_value| {
                                        if (!headers_value.isUndefinedOrNull()) {
                                            if (headers_value.as(FetchHeaders)) |fetch_hdrs| {
                                                proxy_headers = Headers.from(fetch_hdrs, allocator, .{}) catch |err| bun.handleOom(err);
                                            } else if (try FetchHeaders.createFromJS(ctx, headers_value)) |fetch_hdrs| {
                                                defer fetch_hdrs.deref();
                                                proxy_headers = Headers.from(fetch_hdrs, allocator, .{}) catch |err| bun.handleOom(err);
                                            }
                                        }
                                    }

                                    break :extract_proxy url_proxy_buffer;
                                } else {
                                    const err = ctx.toTypeError(.INVALID_ARG_VALUE, "fetch() proxy.url must be a non-empty string", .{});
                                    is_error = true;
                                    return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
                                }
                            }
                        }
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }
        }

        break :extract_proxy url_proxy_buffer;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // signal: AbortSignal | undefined;
    signal = extract_signal: {
        if (options_object) |options| {
            if (try options.get(globalThis, "signal")) |signal_| {
                if (!signal_.isUndefined()) {
                    if (signal_.as(jsc.WebCore.AbortSignal)) |signal__| {
                        break :extract_signal signal__.ref();
                    }
                }
            }

            if (globalThis.hasException()) {
                is_error = true;
                return .zero;
            }
        }

        if (request) |req| {
            if (req.signal) |signal_| {
                break :extract_signal signal_.ref();
            }
            break :extract_signal null;
        }

        if (request_init_object) |options| {
            if (try options.get(globalThis, "signal")) |signal_| {
                if (signal_.isUndefined()) {
                    break :extract_signal null;
                }

                if (signal_.as(jsc.WebCore.AbortSignal)) |signal__| {
                    break :extract_signal signal__.ref();
                }
            }
        }

        break :extract_signal null;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // We do this 2nd to last instead of last so that if it's a FormData
    // object, we can still insert the boundary.
    //
    // body: BodyInit | null | undefined;
    //
    body = extract_body: {
        if (options_object) |options| {
            if (try options.fastGet(globalThis, .body)) |body__| {
                if (!body__.isUndefined()) {
                    break :extract_body try FetchTasklet.HTTPRequestBody.fromJS(ctx, body__);
                }
            }

            if (globalThis.hasException()) {
                is_error = true;
                return .zero;
            }
        }

        if (request) |req| {
            const bodyValue = req.getBodyValue();
            if (bodyValue.* == .Used or (bodyValue.* == .Locked and (bodyValue.Locked.action != .none or bodyValue.Locked.isDisturbed(Request, globalThis, first_arg)))) {
                return globalThis.ERR(.BODY_ALREADY_USED, "Request body already used", .{}).throw();
            }

            if (bodyValue.* == .Locked) {
                if (req.getBodyReadableStream(globalThis)) |readable| {
                    break :extract_body FetchTasklet.HTTPRequestBody{ .ReadableStream = jsc.WebCore.ReadableStream.Strong.init(readable, globalThis) };
                }
                if (bodyValue.Locked.readable.has()) {
                    break :extract_body FetchTasklet.HTTPRequestBody{ .ReadableStream = jsc.WebCore.ReadableStream.Strong.init(bodyValue.Locked.readable.get(globalThis).?, globalThis) };
                }
                const readable = try bodyValue.toReadableStream(globalThis);
                if (!readable.isEmptyOrUndefinedOrNull() and bodyValue.* == .Locked and bodyValue.Locked.readable.has()) {
                    break :extract_body FetchTasklet.HTTPRequestBody{ .ReadableStream = jsc.WebCore.ReadableStream.Strong.init(bodyValue.Locked.readable.get(globalThis).?, globalThis) };
                }
            }

            break :extract_body FetchTasklet.HTTPRequestBody{ .AnyBlob = bodyValue.useAsAnyBlob() };
        }

        if (request_init_object) |req| {
            if (try req.fastGet(globalThis, .body)) |body__| {
                if (!body__.isUndefined()) {
                    break :extract_body try FetchTasklet.HTTPRequestBody.fromJS(ctx, body__);
                }
            }
        }

        break :extract_body null;
    } orelse FetchTasklet.HTTPRequestBody.Empty;

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // headers: Headers | undefined;
    headers = extract_headers: {
        var fetch_headers_to_deref: ?*bun.webcore.FetchHeaders = null;
        defer {
            if (fetch_headers_to_deref) |fetch_headers| {
                fetch_headers.deref();
            }
        }

        const fetch_headers: ?*bun.webcore.FetchHeaders = brk: {
            if (options_object) |options| {
                if (try options.fastGet(globalThis, .headers)) |headers_value| {
                    if (!headers_value.isUndefined()) {
                        if (headers_value.as(FetchHeaders)) |headers__| {
                            if (headers__.isEmpty()) {
                                break :brk null;
                            }

                            break :brk headers__;
                        }

                        if (try FetchHeaders.createFromJS(ctx, headers_value)) |headers__| {
                            fetch_headers_to_deref = headers__;
                            break :brk headers__;
                        }

                        break :brk null;
                    }
                }

                if (globalThis.hasException()) {
                    is_error = true;
                    return .zero;
                }
            }

            if (request) |req| {
                if (req.getFetchHeadersUnlessEmpty()) |head| {
                    break :brk head;
                }

                break :brk null;
            }

            if (request_init_object) |options| {
                if (try options.fastGet(globalThis, .headers)) |headers_value| {
                    if (!headers_value.isUndefined()) {
                        if (headers_value.as(FetchHeaders)) |headers__| {
                            if (headers__.isEmpty()) {
                                break :brk null;
                            }

                            break :brk headers__;
                        }

                        if (try FetchHeaders.createFromJS(ctx, headers_value)) |headers__| {
                            fetch_headers_to_deref = headers__;
                            break :brk headers__;
                        }

                        break :brk null;
                    }
                }
            }

            if (globalThis.hasException()) {
                is_error = true;
                return .zero;
            }

            break :extract_headers headers;
        };

        if (globalThis.hasException()) {
            is_error = true;
            return .zero;
        }

        if (fetch_headers) |headers_| {
            if (headers_.fastGet(bun.webcore.FetchHeaders.HTTPHeaderName.Host)) |_hostname| {
                if (hostname) |host| {
                    hostname = null;
                    allocator.free(host);
                }
                hostname = bun.handleOom(_hostname.toOwnedSliceZ(allocator));
            }
            if (url.isS3()) {
                if (headers_.fastGet(bun.webcore.FetchHeaders.HTTPHeaderName.Range)) |_range| {
                    if (range) |range_| {
                        range = null;
                        allocator.free(range_);
                    }
                    range = bun.handleOom(_range.toOwnedSliceZ(allocator));
                }
            }

            if (headers_.fastGet(bun.webcore.FetchHeaders.HTTPHeaderName.Upgrade)) |_upgrade| {
                const upgrade = _upgrade.toSlice(bun.default_allocator);
                defer upgrade.deinit();
                const slice = upgrade.slice();
                if (!bun.strings.eqlComptime(slice, "h2") and !bun.strings.eqlComptime(slice, "h2c")) {
                    upgraded_connection = true;
                }
            }

            break :extract_headers Headers.from(headers_, allocator, .{ .body = body.getAnyBlob() }) catch |err| bun.handleOom(err);
        }

        break :extract_headers headers;
    };

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    if (proxy != null and unix_socket_path.length() > 0) {
        is_error = true;
        const err = ctx.toTypeError(.INVALID_ARG_VALUE, fetch_error_proxy_unix, .{});
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    if (globalThis.hasException()) {
        is_error = true;
        return .zero;
    }

    // This is not 100% correct.
    // We don't pass along headers, we ignore method, we ignore status code...
    // But it's better than status quo.
    if (url_type != .remote) {
        defer unix_socket_path.deinit();
        var path_buf: bun.PathBuffer = undefined;
        const PercentEncoding = @import("../../url.zig").PercentEncoding;
        var path_buf2: bun.PathBuffer = undefined;
        var stream = std.io.fixedBufferStream(&path_buf2);
        var url_path_decoded = path_buf2[0 .. PercentEncoding.decode(
            @TypeOf(&stream.writer()),
            &stream.writer(),
            switch (url_type) {
                .file => url.path,
                .blob => url.href["blob:".len..],
                .remote => unreachable,
            },
        ) catch |err| {
            return globalThis.throwError(err, "Failed to decode file url");
        }];
        var url_string: bun.String = bun.String.empty;
        defer url_string.deref();
        // This can be a blob: url or a file: url.
        const blob_to_use = blob: {

            // Support blob: urls
            if (url_type == URLType.blob) {
                if (jsc.WebCore.ObjectURLRegistry.singleton().resolveAndDupe(url_path_decoded)) |blob| {
                    url_string = bun.String.createFormat("blob:{s}", .{url_path_decoded}) catch |err| bun.handleOom(err);
                    break :blob blob;
                } else {
                    // Consistent with what Node.js does - it rejects, not a 404.
                    const err = globalThis.toTypeError(.INVALID_ARG_VALUE, "Failed to resolve blob:{s}", .{
                        url_path_decoded,
                    });
                    is_error = true;
                    return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
                }
            }

            const temp_file_path = brk: {
                if (std.fs.path.isAbsolute(url_path_decoded)) {
                    if (Environment.isWindows) {
                        // pathname will start with / if is a absolute path on windows, so we remove before normalizing it
                        if (url_path_decoded[0] == '/') {
                            url_path_decoded = url_path_decoded[1..];
                        }
                        break :brk PosixToWinNormalizer.resolveCWDWithExternalBufZ(&path_buf, url_path_decoded) catch |err| {
                            return globalThis.throwError(err, "Failed to resolve file url");
                        };
                    }
                    break :brk url_path_decoded;
                }

                var cwd_buf: bun.PathBuffer = undefined;
                const cwd = if (Environment.isWindows) (bun.getcwd(&cwd_buf) catch |err| {
                    return globalThis.throwError(err, "Failed to resolve file url");
                }) else globalThis.bunVM().transpiler.fs.top_level_dir;

                const fullpath = bun.path.joinAbsStringBuf(
                    cwd,
                    &path_buf,
                    &[_]string{
                        globalThis.bunVM().main,
                        "../",
                        url_path_decoded,
                    },
                    .auto,
                );
                if (Environment.isWindows) {
                    break :brk PosixToWinNormalizer.resolveCWDWithExternalBufZ(&path_buf2, fullpath) catch |err| {
                        return globalThis.throwError(err, "Failed to resolve file url");
                    };
                }
                break :brk fullpath;
            };

            url_string = jsc.URL.fileURLFromString(bun.String.borrowUTF8(temp_file_path));

            var pathlike: jsc.Node.PathOrFileDescriptor = .{
                .path = .{
                    .encoded_slice = ZigString.Slice.init(bun.default_allocator, try bun.default_allocator.dupe(u8, temp_file_path)),
                },
            };

            break :blob Blob.findOrCreateFileFromPath(
                &pathlike,
                globalThis,
                true,
            );
        };

        const response = bun.new(Response, Response.init(
            Response.Init{
                .status_code = 200,
            },
            Body{
                .value = .{ .Blob = blob_to_use },
            },
            url_string.clone(),
            false,
        ));

        return JSPromise.resolvedPromiseValue(globalThis, response.toJS(globalThis));
    }

    if (url.protocol.len > 0) {
        if (!(url.isHTTP() or url.isHTTPS() or url.isS3())) {
            const err = globalThis.toTypeError(.INVALID_ARG_VALUE, "protocol must be http:, https: or s3:", .{});
            is_error = true;
            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
        }
    }

    if (!allow_get_body and !method.hasRequestBody() and body.hasBody() and !upgraded_connection) {
        const err = globalThis.toTypeError(.INVALID_ARG_VALUE, fetch_error_unexpected_body, .{});
        is_error = true;
        return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err);
    }

    if (headers == null and body.hasBody() and body.hasContentTypeFromUser()) {
        headers = Headers.from(
            null,
            allocator,
            .{ .body = body.getAnyBlob() },
        ) catch |err| bun.handleOom(err);
    }

    var http_body = body;
    if (body.isS3()) {
        prepare_body: {
            // is a S3 file we can use chunked here

            if (try jsc.WebCore.ReadableStream.fromJS(try jsc.WebCore.ReadableStream.fromBlobCopyRef(globalThis, &body.AnyBlob.Blob, s3.MultiPartUploadOptions.DefaultPartSize), globalThis)) |stream| {
                var old = body;
                defer old.detach();
                body = .{ .ReadableStream = jsc.WebCore.ReadableStream.Strong.init(stream, globalThis) };
                break :prepare_body;
            }
            const rejected_value = JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, globalThis.createErrorInstance("Failed to start s3 stream", .{}));
            body.detach();

            return rejected_value;
        }
    }
    if (body.needsToReadFile()) {
        prepare_body: {
            const opened_fd_res: bun.sys.Maybe(bun.FileDescriptor) = switch (body.store().?.data.file.pathlike) {
                .fd => |fd| bun.sys.dup(fd),
                .path => |path| bun.sys.open(path.sliceZ(&globalThis.bunVM().nodeFS().sync_error_buf), if (Environment.isWindows) bun.O.RDONLY else bun.O.RDONLY | bun.O.NOCTTY, 0),
            };

            const opened_fd = switch (opened_fd_res) {
                .err => |err| {
                    const rejected_value = JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err.toJS(globalThis) catch return .zero);
                    is_error = true;
                    return rejected_value;
                },
                .result => |fd| fd,
            };

            if (proxy == null and bun.http.SendFile.isEligible(url)) {
                use_sendfile: {
                    const stat: bun.Stat = switch (bun.sys.fstat(opened_fd)) {
                        .result => |result| result,
                        // bail out for any reason
                        .err => break :use_sendfile,
                    };

                    if (Environment.isMac) {
                        // macOS only supports regular files for sendfile()
                        if (!bun.isRegularFile(stat.mode)) {
                            break :use_sendfile;
                        }
                    }

                    // if it's < 32 KB, it's not worth it
                    if (stat.size < 32 * 1024) {
                        break :use_sendfile;
                    }

                    const original_size = body.AnyBlob.Blob.size;
                    const stat_size = @as(Blob.SizeType, @intCast(stat.size));
                    const blob_size = if (bun.isRegularFile(stat.mode))
                        stat_size
                    else
                        @min(original_size, stat_size);

                    http_body = .{
                        .Sendfile = .{
                            .fd = opened_fd,
                            .remain = body.AnyBlob.Blob.offset + original_size,
                            .offset = body.AnyBlob.Blob.offset,
                            .content_size = blob_size,
                        },
                    };

                    if (bun.isRegularFile(stat.mode)) {
                        http_body.Sendfile.offset = @min(http_body.Sendfile.offset, stat_size);
                        http_body.Sendfile.remain = @min(@max(http_body.Sendfile.remain, http_body.Sendfile.offset), stat_size) -| http_body.Sendfile.offset;
                    }
                    body.detach();

                    break :prepare_body;
                }
            }

            // TODO: make this async + lazy
            const res = jsc.Node.fs.NodeFS.readFile(
                globalThis.bunVM().nodeFS(),
                .{
                    .encoding = .buffer,
                    .path = .{ .fd = opened_fd },
                    .offset = body.AnyBlob.Blob.offset,
                    .max_size = body.AnyBlob.Blob.size,
                },
                .sync,
            );

            if (body.store().?.data.file.pathlike == .path) {
                opened_fd.close();
            }

            switch (res) {
                .err => |err| {
                    is_error = true;
                    const rejected_value = JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err.toJS(globalThis) catch return .zero);
                    body.detach();

                    return rejected_value;
                },
                .result => |result| {
                    body.detach();
                    body = .{ .AnyBlob = .fromOwnedSlice(allocator, @constCast(result.slice())) };
                    http_body = .{ .AnyBlob = body.AnyBlob };
                },
            }
        }
    }

    if (url.isS3()) {
        // get ENV config
        var credentialsWithOptions: s3.S3CredentialsWithOptions = .{
            .credentials = globalThis.bunVM().transpiler.env.getS3Credentials(),
            .options = .{},
            .acl = null,
            .storage_class = null,
        };
        defer {
            credentialsWithOptions.deinit();
        }

        if (options_object) |options| {
            if (try options.getTruthyComptime(globalThis, "s3")) |s3_options| {
                if (s3_options.isObject()) {
                    s3_options.ensureStillAlive();
                    credentialsWithOptions = try s3.S3Credentials.getCredentialsWithOptions(credentialsWithOptions.credentials, .{}, s3_options, null, null, false, globalThis);
                }
            }
        }

        if (body == .ReadableStream) {
            // we cannot direct stream to s3 we need to use multi part upload
            defer body.ReadableStream.deinit();
            const Wrapper = struct {
                promise: jsc.JSPromise.Strong,
                url: ZigURL,
                url_proxy_buffer: []const u8,
                global: *jsc.JSGlobalObject,

                pub const new = bun.TrivialNew(@This());

                pub fn resolve(result: s3.S3UploadResult, self: *@This()) bun.JSTerminated!void {
                    const global = self.global;
                    defer bun.destroy(self);
                    defer bun.default_allocator.free(self.url_proxy_buffer);
                    switch (result) {
                        .success => {
                            const response = bun.new(Response, Response.init(
                                Response.Init{
                                    .method = .PUT,
                                    .status_code = 200,
                                },
                                Body{
                                    .value = .Empty,
                                },
                                bun.String.createAtomIfPossible(self.url.href),
                                false,
                            ));
                            const response_js = Response.makeMaybePooled(@as(*jsc.JSGlobalObject, global), response);
                            response_js.ensureStillAlive();
                            try self.promise.resolve(global, response_js);
                        },
                        .failure => |err| {
                            const response = bun.new(Response, Response.init(
                                .{
                                    .method = .PUT,
                                    .status_code = 500,
                                    .status_text = bun.String.createAtomIfPossible(err.code),
                                },
                                .{
                                    .value = .{
                                        .InternalBlob = .{
                                            .bytes = std.array_list.Managed(u8).fromOwnedSlice(bun.default_allocator, bun.handleOom(bun.default_allocator.dupe(u8, err.message))),
                                            .was_string = true,
                                        },
                                    },
                                },
                                bun.String.createAtomIfPossible(self.url.href),
                                false,
                            ));

                            const response_js = Response.makeMaybePooled(@as(*jsc.JSGlobalObject, global), response);
                            response_js.ensureStillAlive();
                            try self.promise.resolve(global, response_js);
                        },
                    }
                }
            };
            if (method != .PUT and method != .POST) {
                return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, globalThis.createErrorInstance("Only POST and PUT do support body when using S3", .{}));
            }
            const promise = jsc.JSPromise.Strong.init(globalThis);

            const s3_stream = Wrapper.new(.{
                .url = url,
                .url_proxy_buffer = url_proxy_buffer,
                .promise = promise,
                .global = globalThis,
            });

            const promise_value = promise.value();
            const proxy_url = if (proxy) |p| p.href else "";
            _ = try bun.S3.uploadStream(
                credentialsWithOptions.credentials.dupe(),
                url.s3Path(),
                body.ReadableStream.get(globalThis).?,
                globalThis,
                credentialsWithOptions.options,
                credentialsWithOptions.acl,
                credentialsWithOptions.storage_class,
                if (headers) |h| (h.getContentType()) else null,
                if (headers) |h| h.getContentDisposition() else null,
                if (headers) |h| h.getContentEncoding() else null,
                proxy_url,
                credentialsWithOptions.request_payer,
                @ptrCast(&Wrapper.resolve),
                s3_stream,
            );
            url = .{};
            url_proxy_buffer = "";
            return promise_value;
        }
        if (method == .POST) {
            method = .PUT;
        }

        var result = credentialsWithOptions.credentials.signRequest(.{
            .path = url.s3Path(),
            .method = method,
        }, false, null) catch |sign_err| {
            is_error = true;
            return JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, s3.getJSSignError(sign_err, globalThis));
        };
        defer result.deinit();
        if (proxy) |proxy_| {
            // proxy and url are in the same buffer lets replace it
            const old_buffer = url_proxy_buffer;
            defer allocator.free(old_buffer);
            var buffer = bun.handleOom(allocator.alloc(u8, result.url.len + proxy_.href.len));
            bun.copy(u8, buffer[0..result.url.len], result.url);
            bun.copy(u8, buffer[proxy_.href.len..], proxy_.href);
            url_proxy_buffer = buffer;

            url = ZigURL.parse(url_proxy_buffer[0..result.url.len]);
            proxy = ZigURL.parse(url_proxy_buffer[result.url.len..]);
        } else {
            // replace headers and url of the request
            allocator.free(url_proxy_buffer);
            url_proxy_buffer = result.url;
            url = ZigURL.parse(result.url);
            result.url = ""; // fetch now owns this
        }

        const content_type = if (headers) |h| (h.getContentType()) else null;
        var header_buffer: [s3.S3Credentials.SignResult.MAX_HEADERS + 1]picohttp.Header = undefined;

        if (range) |range_| {
            const _headers = result.mixWithHeader(&header_buffer, .{ .name = "range", .value = range_ });
            setHeaders(&headers, _headers, allocator);
        } else if (content_type) |ct| {
            if (ct.len > 0) {
                const _headers = result.mixWithHeader(&header_buffer, .{ .name = "Content-Type", .value = ct });
                setHeaders(&headers, _headers, allocator);
            } else {
                setHeaders(&headers, result.headers(), allocator);
            }
        } else {
            setHeaders(&headers, result.headers(), allocator);
        }
    }

    // Only create this after we have validated all the input.
    // or else we will leak it
    var promise = JSPromise.Strong.init(globalThis);

    const promise_val = promise.value();

    const initial_body_reference_count: if (Environment.isDebug) usize else u0 = brk: {
        if (Environment.isDebug) {
            if (body.store()) |store| {
                break :brk store.ref_count.load(.monotonic);
            }
        }

        break :brk 0;
    };

    _ = FetchTasklet.queue(
        allocator,
        globalThis,
        &.{
            .method = method,
            .url = url,
            .headers = headers orelse Headers{
                .allocator = allocator,
            },
            .body = http_body,
            .disable_keepalive = disable_keepalive,
            .disable_timeout = disable_timeout,
            .disable_decompression = disable_decompression,
            .reject_unauthorized = reject_unauthorized,
            .redirect_type = redirect_type,
            .verbose = verbose,
            .proxy = proxy,
            .proxy_headers = proxy_headers,
            .url_proxy_buffer = url_proxy_buffer,
            .signal = signal,
            .globalThis = globalThis,
            .ssl_config = ssl_config,
            .hostname = hostname,
            .upgraded_connection = upgraded_connection,
            .check_server_identity = if (check_server_identity.isEmptyOrUndefinedOrNull()) .empty else .create(check_server_identity, globalThis),
            .unix_socket_path = unix_socket_path,
        },
        // Pass the Strong value instead of creating a new one, or else we
        // will leak it
        // see https://github.com/oven-sh/bun/issues/2985
        promise,
    ) catch |err| bun.handleOom(err);

    if (Environment.isDebug) {
        if (body.store()) |store| {
            if (store.ref_count.load(.monotonic) == initial_body_reference_count) {
                Output.panic("Expected body ref count to have incremented in FetchTasklet", .{});
            }
        }
    }

    // These are now owned by FetchTasklet.
    url = .{};
    headers = null;
    // Reference count for the blob is incremented above.
    if (body.store() != null) {
        body.detach();
    } else {
        // These are single-use, and have effectively been moved to the FetchTasklet.
        body = FetchTasklet.HTTPRequestBody.Empty;
    }
    proxy = null;
    proxy_headers = null;
    url_proxy_buffer = "";
    signal = null;
    ssl_config = null;
    hostname = null;
    unix_socket_path = ZigString.Slice.empty;

    return promise_val;
}
fn setHeaders(headers: *?Headers, new_headers: []const picohttp.Header, allocator: std.mem.Allocator) void {
    var old = headers.*;
    headers.* = bun.handleOom(Headers.fromPicoHttpHeaders(new_headers, allocator));

    if (old) |*headers_| {
        headers_.deinit();
    }
}

const string = []const u8;

const std = @import("std");
const DataURL = @import("../../resolver/data_url.zig").DataURL;
const Method = @import("../../http/Method.zig").Method;
const ZigURL = @import("../../url.zig").URL;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const picohttp = bun.picohttp;
const s3 = bun.S3;
const FetchHeaders = bun.webcore.FetchHeaders;
const PosixToWinNormalizer = bun.path.PosixToWinNormalizer;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const http = bun.http;
const FetchRedirect = http.FetchRedirect;
const Headers = bun.http.Headers;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSPromise = jsc.JSPromise;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = jsc.ZigString;
const JSType = jsc.C.JSType;

const Body = jsc.WebCore.Body;
const Request = jsc.WebCore.Request;
const Response = jsc.WebCore.Response;

const Blob = jsc.WebCore.Blob;
const AnyBlob = jsc.WebCore.Blob.Any;
