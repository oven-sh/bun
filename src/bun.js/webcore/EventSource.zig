//! EventSource (Server-Sent Events) client.
//!
//! https://html.spec.whatwg.org/multipage/server-sent-events.html
//!
//! This is a Zig-generated class that drives an HTTP GET request using the
//! same `bun.http.AsyncHTTP` machinery that `FetchTasklet` uses: a
//! `Signals.Store` for header-progress / body-streaming / abort, a
//! `MutableString` pair for HTTP-thread → JS-thread body handoff, and a
//! `ConcurrentTask` to hop back to the JS thread. Incoming body chunks are
//! fed through an incremental SSE line parser and dispatched to JS as real
//! `MessageEvent` objects.

pub const EventSource = @This();

const log = Output.scoped(.EventSource, .visible);

const ReadyState = enum(u8) {
    connecting = 0,
    open = 1,
    closed = 2,
};

const default_reconnection_time_ms: u32 = 3000;

pub const js = jsc.Codegen.JSEventSource;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

ref_count: RefCount,

globalThis: *JSGlobalObject,
vm: *VirtualMachine,
this_value: jsc.JSRef = jsc.JSRef.empty(),
poll_ref: bun.Async.KeepAlive = .{},
has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

/// Normalized absolute URL (owned; also backs `url.href`).
url_href: []const u8 = "",
url: ZigURL = .{},
/// scheme://host[:port] — derived from `url` so every MessageEvent carries it.
origin: []const u8 = "",

with_credentials: bool = false,
ready_state: ReadyState = .connecting,

/// Optional extra request headers supplied via `new EventSource(url, { headers })`.
/// Kept as an immutable template; each connect builds a fresh `Headers` from it
/// plus `Accept`, `Cache-Control`, and (on reconnect) `Last-Event-ID`.
extra_headers: bun.http.Headers,

/// Per-spec reconnection parameters.
last_event_id: std.ArrayListUnmanaged(u8) = .{},
reconnection_time_ms: u32 = default_reconnection_time_ms,
reconnect_timer: EventLoopTimer = .{ .tag = .EventSourceReconnect, .next = .epoch },

// --- HTTP state (FetchTasklet-style) --------------------------------------
async_http: ?*http.AsyncHTTP = null,
request_headers: bun.http.Headers,
signal_store: http.Signals.Store = .{},
signals: http.Signals = .{},
/// Buffer the HTTP thread writes into for each socket read.
response_buffer: MutableString = .{ .allocator = bun.default_allocator, .list = .{} },
/// Bytes handed off from HTTP thread → JS thread under `mutex`.
scheduled_response_buffer: MutableString = .{ .allocator = bun.default_allocator, .list = .{} },
mutex: bun.Mutex = .{},
has_schedule_callback: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
concurrent_task: jsc.ConcurrentTask = .{},

/// HTTP result bookkeeping (updated on HTTP thread under `mutex`).
result_has_more: bool = true,
result_fail: ?anyerror = null,
result_status_code: u16 = 0,
result_content_type_ok: bool = false,
/// Final post-redirect URL cloned from `metadata.url` on the HTTP thread;
/// consumed (and applied to `url_href`/`url`/`origin`) on the JS thread so
/// readers of those fields never race the free/reassign.
result_final_url: ?[]const u8 = null,
/// True once the HTTP thread has delivered response metadata.
got_metadata: bool = false,

// --- SSE parser state (JS thread only) -------------------------------------
/// Carry-over for a partial line that did not end in LF/CR yet.
line_buffer: std.ArrayListUnmanaged(u8) = .{},
/// `data` buffer per §9.2.6 (joined with '\n').
data_buffer: std.ArrayListUnmanaged(u8) = .{},
/// `event` field for the current in-progress message; empty → "message".
event_type_buffer: std.ArrayListUnmanaged(u8) = .{},
/// Whether the previous byte processed was '\r' (so a following '\n' is the
/// second half of a CRLF and must be swallowed).
last_byte_was_cr: bool = false,
/// Whether we've received any body bytes on the current connection yet;
/// used to strip one leading UTF-8 BOM per the spec's `stream = [bom] *event`.
seen_body_bytes: bool = false,
/// Whether we've announced the connection (fired "open") yet.
announced: bool = false,

// ---------------------------------------------------------------------------
// C++ helpers (EventSourceEvents.cpp)
// ---------------------------------------------------------------------------
extern fn Bun__createSSEMessageEvent(
    global: *JSGlobalObject,
    event_type: *const bun.String,
    data: *const bun.String,
    origin: *const bun.String,
    last_event_id: *const bun.String,
) JSValue;
extern fn Bun__createSSEOpenEvent(global: *JSGlobalObject) JSValue;
extern fn Bun__createSSEErrorEvent(global: *JSGlobalObject, message: *const bun.String) JSValue;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

