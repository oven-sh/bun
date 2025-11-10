const FetchTasklet = @This();

http: ?*bun.http.AsyncHTTP = null,

javascript_vm: *VirtualMachine = undefined,
global_this: *JSGlobalObject = undefined,

promise: jsc.JSPromise.Strong,
concurrent_task: jsc.ConcurrentTask = .{},
poll_ref: Async.KeepAlive = .{},

signal: ?*jsc.WebCore.AbortSignal = null,

// must be stored because AbortSignal stores reason weakly
abort_reason: jsc.Strong.Optional = .empty,

mutex: Mutex,
tracker: jsc.Debugger.AsyncTaskTracker,
ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

request: FetchTaskletRequest = .{},
response: FetchTaskletResponse = .{},
shared: FetchTaskletSharedData = .{},

state: enum {
    created,
    enqueued,
    failed,
    done,
} = .created,

pub fn ref(this: *FetchTasklet) void {
    const count = this.ref_count.fetchAdd(1, .monotonic);
    bun.debugAssert(count > 0);
}

pub fn deref(this: *FetchTasklet) void {
    const count = this.ref_count.fetchSub(1, .monotonic);
    bun.debugAssert(count > 0);

    if (count == 1) {
        this.deinit() catch |err| switch (err) {};
    }
}

pub fn derefFromThread(this: *FetchTasklet) void {
    const count = this.ref_count.fetchSub(1, .monotonic);
    bun.debugAssert(count > 0);

    if (count == 1) {
        // this is really unlikely to happen, but can happen
        // lets make sure that we always call deinit from main thread

        this.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.deinit));
    }
}

pub fn init(_: std.mem.Allocator) anyerror!FetchTasklet {
    return FetchTasklet{};
}

fn clearSink(this: *FetchTasklet) void {
    if (this.sink) |sink| {
        this.sink = null;
        sink.deref();
    }
    if (this.request_body_streaming_buffer) |buffer| {
        this.request_body_streaming_buffer = null;
        buffer.clearDrainCallback();
        buffer.deref();
    }
}

fn clearData(this: *FetchTasklet) void {
    log("clearData ", .{});
    const allocator = bun.default_allocator;
    if (this.url_proxy_buffer.len > 0) {
        allocator.free(this.url_proxy_buffer);
        this.url_proxy_buffer.len = 0;
    }

    if (this.hostname) |hostname| {
        allocator.free(hostname);
        this.hostname = null;
    }

    if (this.result.certificate_info) |*certificate| {
        certificate.deinit(bun.default_allocator);
        this.result.certificate_info = null;
    }

    this.request_headers.entries.deinit(allocator);
    this.request_headers.buf.deinit(allocator);
    this.request_headers = Headers{ .allocator = undefined };

    if (this.http) |http_| {
        http_.clearData();
    }

    if (this.metadata != null) {
        this.metadata.?.deinit(allocator);
        this.metadata = null;
    }

    this.response_buffer.deinit();
    this.response.deinit();
    if (this.native_response) |response| {
        this.native_response = null;

        response.unref();
    }

    this.readable_stream_ref.deinit();

    this.scheduled_response_buffer.deinit();
    if (this.request_body != .ReadableStream or this.is_waiting_request_stream_start) {
        this.request_body.detach();
    }

    this.abort_reason.deinit();
    this.check_server_identity.deinit();
    this.clearAbortSignal();
    // Clear the sink only after the requested ended otherwise we would potentialy lose the last chunk
    this.clearSink();
}

// XXX: 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
pub fn deinit(this: *FetchTasklet) error{}!void {
    log("deinit", .{});

    bun.assert(this.ref_count.load(.monotonic) == 0);

    this.clearData();

    const allocator = bun.default_allocator;

    if (this.http) |http_| {
        this.http = null;
        allocator.destroy(http_);
    }
    allocator.destroy(this);
}

fn getCurrentResponse(this: *FetchTasklet) ?*Response {
    // we need a body to resolve the promise when buffering
    if (this.native_response) |response| {
        return response;
    }

    // if we did not have a direct reference we check if the Weak ref is still alive
    if (this.response.get()) |response_js| {
        if (response_js.as(Response)) |response| {
            return response;
        }
    }

    return null;
}