pub fn constructor(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame, js_this: JSValue) bun.JSError!*EventSource {
    const args = callframe.arguments();
    if (args.len < 1 or args[0].isUndefined()) {
        return globalThis.throwNotEnoughArguments("EventSource", 1, args.len);
    }

    // Parse and normalize the URL (throws SyntaxError on failure per spec).
    const url_bun_str = try args[0].toBunString(globalThis);
    defer url_bun_str.deref();
    const href_input = url_bun_str.toUTF8(bun.default_allocator);
    defer href_input.deinit();

    const url = ZigURL.fromUTF8(bun.default_allocator, href_input.slice()) catch {
        return globalThis.throwDOMException(.SyntaxError, "EventSource: failed to parse URL \"{s}\"", .{href_input.slice()});
    };
    // `url.href` is owned by us (allocated inside fromUTF8).
    errdefer bun.default_allocator.free(url.href);

    if (!url.isHTTP() and !url.isHTTPS()) {
        return globalThis.throwDOMException(.SyntaxError, "EventSource: URL must use http or https (got \"{s}\")", .{url.displayProtocol()});
    }

    var with_credentials = false;
    var extra_headers = bun.http.Headers{ .allocator = bun.default_allocator };
    errdefer extra_headers.deinit();

    if (args.len > 1 and args[1].isObject()) {
        const opts = args[1];
        if (try opts.getBooleanLoose(globalThis, "withCredentials")) |wc| {
            with_credentials = wc;
        }
        // Bun extension: allow passing extra request headers (e.g. Authorization).
        if (try opts.getTruthy(globalThis, "headers")) |headers_value| {
            if (headers_value.as(FetchHeaders)) |fh| {
                extra_headers = try bun.http.Headers.from(fh, bun.default_allocator, .{});
            } else if (headers_value.isObject()) {
                if (try FetchHeaders.createFromJS(globalThis, headers_value)) |fh| {
                    defer fh.deref();
                    extra_headers = try bun.http.Headers.from(fh, bun.default_allocator, .{});
                }
            }
            js.headersSetCached(js_this, globalThis, headers_value);
        }
    }

    const origin_owned = bun.handleOom(bun.default_allocator.dupe(u8, url.origin));
    errdefer bun.default_allocator.free(origin_owned);

    const vm = globalThis.bunVM();
    const this = bun.new(EventSource, .{
        .ref_count = .init(),
        .globalThis = globalThis,
        .vm = vm,
        .url_href = url.href,
        .url = url,
        .origin = origin_owned,
        .with_credentials = with_credentials,
        .extra_headers = extra_headers,
        .request_headers = .{ .allocator = bun.default_allocator },
    });

    this.this_value = .initStrong(js_this, globalThis);
    this.poll_ref.ref(vm);
    this.has_pending_activity.store(1, .release);

    this.connect();
    return this;
}

pub fn finalize(this: *EventSource) void {
    this.this_value.finalize();
    this.deref();
}

fn deinit(this: *EventSource) void {
    this.cancelReconnectTimer();
    this.clearHttp();
    if (this.url_href.len > 0) bun.default_allocator.free(this.url_href);
    if (this.origin.len > 0) bun.default_allocator.free(this.origin);
    if (this.result_final_url) |u| bun.default_allocator.free(u);
    this.extra_headers.deinit();
    this.request_headers.deinit();
    this.last_event_id.deinit(bun.default_allocator);
    this.line_buffer.deinit(bun.default_allocator);
    this.data_buffer.deinit(bun.default_allocator);
    this.event_type_buffer.deinit(bun.default_allocator);
    this.response_buffer.deinit();
    this.scheduled_response_buffer.deinit();
    this.poll_ref.unref(this.vm);
    bun.destroy(this);
}

pub fn memoryCost(this: *const EventSource) usize {
    return @sizeOf(EventSource) +
        this.url_href.len +
        this.origin.len +
        this.extra_headers.memoryCost() +
        this.request_headers.memoryCost() +
        this.last_event_id.capacity +
        this.line_buffer.capacity +
        this.data_buffer.capacity +
        this.event_type_buffer.capacity +
        this.response_buffer.list.capacity +
        this.scheduled_response_buffer.list.capacity;
}

pub fn hasPendingActivity(this: *EventSource) callconv(.c) bool {
    return this.has_pending_activity.load(.acquire) > 0;
}

// ---------------------------------------------------------------------------
// HTTP connection lifecycle
// ---------------------------------------------------------------------------

fn buildRequestHeaders(this: *EventSource) void {
    this.request_headers.deinit();
    this.request_headers = .{ .allocator = bun.default_allocator };

    // Copy user-supplied headers first so spec-required ones below take
    // precedence via later `append`s (AsyncHTTP writes them in order).
    {
        const names = this.extra_headers.entries.items(.name);
        const values = this.extra_headers.entries.items(.value);
        for (names, values) |n, v| {
            const name = this.extra_headers.asStr(n);
            // Skip headers we always set ourselves.
            if (strings.eqlCaseInsensitiveASCII(name, "accept", true) or
                strings.eqlCaseInsensitiveASCII(name, "cache-control", true) or
                strings.eqlCaseInsensitiveASCII(name, "last-event-id", true))
                continue;
            bun.handleOom(this.request_headers.append(name, this.extra_headers.asStr(v)));
        }
    }

    bun.handleOom(this.request_headers.append("Accept", "text/event-stream"));
    bun.handleOom(this.request_headers.append("Cache-Control", "no-cache"));
    if (this.last_event_id.items.len > 0) {
        bun.handleOom(this.request_headers.append("Last-Event-ID", this.last_event_id.items));
    }
}

fn clearHttp(this: *EventSource) void {
    if (this.async_http) |h| {
        this.async_http = null;
        h.clearData();
        bun.default_allocator.destroy(h);
    }
}

fn connect(this: *EventSource) void {
    log("connect", .{});
    bun.assert(this.ready_state != .closed);

    this.clearHttp();
    this.resetPerConnectionState();
    this.buildRequestHeaders();

    this.signal_store = .{};
    this.signals = this.signal_store.to();
    // Emit progress as soon as headers arrive and stream the body.
    this.signal_store.header_progress.store(true, .monotonic);

    const h = bun.handleOom(bun.default_allocator.create(http.AsyncHTTP));
    this.async_http = h;

    var proxy: ?ZigURL = null;
    if (this.vm.transpiler.env.getHttpProxyFor(this.url)) |env_proxy| {
        proxy = env_proxy;
    }

    h.* = http.AsyncHTTP.init(
        bun.default_allocator,
        .GET,
        this.url,
        this.request_headers.entries,
        this.request_headers.buf.items,
        &this.response_buffer,
        "",
        http.HTTPClientResult.Callback.New(*EventSource, EventSource.httpCallback).init(this),
        .follow,
        .{
            .http_proxy = proxy,
            .signals = this.signals,
            .verbose = this.vm.getVerboseFetch(),
            .reject_unauthorized = this.vm.getTLSRejectUnauthorized(),
            // SSE connections are long-lived; rely on the server or .close().
            .disable_timeout = true,
        },
    );
    h.enableResponseBodyStreaming();

    // Hold an extra ref for the in-flight HTTP request so that the struct
    // cannot be destroyed while the HTTP thread still holds pointers into it.
    this.ref();

    http.HTTPThread.init(&.{});
    var batch = bun.ThreadPool.Batch{};
    h.schedule(bun.default_allocator, &batch);
    http.http_thread.schedule(batch);
}

fn resetPerConnectionState(this: *EventSource) void {
    this.response_buffer.reset();
    this.scheduled_response_buffer.reset();
    this.line_buffer.clearRetainingCapacity();
    this.data_buffer.clearRetainingCapacity();
    this.event_type_buffer.clearRetainingCapacity();
    this.last_byte_was_cr = false;
    this.seen_body_bytes = false;
    this.result_has_more = true;
    this.result_fail = null;
    this.result_status_code = 0;
    this.result_content_type_ok = false;
    if (this.result_final_url) |u| {
        bun.default_allocator.free(u);
        this.result_final_url = null;
    }
    this.got_metadata = false;
    this.announced = false;
    this.has_schedule_callback.store(false, .monotonic);
}

fn abortHttp(this: *EventSource) void {
    this.signal_store.aborted.store(true, .monotonic);
    if (this.async_http) |h| http.http_thread.scheduleShutdown(h);
}

/// Runs on the HTTP thread. Mirrors `FetchTasklet.callback`: copy result state
/// and any new body bytes into `scheduled_response_buffer` under `mutex`, then
/// enqueue a JS-thread tick via `concurrent_task`.
pub fn httpCallback(this: *EventSource, async_http: *http.AsyncHTTP, result: http.HTTPClientResult) void {
    const is_done = !result.has_more;
    this.mutex.lock();
    defer this.mutex.unlock();

    if (this.async_http) |h| {
        h.* = async_http.*;
        h.response_buffer = async_http.response_buffer;
    }

    this.result_has_more = result.has_more;
    if (result.fail) |e| this.result_fail = e;

    if (result.certificate_info) |*cert| cert.deinit(bun.default_allocator);

    if (result.metadata) |m| {
        var metadata = m;
        this.got_metadata = true;
        this.result_status_code = @truncate(metadata.response.status_code);
        for (metadata.response.headers.list) |header| {
            if (strings.eqlCaseInsensitiveASCII(header.name, "content-type", true)) {
                // Per spec: MIME type must be text/event-stream (parameters ignored).
                const v = strings.trim(header.value, " \t");
                if (v.len >= "text/event-stream".len and
                    strings.eqlCaseInsensitiveASCII(v[0.."text/event-stream".len], "text/event-stream", true))
                {
                    const rest = v["text/event-stream".len..];
                    if (rest.len == 0 or rest[0] == ';' or rest[0] == ' ' or rest[0] == '\t')
                        this.result_content_type_ok = true;
                }
                break;
            }
        }
        // Per spec, MessageEvent.origin must reflect the *final* URL after
        // redirects. AsyncHTTP was created with `.follow`, and `metadata.url`
        // carries that final URL. We only stash a copy here under the mutex;
        // the JS thread applies it in `onProgressUpdate` so that the free of
        // the old `url_href`/`origin` can't race with `getURL()` / event
        // dispatch / `memoryCost()` which read them unlocked.
        if (metadata.url.len > 0 and this.result_final_url == null) {
            this.result_final_url = bun.handleOom(bun.default_allocator.dupe(u8, metadata.url));
        }
        metadata.deinit(bun.default_allocator);
    }

    if (result.body) |body| {
        if (body.list.items.len > 0) {
            _ = bun.handleOom(this.scheduled_response_buffer.write(body.list.items));
        }
        body.reset();
    }

    if (!is_done) {
        // Don't wake the JS thread for an empty interim tick.
        if (!this.got_metadata and this.scheduled_response_buffer.list.items.len == 0) return;
    }

    if (this.has_schedule_callback.cmpxchgStrong(false, true, .acquire, .monotonic)) |prev| {
        if (prev) return;
    }
    if (this.vm.isShuttingDown()) return;
    this.vm.eventLoop().enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
}