fn getAbortError(this: *FetchTasklet) ?Body.Value.ValueError {
    if (this.abort_reason.has()) {
        defer this.clearAbortSignal();
        const out = this.abort_reason;

        this.abort_reason = .empty;
        return Body.Value.ValueError{ .JSValue = out };
    }

    if (this.signal) |signal| {
        if (signal.reasonIfAborted(this.global_this)) |reason| {
            defer this.clearAbortSignal();
            return reason.toBodyValueError(this.global_this);
        }
    }

    return null;
}

fn clearAbortSignal(this: *FetchTasklet) void {
    const signal = this.signal orelse return;
    this.signal = null;
    defer {
        signal.pendingActivityUnref();
        signal.unref();
    }

    signal.cleanNativeBindings(this);
}

pub fn onReject(this: *FetchTasklet) Body.Value.ValueError {
    bun.assert(this.result.fail != null);
    log("onReject", .{});

    if (this.getAbortError()) |err| {
        return err;
    }

    if (this.result.abortReason()) |reason| {
        return .{ .AbortReason = reason };
    }

    // some times we don't have metadata so we also check http.url
    const path = if (this.metadata) |metadata|
        bun.String.cloneUTF8(metadata.url)
    else if (this.http) |http_|
        bun.String.cloneUTF8(http_.url.href)
    else
        bun.String.empty;

    const fetch_error = jsc.SystemError{
        .code = bun.String.static(switch (this.result.fail.?) {
            error.ConnectionClosed => "ECONNRESET",
            else => |e| @errorName(e),
        }),
        .message = switch (this.result.fail.?) {
            error.ConnectionClosed => bun.String.static("The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()"),
            error.FailedToOpenSocket => bun.String.static("Was there a typo in the url or port?"),
            error.TooManyRedirects => bun.String.static("The response redirected too many times. For more information, pass `verbose: true` in the second argument to fetch()"),
            error.ConnectionRefused => bun.String.static("Unable to connect. Is the computer able to access the url?"),
            error.RedirectURLInvalid => bun.String.static("Redirect URL in Location header is invalid."),

            error.UNABLE_TO_GET_ISSUER_CERT => bun.String.static("unable to get issuer certificate"),
            error.UNABLE_TO_GET_CRL => bun.String.static("unable to get certificate CRL"),
            error.UNABLE_TO_DECRYPT_CERT_SIGNATURE => bun.String.static("unable to decrypt certificate's signature"),
            error.UNABLE_TO_DECRYPT_CRL_SIGNATURE => bun.String.static("unable to decrypt CRL's signature"),
            error.UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY => bun.String.static("unable to decode issuer public key"),
            error.CERT_SIGNATURE_FAILURE => bun.String.static("certificate signature failure"),
            error.CRL_SIGNATURE_FAILURE => bun.String.static("CRL signature failure"),
            error.CERT_NOT_YET_VALID => bun.String.static("certificate is not yet valid"),
            error.CRL_NOT_YET_VALID => bun.String.static("CRL is not yet valid"),
            error.CERT_HAS_EXPIRED => bun.String.static("certificate has expired"),
            error.CRL_HAS_EXPIRED => bun.String.static("CRL has expired"),
            error.ERROR_IN_CERT_NOT_BEFORE_FIELD => bun.String.static("format error in certificate's notBefore field"),
            error.ERROR_IN_CERT_NOT_AFTER_FIELD => bun.String.static("format error in certificate's notAfter field"),
            error.ERROR_IN_CRL_LAST_UPDATE_FIELD => bun.String.static("format error in CRL's lastUpdate field"),
            error.ERROR_IN_CRL_NEXT_UPDATE_FIELD => bun.String.static("format error in CRL's nextUpdate field"),
            error.OUT_OF_MEM => bun.String.static("out of memory"),
            error.DEPTH_ZERO_SELF_SIGNED_CERT => bun.String.static("self signed certificate"),
            error.SELF_SIGNED_CERT_IN_CHAIN => bun.String.static("self signed certificate in certificate chain"),
            error.UNABLE_TO_GET_ISSUER_CERT_LOCALLY => bun.String.static("unable to get local issuer certificate"),
            error.UNABLE_TO_VERIFY_LEAF_SIGNATURE => bun.String.static("unable to verify the first certificate"),
            error.CERT_CHAIN_TOO_LONG => bun.String.static("certificate chain too long"),
            error.CERT_REVOKED => bun.String.static("certificate revoked"),
            error.INVALID_CA => bun.String.static("invalid CA certificate"),
            error.INVALID_NON_CA => bun.String.static("invalid non-CA certificate (has CA markings)"),
            error.PATH_LENGTH_EXCEEDED => bun.String.static("path length constraint exceeded"),
            error.PROXY_PATH_LENGTH_EXCEEDED => bun.String.static("proxy path length constraint exceeded"),
            error.PROXY_CERTIFICATES_NOT_ALLOWED => bun.String.static("proxy certificates not allowed, please set the appropriate flag"),
            error.INVALID_PURPOSE => bun.String.static("unsupported certificate purpose"),
            error.CERT_UNTRUSTED => bun.String.static("certificate not trusted"),
            error.CERT_REJECTED => bun.String.static("certificate rejected"),
            error.APPLICATION_VERIFICATION => bun.String.static("application verification failure"),
            error.SUBJECT_ISSUER_MISMATCH => bun.String.static("subject issuer mismatch"),
            error.AKID_SKID_MISMATCH => bun.String.static("authority and subject key identifier mismatch"),
            error.AKID_ISSUER_SERIAL_MISMATCH => bun.String.static("authority and issuer serial number mismatch"),
            error.KEYUSAGE_NO_CERTSIGN => bun.String.static("key usage does not include certificate signing"),
            error.UNABLE_TO_GET_CRL_ISSUER => bun.String.static("unable to get CRL issuer certificate"),
            error.UNHANDLED_CRITICAL_EXTENSION => bun.String.static("unhandled critical extension"),
            error.KEYUSAGE_NO_CRL_SIGN => bun.String.static("key usage does not include CRL signing"),
            error.KEYUSAGE_NO_DIGITAL_SIGNATURE => bun.String.static("key usage does not include digital signature"),
            error.UNHANDLED_CRITICAL_CRL_EXTENSION => bun.String.static("unhandled critical CRL extension"),
            error.INVALID_EXTENSION => bun.String.static("invalid or inconsistent certificate extension"),
            error.INVALID_POLICY_EXTENSION => bun.String.static("invalid or inconsistent certificate policy extension"),
            error.NO_EXPLICIT_POLICY => bun.String.static("no explicit policy"),
            error.DIFFERENT_CRL_SCOPE => bun.String.static("Different CRL scope"),
            error.UNSUPPORTED_EXTENSION_FEATURE => bun.String.static("Unsupported extension feature"),
            error.UNNESTED_RESOURCE => bun.String.static("RFC 3779 resource not subset of parent's resources"),
            error.PERMITTED_VIOLATION => bun.String.static("permitted subtree violation"),
            error.EXCLUDED_VIOLATION => bun.String.static("excluded subtree violation"),
            error.SUBTREE_MINMAX => bun.String.static("name constraints minimum and maximum not supported"),
            error.UNSUPPORTED_CONSTRAINT_TYPE => bun.String.static("unsupported name constraint type"),
            error.UNSUPPORTED_CONSTRAINT_SYNTAX => bun.String.static("unsupported or invalid name constraint syntax"),
            error.UNSUPPORTED_NAME_SYNTAX => bun.String.static("unsupported or invalid name syntax"),
            error.CRL_PATH_VALIDATION_ERROR => bun.String.static("CRL path validation error"),
            error.SUITE_B_INVALID_VERSION => bun.String.static("Suite B: certificate version invalid"),
            error.SUITE_B_INVALID_ALGORITHM => bun.String.static("Suite B: invalid public key algorithm"),
            error.SUITE_B_INVALID_CURVE => bun.String.static("Suite B: invalid ECC curve"),
            error.SUITE_B_INVALID_SIGNATURE_ALGORITHM => bun.String.static("Suite B: invalid signature algorithm"),
            error.SUITE_B_LOS_NOT_ALLOWED => bun.String.static("Suite B: curve not allowed for this LOS"),
            error.SUITE_B_CANNOT_SIGN_P_384_WITH_P_256 => bun.String.static("Suite B: cannot sign P-384 with P-256"),
            error.HOSTNAME_MISMATCH => bun.String.static("Hostname mismatch"),
            error.EMAIL_MISMATCH => bun.String.static("Email address mismatch"),
            error.IP_ADDRESS_MISMATCH => bun.String.static("IP address mismatch"),
            error.INVALID_CALL => bun.String.static("Invalid certificate verification context"),
            error.STORE_LOOKUP => bun.String.static("Issuer certificate lookup error"),
            error.NAME_CONSTRAINTS_WITHOUT_SANS => bun.String.static("Issuer has name constraints but leaf has no SANs"),
            error.UNKNOWN_CERTIFICATE_VERIFICATION_ERROR => bun.String.static("unknown certificate verification error"),

            else => |e| bun.String.createFormat("{s} fetching \"{f}\". For more information, pass `verbose: true` in the second argument to fetch()", .{
                @errorName(e),
                path,
            }) catch |err| bun.handleOom(err),
        },
        .path = path,
    };

    return .{ .SystemError = fetch_error };
}

export fn Bun__FetchResponse_finalize(this: *FetchTasklet) callconv(.c) void {
    log("onResponseFinalize", .{});
    if (this.native_response) |response| {
        const body = response.getBodyValue();
        // Three scenarios:
        //
        // 1. We are streaming, in which case we should not ignore the body.
        // 2. We were buffering, in which case
        //    2a. if we have no promise, we should ignore the body.
        //    2b. if we have a promise, we should keep loading the body.
        // 3. We never started buffering, in which case we should ignore the body.
        //
        // Note: We cannot call .get() on the ReadableStreamRef. This is called inside a finalizer.
        if (body.* != .Locked or this.readable_stream_ref.held.has()) {
            // Scenario 1 or 3.
            return;
        }

        if (body.Locked.promise) |promise| {
            if (promise.isEmptyOrUndefinedOrNull()) {
                // Scenario 2b.
                this.ignoreRemainingResponseBody();
            }
        } else {
            // Scenario 3.
            this.ignoreRemainingResponseBody();
        }
    }
}
comptime {
    _ = Bun__FetchResponse_finalize;
}

pub fn onResolve(this: *FetchTasklet) JSValue {
    log("onResolve", .{});
    const response = bun.new(Response, this.toResponse());
    const response_js = Response.makeMaybePooled(@as(*jsc.JSGlobalObject, this.global_this), response);
    response_js.ensureStillAlive();
    this.response = jsc.Weak(FetchTasklet).create(response_js, this.global_this, .FetchResponse, this);
    this.native_response = response.ref();
    return response_js;
}