// ---------------------------------------------------------------------------
// JS-thread progress
// ---------------------------------------------------------------------------

/// Called from the event loop task queue (JS thread). Drains any buffered body
/// bytes into the SSE parser and handles connection-level state transitions.
pub fn onProgressUpdate(this: *EventSource) void {
    this.mutex.lock();
    this.has_schedule_callback.store(false, .monotonic);

    const has_more = this.result_has_more;
    const fail = this.result_fail;
    const got_metadata = this.got_metadata;
    const status = this.result_status_code;
    const ct_ok = this.result_content_type_ok;
    const final_url = this.result_final_url;
    this.result_final_url = null;

    // Steal the buffered body bytes; a fresh list replaces the shared buffer so
    // the HTTP thread can keep appending without contending on the parser.
    var chunk = this.scheduled_response_buffer;
    this.scheduled_response_buffer = .{ .allocator = bun.default_allocator, .list = .{} };
    this.mutex.unlock();
    defer chunk.deinit();

    // Apply any redirect-updated URL now that we're on the JS thread — the
    // free+reassign of `url_href`/`origin` must not race with `getURL()` or
    // `dispatchPendingMessage()` (which borrow these slices unlocked).
    if (final_url) |new_href| {
        if (!strings.eql(new_href, this.url_href)) {
            bun.default_allocator.free(this.url_href);
            this.url_href = new_href;
            this.url = ZigURL.parse(new_href);
            bun.default_allocator.free(this.origin);
            this.origin = bun.handleOom(bun.default_allocator.dupe(u8, this.url.origin));
        } else {
            bun.default_allocator.free(new_href);
        }
    }

    const is_done = !has_more;
    // Balance the ref taken in `connect()` once the request fully ends.
    defer if (is_done) this.deref();

    if (this.ready_state == .closed) return;

    const event_loop = this.vm.eventLoop();
    event_loop.enter();
    defer event_loop.exit();

    // Connection-level failure (socket error, TLS failure, abort, …).
    if (fail) |err| {
        if (is_done) {
            // User-initiated abort (.close()) already set readyState = closed.
            this.failAndMaybeReconnect(@errorName(err));
        }
        return;
    }

    if (got_metadata and !this.announced) {
        // Per spec: 200 + text/event-stream → announce; anything else → fail.
        if (status != 200 or !ct_ok) {
            this.abortHttp();
            this.failConnectionPermanently(status, ct_ok);
            return;
        }
        this.announced = true;
        this.ready_state = .open;
        this.dispatchSimpleEvent(.open);
        if (this.ready_state == .closed) return;
    }

    if (this.announced and chunk.list.items.len > 0) {
        this.feed(chunk.list.items);
        if (this.ready_state == .closed) return;
    }

    if (is_done) {
        // Network error / clean close while stream was open → reconnect.
        this.failAndMaybeReconnect(if (this.announced) null else "connection closed before headers");
    }
}

fn failConnectionPermanently(this: *EventSource, status: u16, ct_ok: bool) void {
    var buf: [160]u8 = undefined;
    const msg = if (status != 200)
        std.fmt.bufPrint(&buf, "EventSource: unexpected HTTP status {d}", .{status}) catch "EventSource: unexpected HTTP status"
    else if (!ct_ok)
        "EventSource: server did not respond with Content-Type: text/event-stream"
    else
        "EventSource: connection failed";

    this.ready_state = .closed;
    // Dispatch the error while `this_value` is still a strong ref and
    // `has_pending_activity` is still set — `goIdle()` downgrades both, after
    // which a GC triggered by the ErrorEvent allocation could collect the
    // wrapper before `dispatchToHandlers` reads it.
    this.dispatchErrorEvent(msg);
    this.goIdle();
}

/// Per spec "reestablish the connection": queue an error event, wait the
/// reconnection time, then re-run the connect steps. A network error before
/// the stream opened (no metadata) is treated the same way here — browsers
/// also retry on connection refused.
fn failAndMaybeReconnect(this: *EventSource, message: ?[]const u8) void {
    if (this.ready_state == .closed) return;
    this.ready_state = .connecting;
    this.dispatchErrorEvent(message orelse "");
    if (this.ready_state == .closed) return;
    this.scheduleReconnect();
}

fn scheduleReconnect(this: *EventSource) void {
    this.cancelReconnectTimer();
    const ms: u32 = if (this.reconnection_time_ms == 0) 1 else this.reconnection_time_ms;
    this.reconnect_timer.next = bun.timespec.msFromNow(.allow_mocked_time, @intCast(ms));
    this.vm.timer.insert(&this.reconnect_timer);
    this.ref();
}

fn cancelReconnectTimer(this: *EventSource) void {
    if (this.reconnect_timer.state == .ACTIVE) {
        this.vm.timer.remove(&this.reconnect_timer);
        this.deref();
    }
}

pub fn onReconnectTimer(this: *EventSource) void {
    this.reconnect_timer.state = .FIRED;
    this.ref();
    defer this.deref();
    // balance scheduleReconnect's ref
    this.deref();
    if (this.ready_state == .closed) return;
    this.connect();
}

fn goIdle(this: *EventSource) void {
    this.has_pending_activity.store(0, .release);
    this.poll_ref.unref(this.vm);
    this.cancelReconnectTimer();
    if (this.this_value == .strong) this.this_value.downgrade();
}

// ---------------------------------------------------------------------------
// SSE parser (https://html.spec.whatwg.org/#event-stream-interpretation)
// ---------------------------------------------------------------------------

fn feed(this: *EventSource, bytes: []const u8) void {
    var i: usize = 0;
    // Spec ABNF: `stream = [ bom ] *event`. Strip exactly one leading UTF-8
    // BOM at the start of each connection's body.
    if (!this.seen_body_bytes) {
        this.seen_body_bytes = true;
        if (bytes.len >= 3 and bytes[0] == 0xEF and bytes[1] == 0xBB and bytes[2] == 0xBF) {
            i = 3;
        }
    }
    // Swallow the LF half of a CRLF that straddled the previous chunk.
    if (this.last_byte_was_cr and i < bytes.len and bytes[i] == '\n') i += 1;
    this.last_byte_was_cr = false;

    while (i < bytes.len) {
        const slice = bytes[i..];
        if (strings.indexOfAny(slice, "\r\n")) |pos| {
            bun.handleOom(this.line_buffer.appendSlice(bun.default_allocator, slice[0..pos]));
            const line = this.line_buffer.items;
            this.processLine(line);
            this.line_buffer.clearRetainingCapacity();
            if (this.ready_state == .closed) return;
            i += pos + 1;
            if (slice[pos] == '\r') {
                if (i < bytes.len and bytes[i] == '\n') {
                    i += 1;
                } else if (i == bytes.len) {
                    this.last_byte_was_cr = true;
                }
            }
        } else {
            bun.handleOom(this.line_buffer.appendSlice(bun.default_allocator, slice));
            break;
        }
    }
}

fn processLine(this: *EventSource, line: []const u8) void {
    if (line.len == 0) {
        this.dispatchPendingMessage();
        return;
    }
    if (line[0] == ':') return; // comment

    var field: []const u8 = line;
    var value: []const u8 = "";
    if (std.mem.indexOfScalar(u8, line, ':')) |colon| {
        field = line[0..colon];
        value = line[colon + 1 ..];
        if (value.len > 0 and value[0] == ' ') value = value[1..];
    }

    if (strings.eqlComptime(field, "data")) {
        // Spec: append the field value, then append a single U+000A. Using
        // the literal form (rather than a "join with \n" shortcut) preserves
        // leading empty `data:` lines — `data:\ndata: x\n\n` → "\nx" and a
        // bare `data:\n\n` still dispatches with data === "".
        bun.handleOom(this.data_buffer.appendSlice(bun.default_allocator, value));
        bun.handleOom(this.data_buffer.append(bun.default_allocator, '\n'));
    } else if (strings.eqlComptime(field, "event")) {
        this.event_type_buffer.clearRetainingCapacity();
        bun.handleOom(this.event_type_buffer.appendSlice(bun.default_allocator, value));
    } else if (strings.eqlComptime(field, "id")) {
        // Per spec: ignore if the value contains U+0000.
        if (std.mem.indexOfScalar(u8, value, 0) == null) {
            this.last_event_id.clearRetainingCapacity();
            bun.handleOom(this.last_event_id.appendSlice(bun.default_allocator, value));
        }
    } else if (strings.eqlComptime(field, "retry")) {
        if (value.len > 0) {
            var all_digits = true;
            for (value) |c| {
                if (c < '0' or c > '9') {
                    all_digits = false;
                    break;
                }
            }
            if (all_digits) {
                this.reconnection_time_ms = std.fmt.parseInt(u32, value, 10) catch this.reconnection_time_ms;
            }
        }
    }
    // Unknown fields are ignored per spec.
}