pub fn get(
    allocator: std.mem.Allocator,
    globalThis: *jsc.JSGlobalObject,
    fetch_options: *const FetchOptions,
    promise: jsc.JSPromise.Strong,
) !*FetchTasklet {
    var jsc_vm = globalThis.bunVM();
    var fetch_tasklet = try allocator.create(FetchTasklet);

    fetch_tasklet.* = .{
        .mutex = .{},
        .scheduled_response_buffer = .{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        },
        .response_buffer = MutableString{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        },
        .http = try allocator.create(http.AsyncHTTP),
        .javascript_vm = jsc_vm,
        .request_body = fetch_options.body,
        .global_this = globalThis,
        .promise = promise,
        .request_headers = fetch_options.headers,
        .url_proxy_buffer = fetch_options.url_proxy_buffer,
        .signal = fetch_options.signal,
        .hostname = fetch_options.hostname,
        .tracker = jsc.Debugger.AsyncTaskTracker.init(jsc_vm),
        .check_server_identity = fetch_options.check_server_identity,
        .reject_unauthorized = fetch_options.reject_unauthorized,
        .upgraded_connection = fetch_options.upgraded_connection,
    };

    fetch_tasklet.signals = fetch_tasklet.signal_store.to();

    fetch_tasklet.tracker.didSchedule(globalThis);

    if (fetch_tasklet.request_body.store()) |store| {
        store.ref();
    }

    var proxy: ?ZigURL = null;
    if (fetch_options.proxy) |proxy_opt| {
        if (!proxy_opt.isEmpty()) { //if is empty just ignore proxy
            proxy = fetch_options.proxy orelse jsc_vm.transpiler.env.getHttpProxyFor(fetch_options.url);
        }
    } else {
        proxy = jsc_vm.transpiler.env.getHttpProxyFor(fetch_options.url);
    }

    if (fetch_tasklet.check_server_identity.has() and fetch_tasklet.reject_unauthorized) {
        fetch_tasklet.signal_store.cert_errors.store(true, .monotonic);
    } else {
        fetch_tasklet.signals.cert_errors = null;
    }

    // This task gets queued on the HTTP thread.
    fetch_tasklet.http.?.* = http.AsyncHTTP.init(
        bun.default_allocator,
        fetch_options.method,
        fetch_options.url,
        fetch_options.headers.entries,
        fetch_options.headers.buf.items,
        &fetch_tasklet.response_buffer,
        fetch_tasklet.request_body.slice(),
        http.HTTPClientResult.Callback.New(
            *FetchTasklet,
            // handles response events (on headers, on body, etc.)
            FetchTasklet.callback,
        ).init(fetch_tasklet),
        fetch_options.redirect_type,
        .{
            .http_proxy = proxy,
            .hostname = fetch_options.hostname,
            .signals = fetch_tasklet.signals,
            .unix_socket_path = fetch_options.unix_socket_path,
            .disable_timeout = fetch_options.disable_timeout,
            .disable_keepalive = fetch_options.disable_keepalive,
            .disable_decompression = fetch_options.disable_decompression,
            .reject_unauthorized = fetch_options.reject_unauthorized,
            .verbose = fetch_options.verbose,
            .tls_props = fetch_options.ssl_config,
        },
    );
    // enable streaming the write side
    const isStream = fetch_tasklet.request_body == .ReadableStream;
    fetch_tasklet.http.?.client.flags.is_streaming_request_body = isStream;
    fetch_tasklet.is_waiting_request_stream_start = isStream;
    if (isStream) {
        const buffer = http.ThreadSafeStreamBuffer.new(.{});
        buffer.setDrainCallback(FetchTasklet, FetchTasklet.onWriteRequestDataDrain, fetch_tasklet);
        fetch_tasklet.request_body_streaming_buffer = buffer;
        fetch_tasklet.http.?.request_body = .{
            .stream = .{
                .buffer = buffer,
                .ended = false,
            },
        };
    }
    // TODO is this necessary? the http client already sets the redirect type,
    // so manually setting it here seems redundant
    if (fetch_options.redirect_type != FetchRedirect.follow) {
        fetch_tasklet.http.?.client.remaining_redirect_count = 0;
    }

    // we want to return after headers are received
    fetch_tasklet.signal_store.header_progress.store(true, .monotonic);

    if (fetch_tasklet.request_body == .Sendfile) {
        bun.assert(fetch_options.url.isHTTP());
        bun.assert(fetch_options.proxy == null);
        fetch_tasklet.http.?.request_body = .{ .sendfile = fetch_tasklet.request_body.Sendfile };
    }

    if (fetch_tasklet.signal) |signal| {
        signal.pendingActivityRef();
        fetch_tasklet.signal = signal.listen(FetchTasklet, fetch_tasklet, FetchTasklet.abortListener);
    }
    return fetch_tasklet;
}

pub fn abortListener(this: *FetchTasklet, reason: JSValue) void {
    log("abortListener", .{});
    reason.ensureStillAlive();
    this.abort_reason.set(this.global_this, reason);
    this.abortTask();
    if (this.sink) |sink| {
        sink.cancel(reason);
        return;
    }
}
pub fn isAborted(this: *FetchTasklet) bool {
    if (this.signal_store.aborted.load(.monotonic)) {
        return true;
    }
    if (this.signal) |signal| {
        return signal.aborted();
    }
    return false;
}
pub fn abortTask(this: *FetchTasklet) void {
    this.signal_store.aborted.store(true, .monotonic);
    this.tracker.didCancel(this.global_this);

    if (this.http) |http_| {
        http.http_thread.scheduleShutdown(http_);
    }
}

const FetchOptions = struct {
    method: Method,
    headers: Headers,
    body: HTTPRequestBody,
    disable_timeout: bool,
    disable_keepalive: bool,
    disable_decompression: bool,
    reject_unauthorized: bool,
    url: ZigURL,
    verbose: http.HTTPVerboseLevel = .none,
    redirect_type: FetchRedirect = FetchRedirect.follow,
    proxy: ?ZigURL = null,
    url_proxy_buffer: []const u8 = "",
    signal: ?*jsc.WebCore.AbortSignal = null,
    globalThis: ?*JSGlobalObject,
    // Custom Hostname
    hostname: ?[]u8 = null,
    check_server_identity: jsc.Strong.Optional = .empty,
    unix_socket_path: ZigString.Slice,
    ssl_config: ?*SSLConfig = null,
    upgraded_connection: bool = false,
};