fn dispatchPendingMessage(this: *EventSource) void {
    defer {
        this.data_buffer.clearRetainingCapacity();
        this.event_type_buffer.clearRetainingCapacity();
    }
    // Spec: "if the data buffer is an empty string, set the data buffer and
    // the event type buffer to the empty string and return." Because every
    // `data` line appends value+LF, an empty buffer here means no `data`
    // field was seen at all.
    if (this.data_buffer.items.len == 0) return;
    // Spec: "if the data buffer's last character is a U+000A LINE FEED (LF)
    // character, remove the last character from the data buffer." It always
    // is, given how processLine() appends.
    bun.assert(this.data_buffer.items[this.data_buffer.items.len - 1] == '\n');
    this.data_buffer.items.len -= 1;

    const event_type = if (this.event_type_buffer.items.len > 0)
        bun.String.cloneUTF8(this.event_type_buffer.items)
    else
        bun.String.empty;
    defer event_type.deref();
    const data = bun.String.cloneUTF8(this.data_buffer.items);
    defer data.deref();
    const origin = bun.String.borrowUTF8(this.origin);
    const last_id = bun.String.cloneUTF8(this.last_event_id.items);
    defer last_id.deref();

    const event = Bun__createSSEMessageEvent(this.globalThis, &event_type, &data, &origin, &last_id);
    event.ensureStillAlive();

    const type_slice: []const u8 = if (this.event_type_buffer.items.len > 0)
        this.event_type_buffer.items
    else
        "message";
    this.dispatchToHandlers(type_slice, event);
}

// ---------------------------------------------------------------------------
// Event dispatch
// ---------------------------------------------------------------------------

fn dispatchSimpleEvent(this: *EventSource, comptime kind: enum { open }) void {
    const event = switch (kind) {
        .open => Bun__createSSEOpenEvent(this.globalThis),
    };
    event.ensureStillAlive();
    this.dispatchToHandlers("open", event);
}

fn dispatchErrorEvent(this: *EventSource, message: []const u8) void {
    const msg = if (message.len > 0) bun.String.cloneUTF8(message) else bun.String.empty;
    defer msg.deref();
    const event = Bun__createSSEErrorEvent(this.globalThis, &msg);
    event.ensureStillAlive();
    this.dispatchToHandlers("error", event);
}

/// Invoke a listener per the DOM "inner invoke" steps: a function is called
/// with `thisArg` = the EventSource; an EventListener object has its
/// `handleEvent` method called with `thisArg` = the listener object.
fn invokeListener(global: *JSGlobalObject, this_js: JSValue, listener: JSValue, event: JSValue) void {
    if (listener.isCallable()) {
        _ = listener.call(global, this_js, &.{event}) catch |e|
            global.reportActiveExceptionAsUnhandled(e);
        return;
    }
    if (listener.isObject()) {
        const handle = listener.getTruthy(global, "handleEvent") catch |e| {
            global.reportActiveExceptionAsUnhandled(e);
            return;
        } orelse return;
        if (handle.isCallable()) {
            _ = handle.call(global, listener, &.{event}) catch |e|
                global.reportActiveExceptionAsUnhandled(e);
        }
    }
}