pub fn queue(
    allocator: std.mem.Allocator,
    global: *JSGlobalObject,
    fetch_options: *const FetchOptions,
    promise: jsc.JSPromise.Strong,
) !*FetchTasklet {
    http.HTTPThread.init(&.{});
    var node = try get(
        allocator,
        global,
        fetch_options,
        promise,
    );

    var batch = bun.ThreadPool.Batch{};
    node.http.?.schedule(allocator, &batch);
    node.poll_ref.ref(global.bunVM());

    // increment ref so we can keep it alive until the http client is done
    node.ref();
    http.http_thread.schedule(batch);

    return node;
}

/// Called from HTTP thread. Handles HTTP events received from socket.
pub fn callback(task: *FetchTasklet, async_http: *http.AsyncHTTP, result: http.HTTPClientResult) void {
    // at this point only this thread is accessing result to is no race condition
    const is_done = !result.has_more;
    // we are done with the http client so we can deref our side
    // this is a atomic operation and will enqueue a task to deinit on the main thread
    defer if (is_done) task.derefFromThread();

    task.mutex.lock();
    // we need to unlock before task.deref();
    defer task.mutex.unlock();
    task.http.?.* = async_http.*;
    task.http.?.response_buffer = async_http.response_buffer;

    log("callback success={} ignore_data={} has_more={} bytes={}", .{ result.isSuccess(), task.ignore_data, result.has_more, result.body.?.list.items.len });

    const prev_metadata = task.result.metadata;
    const prev_cert_info = task.result.certificate_info;
    task.result = result;

    // Preserve pending certificate info if it was preovided in the previous update.
    if (task.result.certificate_info == null) {
        if (prev_cert_info) |cert_info| {
            task.result.certificate_info = cert_info;
        }
    }

    // metadata should be provided only once
    if (result.metadata orelse prev_metadata) |metadata| {
        log("added callback metadata", .{});
        if (task.metadata == null) {
            task.metadata = metadata;
        }

        task.result.metadata = null;
    }

    task.body_size = result.body_size;

    const success = result.isSuccess();
    task.response_buffer = result.body.?.*;

    if (task.ignore_data) {
        task.response_buffer.reset();

        if (task.scheduled_response_buffer.list.capacity > 0) {
            task.scheduled_response_buffer.deinit();
            task.scheduled_response_buffer = .{
                .allocator = bun.default_allocator,
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            };
        }
        if (success and result.has_more) {
            // we are ignoring the body so we should not receive more data, so will only signal when result.has_more = true
            return;
        }
    } else {
        if (success) {
            _ = bun.handleOom(task.scheduled_response_buffer.write(task.response_buffer.list.items));
        }
        // reset for reuse
        task.response_buffer.reset();
    }

    if (task.has_schedule_callback.cmpxchgStrong(false, true, .acquire, .monotonic)) |has_schedule_callback| {
        if (has_schedule_callback) {
            return;
        }
    }

    task.javascript_vm.eventLoop().enqueueTaskConcurrent(task.concurrent_task.from(task, .manual_deinit));
}

const X509 = @import("../../api/bun/x509.zig");
const std = @import("std");
const Method = @import("../../../http/Method.zig").Method;
const ZigURL = @import("../../../url.zig").URL;

const bun = @import("bun");
const Async = bun.Async;
const MutableString = bun.MutableString;
const Mutex = bun.Mutex;
const Output = bun.Output;
const BoringSSL = bun.BoringSSL.c;
const FetchHeaders = bun.webcore.FetchHeaders;
const SSLConfig = bun.api.server.ServerConfig.SSLConfig;

const FetchRedirect = bun.http.FetchRedirect;
const Headers = bun.http.Headers;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSPromise = jsc.JSPromise;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = jsc.ZigString;

const Body = jsc.WebCore.Body;
const Response = jsc.WebCore.Response;
const ResumableSinkBackpressure = jsc.WebCore.ResumableSinkBackpressure;

const Blob = jsc.WebCore.Blob;
const AnyBlob = jsc.WebCore.Blob.Any;
const HTTPRequestBody = @import("tasklet/HTTPRequestBody.zig").HTTPRequestBody;
const FetchTaskletRequest = @import("tasklet/Request.zig");
const FetchTaskletResponse = @import("tasklet/Response.zig");
const log = Output.scoped(.FetchTasklet, .visible);
const FetchTaskletSharedData = @import("tasklet/SharedData.zig");