fn dispatchToHandlers(this: *EventSource, event_type: []const u8, event: JSValue) void {
    const this_js = this.this_value.tryGet() orelse return;
    this_js.ensureStillAlive();
    const global = this.globalThis;

    // on<type> handler attribute.
    const maybe_handler: ?JSValue = blk: {
        if (strings.eqlComptime(event_type, "open")) break :blk js.onopenGetCached(this_js);
        if (strings.eqlComptime(event_type, "message")) break :blk js.onmessageGetCached(this_js);
        if (strings.eqlComptime(event_type, "error")) break :blk js.onerrorGetCached(this_js);
        break :blk null;
    };
    if (maybe_handler) |handler| {
        if (handler.isCallable()) {
            _ = handler.call(global, this_js, &.{event}) catch |e|
                global.reportActiveExceptionAsUnhandled(e);
            if (this.ready_state == .closed) return;
        }
    }

    // addEventListener-registered listeners. Entries are stored as
    // { cb: <fn|{handleEvent}>, once: <bool> }. Snapshot the list before
    // invoking so mutations during dispatch don't affect this run (DOM
    // "inner invoke" semantics).
    const listeners_obj = js.listenersGetCached(this_js) orelse return;
    if (!listeners_obj.isObject()) return;
    const maybe_arr = listeners_obj.getOwn(global, event_type) catch return;
    const arr = maybe_arr orelse return;
    if (!arr.jsType().isArray()) return;

    const len: u32 = @intCast(arr.getLength(global) catch return);
    if (len == 0) return;

    var had_once = false;
    var idx: u32 = 0;
    while (idx < len) : (idx += 1) {
        const entry = arr.getIndex(global, idx) catch return;
        if (!entry.isObject()) continue;
        const cb = entry.getOwn(global, "cb") catch return orelse continue;
        const once_val = entry.getOwn(global, "once") catch return;
        const is_once = once_val != null and once_val.?.toBoolean();
        if (is_once) {
            had_once = true;
            // Mark before invoking so re-entrancy can't fire it again.
            entry.put(global, bun.String.static("cb"), .js_undefined);
        }
        invokeListener(global, this_js, cb, event);
        if (this.ready_state == .closed) break;
    }

    if (had_once) {
        // Rebuild the array without the consumed {once:true} entries. We do
        // this after the loop (rather than splicing in place) so indices
        // remain stable during iteration.
        const live = listeners_obj.getOwn(global, event_type) catch return orelse return;
        if (!live.jsType().isArray()) return;
        const live_len: u32 = @intCast(live.getLength(global) catch return);
        const filtered = JSValue.createEmptyArray(global, 0) catch return;
        var j: u32 = 0;
        while (j < live_len) : (j += 1) {
            const entry = live.getIndex(global, j) catch return;
            if (!entry.isObject()) continue;
            const cb = entry.getOwn(global, "cb") catch return orelse continue;
            if (cb.isUndefined()) continue;
            filtered.push(global, entry) catch return;
        }
        var key = bun.String.init(event_type);
        listeners_obj.putMayBeIndex(global, &key, filtered) catch return;
    }
}

// ---------------------------------------------------------------------------
// JS API: properties
// ---------------------------------------------------------------------------

pub fn getURL(this: *EventSource, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    return bun.String.createUTF8ForJS(globalThis, this.url_href);
}

pub fn getReadyState(this: *EventSource, _: *JSGlobalObject) JSValue {
    return JSValue.jsNumber(@as(i32, @intFromEnum(this.ready_state)));
}

pub fn getWithCredentials(this: *EventSource, _: *JSGlobalObject) JSValue {
    return JSValue.jsBoolean(this.with_credentials);
}

pub fn getConnecting(_: *EventSource, _: *JSGlobalObject) JSValue {
    return JSValue.jsNumber(@as(i32, 0));
}
pub fn getOpen(_: *EventSource, _: *JSGlobalObject) JSValue {
    return JSValue.jsNumber(@as(i32, 1));
}
pub fn getClosed(_: *EventSource, _: *JSGlobalObject) JSValue {
    return JSValue.jsNumber(@as(i32, 2));
}
pub fn getStaticConnecting(_: *JSGlobalObject, _: JSValue, _: JSValue) JSValue {
    return JSValue.jsNumber(@as(i32, 0));
}
pub fn getStaticOpen(_: *JSGlobalObject, _: JSValue, _: JSValue) JSValue {
    return JSValue.jsNumber(@as(i32, 1));
}
pub fn getStaticClosed(_: *JSGlobalObject, _: JSValue, _: JSValue) JSValue {
    return JSValue.jsNumber(@as(i32, 2));
}

pub fn getOnOpen(_: *EventSource, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return js.onopenGetCached(thisValue) orelse .null;
}
pub fn setOnOpen(_: *EventSource, thisValue: JSValue, global: *JSGlobalObject, value: JSValue) void {
    js.onopenSetCached(thisValue, global, if (value.isCallable()) value else .zero);
}
pub fn getOnMessage(_: *EventSource, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return js.onmessageGetCached(thisValue) orelse .null;
}
pub fn setOnMessage(_: *EventSource, thisValue: JSValue, global: *JSGlobalObject, value: JSValue) void {
    js.onmessageSetCached(thisValue, global, if (value.isCallable()) value else .zero);
}
pub fn getOnError(_: *EventSource, thisValue: JSValue, _: *JSGlobalObject) JSValue {
    return js.onerrorGetCached(thisValue) orelse .null;
}
pub fn setOnError(_: *EventSource, thisValue: JSValue, global: *JSGlobalObject, value: JSValue) void {
    js.onerrorSetCached(thisValue, global, if (value.isCallable()) value else .zero);
}

// ---------------------------------------------------------------------------
// JS API: methods
// ---------------------------------------------------------------------------

pub fn doClose(this: *EventSource, _: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    if (this.ready_state == .closed) return .js_undefined;
    this.ready_state = .closed;
    this.abortHttp();
    this.goIdle();
    return .js_undefined;
}

pub fn doRef(this: *EventSource, _: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    if (this.ready_state != .closed) this.poll_ref.ref(this.vm);
    return .js_undefined;
}

pub fn doUnref(this: *EventSource, _: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.poll_ref.unref(this.vm);
    return .js_undefined;
}

fn ensureListeners(thisValue: JSValue, global: *JSGlobalObject) JSValue {
    if (js.listenersGetCached(thisValue)) |existing| {
        if (existing.isObject()) return existing;
    }
    const obj = JSValue.createEmptyObjectWithNullPrototype(global);
    js.listenersSetCached(thisValue, global, obj);
    return obj;
}

pub fn addEventListener(_: *EventSource, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.arguments();
    if (args.len < 2) return .js_undefined;
    const listener = args[1];
    // Accept functions and EventListener objects ({ handleEvent }); per spec
    // the `handleEvent` lookup is deferred to invoke time, so any object is
    // permitted here. Only null/undefined/primitives are ignored.
    if (listener.isUndefinedOrNull() or !(listener.isCallable() or listener.isObject()))
        return .js_undefined;

    // Flatten options: boolean is `capture` (no effect without a tree), or
    // a dictionary with `once`. Other keys (`signal`, `passive`, `capture`)
    // are not yet supported here.
    var once = false;
    if (args.len > 2 and args[2].isObject()) {
        if (try args[2].getBooleanLoose(global, "once")) |o| once = o;
    }

    const this_js = callframe.this();
    const type_str = try args[0].toBunString(global);
    defer type_str.deref();

    const listeners = ensureListeners(this_js, global);
    var arr = try listeners.getOwn(global, type_str) orelse JSValue.zero;
    if (arr == .zero or !arr.jsType().isArray()) {
        arr = try JSValue.createEmptyArray(global, 0);
        try listeners.putMayBeIndex(global, &type_str, arr);
    }
    // Dedupe on callback identity (spec: same type + callback + capture).
    const len = try arr.getLength(global);
    var i: u32 = 0;
    while (i < len) : (i += 1) {
        const entry = try arr.getIndex(global, i);
        if (!entry.isObject()) continue;
        const cb = try entry.getOwn(global, "cb") orelse continue;
        if (cb == listener) return .js_undefined;
    }
    const entry = JSValue.createEmptyObject(global, 2);
    entry.put(global, bun.String.static("cb"), listener);
    entry.put(global, bun.String.static("once"), JSValue.jsBoolean(once));
    try arr.push(global, entry);
    return .js_undefined;
}

pub fn removeEventListener(_: *EventSource, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.arguments();
    if (args.len < 2) return .js_undefined;
    const listener = args[1];
    const this_js = callframe.this();
    const listeners = js.listenersGetCached(this_js) orelse return .js_undefined;
    if (!listeners.isObject()) return .js_undefined;

    const type_str = try args[0].toBunString(global);
    defer type_str.deref();
    const arr = try listeners.getOwn(global, type_str) orelse return .js_undefined;
    if (!arr.jsType().isArray()) return .js_undefined;

    const len = try arr.getLength(global);
    const new_arr = try JSValue.createEmptyArray(global, 0);
    var i: u32 = 0;
    while (i < len) : (i += 1) {
        const entry = try arr.getIndex(global, i);
        if (entry.isObject()) {
            const cb = try entry.getOwn(global, "cb") orelse .js_undefined;
            if (cb == listener) continue;
        }
        try new_arr.push(global, entry);
    }
    try listeners.putMayBeIndex(global, &type_str, new_arr);
    return .js_undefined;
}

pub fn dispatchEvent(this: *EventSource, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const args = callframe.arguments();
    if (args.len < 1 or !args[0].isObject()) {
        return global.throwInvalidArguments("dispatchEvent requires an Event", .{});
    }
    const event = args[0];
    const type_val = try event.getTruthy(global, "type") orelse return .true;
    const type_str = try type_val.toBunString(global);
    defer type_str.deref();
    const type_utf8 = type_str.toUTF8(bun.default_allocator);
    defer type_utf8.deinit();

    // This is a JS-callable prototype method, so we're already inside a JS
    // frame — no event_loop.enter()/exit() here (that pair is for native→JS
    // entry points like onProgressUpdate).
    this.dispatchToHandlers(type_utf8.slice(), event);

    // Per spec: return false if the event is cancelable and preventDefault()
    // was called (i.e. defaultPrevented is true); true otherwise.
    const default_prevented = blk: {
        const dp = (event.getTruthy(global, "defaultPrevented") catch break :blk false) orelse break :blk false;
        break :blk dp.toBoolean();
    };
    return JSValue.jsBoolean(!default_prevented);
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

const std = @import("std");

const bun = @import("bun");
const MutableString = bun.MutableString;
const Output = bun.Output;
const ZigURL = bun.URL;
const http = bun.http;
const strings = bun.strings;
const FetchHeaders = bun.webcore.FetchHeaders;
const EventLoopTimer = bun.api.Timer.EventLoopTimer;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
