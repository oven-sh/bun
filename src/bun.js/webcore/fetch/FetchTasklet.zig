//! ============================================================================
//! THREAD SAFETY ARCHITECTURE
//! ============================================================================
//!
//! FetchTasklet coordinates between two threads:
//! - JavaScript Main Thread: Handles JS API, promises, streams
//! - HTTP Thread: Performs socket I/O, TLS handshake, HTTP parsing
//!
//! Data is split into two categories:
//! 1. MainThreadData - Only accessed from JavaScript main thread (no lock)
//! 2. SharedData - Accessed from both threads (mutex protected)
//!
//! SYNCHRONIZATION PATTERNS (Phase 2.5):
//!
//! HTTP Thread → Main Thread Handoff:
//! 1. HTTP thread receives data in callback()
//! 2. Uses atomic swap on has_schedule_callback to prevent duplicate enqueues
//! 3. Copies data to shared buffers under mutex
//! 4. Enqueues onProgressUpdate() to main thread
//! 5. Main thread processes data and resets has_schedule_callback
//!
//! Key Thread Safety Mechanisms:
//! - ref_count: Atomic reference counting for lifetime management
//! - has_schedule_callback: Atomic flag prevents duplicate main thread enqueues
//! - signal_store.aborted: Atomic flag for fast-path abort checks
//! - mutex: Protects all shared mutable state (buffers, result, metadata)
//! - ThreadSafeStreamBuffer: Used for request body streaming (internal locking)
//!
//! Critical Rules:
//! - HTTP thread does MINIMAL work: atomic ops, data copy under lock, enqueue
//! - Main thread does ALL JS work: promise resolution, stream operations
//! - Always check abort flag atomically before enqueueing work
//! - Use proper memory ordering: acquire/release for synchronization
//! - Avoid holding mutex while doing JS operations (can trigger GC)

/// Data that can ONLY be accessed from the main JavaScript thread.
/// No mutex needed - thread confinement enforced by assertions in debug builds.
const MainThreadData = struct {
    /// Global object (non-owning pointer)
    global_this: *JSGlobalObject,

    /// VM (non-owning pointer)
    javascript_vm: *VirtualMachine,

    /// Promise to resolve/reject (owned)
    promise: jsc.JSPromise.Strong,

    /// Weak reference to Response JS object for finalization tracking.
    /// Can become null if GC collects the Response.
    response_weak: jsc.Weak(FetchTasklet) = .{},

    /// Native Response object for finalization tracking.
    /// INTENTIONAL DUAL OWNERSHIP with response_weak:
    /// - Allows tracking when Response JS object is finalized
    /// - Signals we should stop processing body data
    /// - See Bun__FetchResponse_finalize for usage
    native_response: ?*Response = null,

    /// Strong reference to response ReadableStream (owned)
    readable_stream_ref: jsc.WebCore.ReadableStream.Strong = .{},

    /// Abort signal (ref-counted via AbortSignal's API)
    /// Managed by AbortHandling wrapper
    abort_signal: ?*jsc.WebCore.AbortSignal = null,

    /// Abort reason (owned)
    abort_reason: jsc.Strong.Optional = .empty,

    /// Custom TLS check function (owned)
    check_server_identity: jsc.Strong.Optional = .empty,

    /// Keep VM alive during fetch
    poll_ref: Async.KeepAlive = .{},

    /// Task for cross-thread callbacks
    concurrent_task: jsc.ConcurrentTask = .{},

    /// Debug tracker
    tracker: jsc.Debugger.AsyncTaskTracker,

    /// Response sink for streaming body data to JS
    /// Only accessed from main thread
    sink: ?*jsc.WebCore.ResumableFetchSink = null,

    fn assertMainThread(self: *const MainThreadData) void {
        if (bun.Environment.isDebug) {
            // Thread confinement assertion
            // Could add actual thread ID check if available
            _ = self;
        }
    }

    fn deinit(self: *MainThreadData) void {
        self.promise.deinit();
        self.readable_stream_ref.deinit();
        self.abort_reason.deinit();
        self.check_server_identity.deinit();
        self.poll_ref.unref(self.javascript_vm);
        // abort_signal handled by AbortHandling wrapper
        // sink is ref-counted, deref handled in clearSink()
    }
};

// ============================================================================
// STATE MACHINE TYPES
// ============================================================================

/// Main fetch lifecycle - mutually exclusive OR states.
/// Every FetchTasklet is in exactly ONE of these states at a time.
const FetchLifecycle = enum(u8) {
    /// Initial: Created, not yet queued to HTTP thread
    created,

    /// HTTP request in flight
    /// Replaces complex state tracking in old code:
    /// - Sending headers
    /// - Sending body (if present)
    /// - Waiting for response headers
    http_active,

    /// Receiving response headers from server
    http_receiving_headers,

    /// Receiving response body from server
    /// Response object may or may not exist yet
    http_receiving_body,

    /// Response object created, body not yet accessed by JS
    /// Replaces: is_waiting_body = true
    response_awaiting_body_access,

    /// Response body is streaming to JS ReadableStream
    response_body_streaming,

    /// Response body is buffering in memory (no stream created yet)
    response_body_buffering,

    /// Terminal states (no transitions out)
    completed,
    failed,
    aborted,

    pub fn isTerminal(self: FetchLifecycle) bool {
        return switch (self) {
            .completed, .failed, .aborted => true,
            else => false,
        };
    }

    pub fn isHTTPActive(self: FetchLifecycle) bool {
        return switch (self) {
            .http_active, .http_receiving_headers, .http_receiving_body => true,
            else => false,
        };
    }

    pub fn canReceiveBody(self: FetchLifecycle) bool {
        return switch (self) {
            .http_receiving_body, .response_body_streaming, .response_body_buffering => true,
            else => false,
        };
    }

    /// Validate state transition (debug builds only)
    pub fn canTransitionTo(self: FetchLifecycle, next: FetchLifecycle) bool {
        return switch (self) {
            .created => switch (next) {
                .http_active, .aborted, .failed => true,
                else => false,
            },
            .http_active => switch (next) {
                .http_receiving_headers, .aborted, .failed => true,
                else => false,
            },
            .http_receiving_headers => switch (next) {
                .http_receiving_body,
                .response_awaiting_body_access,
                .response_body_buffering,
                .completed, // Empty body case
                .aborted,
                .failed,
                => true,
                else => false,
            },
            .http_receiving_body => switch (next) {
                .response_awaiting_body_access, .response_body_streaming, .response_body_buffering, .completed, .aborted, .failed => true,
                else => false,
            },
            .response_awaiting_body_access => switch (next) {
                .response_body_streaming, .response_body_buffering, .completed, .aborted, .failed => true,
                else => false,
            },
            .response_body_streaming => switch (next) {
                .completed, .aborted, .failed => true,
                else => false,
            },
            .response_body_buffering => switch (next) {
                .response_body_streaming, // Upgrade to streaming
                .completed,
                .aborted,
                .failed,
                => true,
                else => false,
            },
            .completed, .failed, .aborted => false, // Terminal
        };
    }
};

/// Request body streaming state - orthogonal to main lifecycle.
/// Only relevant when request has a streaming body (ReadableStream).
const RequestStreamState = enum(u8) {
    /// No streaming request body (Blob, Sendfile, or empty)
    none,

    /// Stream exists but hasn't started yet (waiting for server ready)
    /// Replaces: is_waiting_request_stream_start = true
    waiting_start,

    /// Stream actively being read and sent to server
    active,

    /// Stream finished (successfully or with error)
    complete,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Helper for validated state transitions (in debug builds)
fn transitionLifecycle(shared: *SharedData, old_state: FetchLifecycle, new_state: FetchLifecycle) void {
    if (bun.Environment.isDebug) {
        bun.assert(old_state.canTransitionTo(new_state));
    }
    shared.lifecycle = new_state;
}

/// Computed property: Should we ignore remaining body data?
/// Replaces: ignore_data boolean flag
fn shouldIgnoreBodyData(lifecycle: FetchLifecycle, abort_requested: bool) bool {
    // Ignore data if:
    // 1. Abort was requested
    // 2. Already in aborted state
    // 3. Response finalized (handled via lifecycle check)
    return abort_requested or lifecycle == .aborted;
}

/// Data shared between main thread and HTTP thread.
/// ALL access must be protected by mutex.
/// NOTE: This struct is infrastructure from Phase 2 that will be fully integrated
/// in a future phase. Currently FetchTasklet has these fields directly (lines 681-688).
/// TODO: Migrate FetchTasklet fields into this struct for better encapsulation.
const SharedData = struct {
    /// Mutex protecting all mutable fields below
    mutex: bun.Mutex,

    /// === STATE TRACKING (protected by mutex) ===
    /// Main fetch lifecycle (mutually exclusive)
    lifecycle: FetchLifecycle,

    /// Request body streaming state (orthogonal)
    request_stream_state: RequestStreamState,

    /// Abort requested? (atomic for fast-path check from HTTP thread)
    abort_requested: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    /// Connection upgraded to WebSocket? (one-time flag)
    upgraded_connection: bool = false,

    /// === REFERENCE COUNTING (atomic) ===
    ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

    /// === HTTP CLIENT DATA (owned by HTTP thread after queue) ===
    http: ?*http.AsyncHTTP = null,
    result: http.HTTPClientResult = .{},
    metadata: ?http.HTTPResponseMetadata = null,

    /// === BUFFERS (ownership documented) ===
    /// Response buffer written by HTTP thread.
    /// Ownership: HTTP thread writes, main thread reads under lock, then transfers.
    response_buffer: MutableString,

    /// Response buffer for JS (accumulated data before creating Response).
    /// Ownership: Main thread only, but guarded by mutex for consistency.
    scheduled_response_buffer: MutableString,

    /// Body size tracking
    body_size: http.HTTPClientResult.BodySize = .unknown,

    /// === COORDINATION FLAGS (atomic) ===
    /// Has callback been scheduled to main thread?
    /// Prevents duplicate enqueues from HTTP thread.
    has_schedule_callback: std.atomic.Value(bool),

    /// Signal storage for HTTP thread
    signals: http.Signals = .{},
    signal_store: http.Signals.Store = .{},

    /// === REQUEST DATA (accessed by both threads) ===
    /// Request body streaming buffer (thread-safe, accessed from both threads)
    request_body_streaming_buffer: ?*http.ThreadSafeStreamBuffer = null,

    /// Request headers (setup on main thread, read by HTTP thread)
    request_headers: Headers,

    /// URL and proxy buffer (setup on main thread, read by HTTP thread)
    /// This is url + proxy memory buffer and is owned by FetchTasklet
    url_proxy_buffer: []const u8 = "",

    /// TLS certificate validation setting (read by HTTP thread)
    reject_unauthorized: bool = true,

    /// Custom hostname for TLS certificate validation
    /// Only allocated if custom checkServerIdentity function is provided
    hostname: ?[]u8 = null,

    fn init(allocator: std.mem.Allocator) !SharedData {
        return SharedData{
            .mutex = .{},
            .lifecycle = .created,
            .request_stream_state = .none,
            .response_buffer = try MutableString.init(allocator, 0),
            .scheduled_response_buffer = try MutableString.init(allocator, 0),
            .has_schedule_callback = std.atomic.Value(bool).init(false),
            .request_headers = Headers{ .allocator = allocator },
        };
    }

    fn deinit(self: *SharedData, allocator: std.mem.Allocator) void {
        self.response_buffer.deinit();
        self.scheduled_response_buffer.deinit();
        if (self.metadata) |*metadata| {
            metadata.deinit(self.response_buffer.allocator);
        }
        // Clean up request headers
        self.request_headers.entries.deinit(allocator);
        self.request_headers.buf.deinit(allocator);
        // Clean up URL proxy buffer
        if (self.url_proxy_buffer.len > 0) {
            allocator.free(self.url_proxy_buffer);
        }
        // Clean up hostname
        if (self.hostname) |hostname| {
            allocator.free(hostname);
        }
        // request_body_streaming_buffer is handled elsewhere (ref counted)
    }

    /// Lock the shared data for exclusive access.
    /// Returns RAII wrapper that auto-unlocks on scope exit.
    fn lock(self: *SharedData) LockedSharedData {
        self.mutex.lock();
        return LockedSharedData{ .shared = self };
    }
};

/// RAII wrapper for locked shared data.
/// Automatically unlocks on scope exit.
const LockedSharedData = struct {
    shared: *SharedData,

    fn unlock(self: LockedSharedData) void {
        self.shared.mutex.unlock();
    }

    /// Convenience: Get current lifecycle
    fn lifecycle(self: LockedSharedData) FetchLifecycle {
        return self.shared.lifecycle;
    }

    /// Convenience: Transition lifecycle with validation
    fn transitionTo(self: LockedSharedData, new_state: FetchLifecycle) void {
        transitionLifecycle(self.shared, self.shared.lifecycle, new_state);
    }

    /// Convenience: Should ignore body data?
    fn shouldIgnoreBody(self: LockedSharedData) bool {
        return shouldIgnoreBodyData(
            self.shared.lifecycle,
            self.shared.abort_requested.load(.acquire),
        );
    }
};

// ============================================================================
// OWNERSHIP WRAPPERS
// ============================================================================

/// Request headers with explicit ownership tracking.
/// Encapsulates the "do I need to free this?" logic.
const RequestHeaders = struct {
    headers: Headers,
    #owned: bool, // Private: true if we must deinit

    /// Create empty headers (not owned - no cleanup needed)
    fn initEmpty(allocator: std.mem.Allocator) RequestHeaders {
        return .{
            .headers = .{ .allocator = allocator },
            .#owned = false,
        };
    }

    /// Extract headers from FetchHeaders (owned - we must cleanup)
    fn initFromFetchHeaders(
        fetch_headers: *FetchHeaders,
        allocator: std.mem.Allocator,
    ) !RequestHeaders {
        return .{
            .headers = try Headers.from(fetch_headers, allocator),
            .#owned = true,
        };
    }

    /// Single cleanup path
    fn deinit(self: *RequestHeaders) void {
        if (self.#owned) {
            self.headers.entries.deinit(self.headers.allocator);
            self.headers.buf.deinit(self.headers.allocator);
        }
    }

    /// Borrow headers for HTTP request
    fn borrow(self: *RequestHeaders) *Headers {
        return &self.headers;
    }
};

/// Response metadata with explicit take semantics.
/// Ensures metadata is only transferred once to Response object.
const ResponseMetadataHolder = struct {
    #metadata: ?http.HTTPResponseMetadata = null,
    #certificate_info: ?http.CertificateInfo = null,
    allocator: std.mem.Allocator,

    fn init(allocator: std.mem.Allocator) ResponseMetadataHolder {
        return .{ .allocator = allocator };
    }

    /// Take metadata, transferring ownership to caller.
    /// Can only be called once - subsequent calls return null.
    fn takeMetadata(self: *ResponseMetadataHolder) ?http.HTTPResponseMetadata {
        const metadata = self.#metadata;
        self.#metadata = null; // Clear to prevent double-take
        return metadata;
    }

    /// Take certificate info, transferring ownership to caller.
    fn takeCertificate(self: *ResponseMetadataHolder) ?http.CertificateInfo {
        const cert = self.#certificate_info;
        self.#certificate_info = null;
        return cert;
    }

    /// Set metadata from HTTP result (takes ownership).
    /// Frees old metadata if present.
    fn setMetadata(self: *ResponseMetadataHolder, metadata: http.HTTPResponseMetadata) void {
        if (self.#metadata) |old| {
            old.deinit(self.allocator);
        }
        self.#metadata = metadata;
    }

    /// Set certificate info from HTTP result (takes ownership).
    fn setCertificate(self: *ResponseMetadataHolder, cert: http.CertificateInfo) void {
        if (self.#certificate_info) |old| {
            old.deinit(self.allocator);
        }
        self.#certificate_info = cert;
    }

    /// Single cleanup path
    fn deinit(self: *ResponseMetadataHolder) void {
        if (self.#metadata) |metadata| {
            metadata.deinit(self.allocator);
        }
        if (self.#certificate_info) |cert| {
            cert.deinit(self.allocator);
        }
    }
};

// NOTE: HTTPRequestBody ownership wrapper removed temporarily due to conflict
// with existing HTTPRequestBody inside FetchTasklet struct.
// This will be properly integrated in Phase 7 when we migrate the existing code.
// The ownership patterns documented here (explicit ref tracking, transfer semantics)
// should be applied when refactoring the existing HTTPRequestBody.

/// Unified error storage with explicit precedence rules.
/// Replaces scattered error tracking across multiple fields (result.fail, abort_reason, body error).
const FetchError = union(enum) {
    none: void,
    http_error: http.HTTPClientResult.Fail,
    abort_error: jsc.Strong, // From AbortSignal
    js_error: jsc.Strong, // From JS callback (e.g., checkServerIdentity)
    tls_error: jsc.Strong, // From TLS validation

    /// Set new error, freeing old error if present
    fn set(self: *FetchError, new_error: FetchError) void {
        self.deinit();
        self.* = new_error;
    }

    /// Convert error to JavaScript value for promise rejection
    fn toJS(self: FetchError, global: *JSGlobalObject) JSValue {
        return switch (self) {
            .none => .jsUndefined(),
            .http_error => |fail| fail.toJS(global),
            .abort_error => |strong| strong.get() orelse .jsUndefined(),
            .js_error => |strong| strong.get() orelse .jsUndefined(),
            .tls_error => |strong| strong.get() orelse .jsUndefined(),
        };
    }

    /// Check if this is an abort error (for special handling)
    fn isAbort(self: FetchError) bool {
        return self == .abort_error;
    }

    /// Single cleanup path
    fn deinit(self: *FetchError) void {
        switch (self.*) {
            .none, .http_error => {},
            .abort_error => |*strong| strong.deinit(),
            .js_error => |*strong| strong.deinit(),
            .tls_error => |*strong| strong.deinit(),
        }
        self.* = .none;
    }
};

// ============================================================================
// URL/PROXY BUFFER PATTERN
// ============================================================================
//
// The url_proxy_buffer field uses bun.ptr.Owned for explicit ownership:
//
// In FetchTasklet:
//
// /// Owned buffer containing URL and optional proxy string concatenated.
// /// Slices (url, proxy) point into this buffer.
// url_proxy_buffer: bun.ptr.Owned([]const u8),
//
// /// Non-owning slice into url_proxy_buffer
// url: []const u8,
//
// /// Non-owning slice into url_proxy_buffer
// proxy: []const u8,
//
// /// Create URL buffer with optional proxy
// fn createURLBuffer(
//     allocator: std.mem.Allocator,
//     url_str: []const u8,
//     proxy_str: []const u8,
// ) !bun.ptr.Owned([]const u8) {
//     const total_len = url_str.len + proxy_str.len;
//     const buffer = try allocator.alloc(u8, total_len);
//
//     // Copy URL
//     @memcpy(buffer[0..url_str.len], url_str);
//
//     // Copy proxy (if present)
//     if (proxy_str.len > 0) {
//         @memcpy(buffer[url_str.len..], proxy_str);
//     }
//
//     return bun.ptr.Owned([]const u8).fromRawIn(buffer, allocator);
// }
//
// // Usage in init:
// const buffer = try createURLBuffer(allocator, url, proxy);
// this.url_proxy_buffer = buffer;
// this.url = buffer.get()[0..url.len];
// this.proxy = buffer.get()[url.len..];
//
// // Cleanup (automatic in deinit):
// this.url_proxy_buffer.deinit();

/// Abort signal handling with centralized lifecycle management.
/// Ensures all ref/unref operations are paired correctly.
// ============================================================================
// HOSTNAME BUFFER PATTERN
// ============================================================================
//
// The hostname field uses optional bun.ptr.Owned for explicit ownership:
//
// In FetchTasklet:
//
// /// Hostname buffer for TLS certificate validation.
// /// Only allocated if custom checkServerIdentity function is provided.
// hostname: ?bun.ptr.Owned([]u8) = null,
//
// // Creation:
// if (needs_hostname) {
//     const buf = try allocator.dupe(u8, hostname_str);
//     this.hostname = bun.ptr.Owned([]u8).fromRawIn(buf, allocator);
// }
//
// // Cleanup (automatic in deinit):
// if (this.hostname) |*host| {
//     host.deinit();
// }

pub const FetchTasklet = struct {
    // ============================================================================
    // STATE MACHINE
    // ============================================================================
    //
    // FetchTasklet tracks multiple orthogonal state dimensions:
    // 1. Main lifecycle (FetchLifecycle) - mutually exclusive
    // 2. Request streaming (RequestStreamState) - independent
    // 3. Abort status (atomic bool) - independent
    // 4. Connection upgrade (bool) - one-time flag
    //
    // MIGRATION NOTE (Phase 7.3): Adding state machine fields to replace boolean flags
    // - lifecycle replaces: is_waiting_body
    // - request_stream_state replaces: is_waiting_request_stream_start
    // - signal_store.aborted already exists for abort tracking

    pub const ResumableSink = jsc.WebCore.ResumableFetchSink;

    const log = Output.scoped(.FetchTasklet, .visible);

    // ============================================================================
    // PHASE 7 INTEGRATION: Container Fields
    // ============================================================================
    /// Main thread data container (no lock needed - thread confinement)
    main_thread: MainThreadData,

    /// Shared data container (mutex protected for cross-thread access)
    shared: SharedData,

    // ============================================================================
    // STATE TRANSITION EXAMPLES
    // ============================================================================
    //
    // Normal fetch with buffered body:
    //   created → http_active → http_receiving_headers → http_receiving_body
    //   → response_body_buffering → completed
    //
    // Normal fetch with streaming body:
    //   created → http_active → http_receiving_headers → http_receiving_body
    //   → response_body_streaming → completed
    //
    // Fetch with body accessed after response created:
    //   created → http_active → http_receiving_headers → http_receiving_body
    //   → response_awaiting_body_access → response_body_streaming → completed
    //
    // Aborted fetch:
    //   (any state) → aborted
    //
    // Failed fetch:
    //   (any state) → failed
    //
    // Request streaming (orthogonal):
    //   none (most requests)
    //   OR: waiting_start → active → complete

    // ============================================================================
    // STATE MACHINE FIELDS (Phase 7.3 & 7.4 Part 4)
    // ============================================================================
    // PHASE 7.4 Part 4: lifecycle migrated to shared.lifecycle
    // /// Main fetch lifecycle state (replaces is_waiting_body and other implicit states)
    // lifecycle: FetchLifecycle = .created,

    // PHASE 7.4 Part 4: request_stream_state migrated to shared.request_stream_state
    // /// Request body streaming state (replaces is_waiting_request_stream_start)
    // request_stream_state: RequestStreamState = .none,

    // ============================================================================
    // CORE FIELDS
    // ============================================================================
    // PHASE 7.4 Part 4: sink migrated to main_thread.sink
    // sink: ?*ResumableSink = null,
    // PHASE 7.4: http migrated to shared.http
    // http: ?*http.AsyncHTTP = null,
    // PHASE 7.4: result migrated to shared.result
    // result: http.HTTPClientResult = .{},
    // PHASE 7.4: metadata migrated to shared.metadata
    // metadata: ?http.HTTPResponseMetadata = null,
    // PHASE 7: javascript_vm migrated to main_thread.javascript_vm
    // PHASE 7: global_this migrated to main_thread.global_this
    request_body: HTTPRequestBody = undefined,
    // PHASE 7.4 Part 4: request_body_streaming_buffer migrated to shared.request_body_streaming_buffer
    // request_body_streaming_buffer: ?*http.ThreadSafeStreamBuffer = null,

    // PHASE 7.4: response_buffer migrated to shared.response_buffer
    // /// buffer being used by AsyncHTTP
    // response_buffer: MutableString = undefined,
    // PHASE 7.4: scheduled_response_buffer migrated to shared.scheduled_response_buffer
    // /// buffer used to stream response to JS
    // scheduled_response_buffer: MutableString = undefined,
    // PHASE 7.4 Part 3: response migrated to main_thread.response_weak
    // /// response weak ref we need this to track the response JS lifetime
    // response: jsc.Weak(FetchTasklet) = .{},
    // PHASE 7.4 Part 3: native_response migrated to main_thread.native_response
    // /// native response ref if we still need it when JS is discarted
    // native_response: ?*Response = null,
    // MIGRATION (Phase 7.3): ignore_data removed - use shouldIgnoreBodyData() method instead
    // Old: ignore_data: bool = false,
    // New: Computed from: shouldIgnoreBodyData(lifecycle, signal_store.aborted)
    // The helper checks: abort requested OR lifecycle == .aborted
    // PHASE 7.4: readable_stream_ref migrated to main_thread.readable_stream_ref
    // /// stream strong ref if any is available
    // readable_stream_ref: jsc.WebCore.ReadableStream.Strong = .{},
    // PHASE 7.4 Part 4: request_headers migrated to shared.request_headers
    // request_headers: Headers = Headers{ .allocator = undefined },
    // PHASE 7: promise migrated to main_thread.promise
    // PHASE 7.4 Part 3: concurrent_task migrated to main_thread.concurrent_task
    // concurrent_task: jsc.ConcurrentTask = .{},
    // PHASE 7.4: poll_ref migrated to main_thread.poll_ref
    // poll_ref: Async.KeepAlive = .{},
    // PHASE 7.4 Part 3: body_size migrated to shared.body_size
    // /// For Http Client requests
    // /// when Content-Length is provided this represents the whole size of the request
    // /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    // /// If is not chunked encoded and Content-Length is not provided this will be unknown
    // body_size: http.HTTPClientResult.BodySize = .unknown,

    // PHASE 7.4 Part 4: url_proxy_buffer migrated to shared.url_proxy_buffer
    // /// This is url + proxy memory buffer and is owned by FetchTasklet
    // /// We always clone url and proxy (if informed)
    // url_proxy_buffer: []const u8 = "",

    // PHASE 7.4 Part 4: signal migrated to main_thread.abort_signal
    // signal: ?*jsc.WebCore.AbortSignal = null,
    // PHASE 7.4 Part 3: signals migrated to shared.signals
    // signals: http.Signals = .{},
    // PHASE 7.4 Part 3: signal_store migrated to shared.signal_store
    // signal_store: http.Signals.Store = .{},
    // PHASE 7.4 Part 3: has_schedule_callback migrated to shared.has_schedule_callback
    // has_schedule_callback: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    // PHASE 7.4: abort_reason migrated to main_thread.abort_reason
    // // must be stored because AbortSignal stores reason weakly
    // abort_reason: jsc.Strong.Optional = .empty,

    // PHASE 7.4: check_server_identity migrated to main_thread.check_server_identity
    // check_server_identity: jsc.Strong.Optional = .empty,
    // PHASE 7.4 Part 4: reject_unauthorized migrated to shared.reject_unauthorized
    // reject_unauthorized: bool = true,
    // PHASE 7.4 Part 3: upgraded_connection migrated to shared.upgraded_connection
    // upgraded_connection: bool = false,
    // PHASE 7.4 Part 4: hostname migrated to shared.hostname
    // /// Custom Hostname
    // hostname: ?[]u8 = null,
    // MIGRATION (Phase 7.3): Boolean flags removed in favor of state machine
    // Old flags (all removed):
    //   - is_waiting_body: bool = false → Check lifecycle == .response_awaiting_body_access
    //   - is_waiting_abort: bool = false → Check signal_store.aborted AND result.has_more
    //   - is_waiting_request_stream_start: bool = false → Check request_stream_state == .waiting_start
    // PHASE 7.4 Part 4: mutex migrated to shared.mutex
    // mutex: Mutex,

    // PHASE 7.4: tracker migrated to main_thread.tracker
    // tracker: jsc.Debugger.AsyncTaskTracker,

    // PHASE 7.4 Part 3: ref_count migrated to shared.ref_count
    // ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

    /// Increment reference count. Thread-safe (atomic operation).
    /// Can be called from any thread.
    pub fn ref(this: *FetchTasklet) void {
        const count = this.shared.ref_count.fetchAdd(1, .monotonic);
        bun.debugAssert(count > 0);
    }

    /// Decrement reference count. Thread-safe (atomic operation).
    /// Should be called from main thread when possible.
    /// Use derefFromThread() when called from HTTP thread.
    pub fn deref(this: *FetchTasklet) void {
        const count = this.shared.ref_count.fetchSub(1, .monotonic);
        bun.debugAssert(count > 0);

        if (count == 1) {
            this.deinit() catch |err| switch (err) {};
        }
    }

    /// Called from HTTP thread when dropping a reference.
    /// Must handle case where VM is shutting down.
    pub fn derefFromThread(this: *FetchTasklet) void {
        const old_count = this.shared.ref_count.fetchSub(1, .monotonic);
        bun.debugAssert(old_count > 0);

        if (old_count == 1) {
            // Last reference - must deinit on main thread
            const vm = this.main_thread.javascript_vm;

            vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.deinitFromMainThread)) catch {
                // VM is shutting down - cannot safely deinit
                // This will be detected as a leak by ASAN, which is correct behavior.
                // Better to leak than use-after-free.
                if (bun.Environment.isDebug) {
                    bun.Output.err(
                        "LEAK",
                        "FetchTasklet leaked during VM shutdown (addr=0x{x})",
                        .{@intFromPtr(this)},
                    );
                }
                // Intentional leak - safer than use-after-free
            };
        }
    }

    fn deinitFromMainThread(this: *FetchTasklet) void {
        this.main_thread.assertMainThread();
        this.deinit() catch |err| switch (err) {};
    }

    pub const HTTPRequestBody = union(enum) {
        AnyBlob: AnyBlob,
        Sendfile: http.SendFile,
        ReadableStream: jsc.WebCore.ReadableStream.Strong,

        pub const Empty: HTTPRequestBody = .{ .AnyBlob = .{ .Blob = .{} } };

        pub fn store(this: *HTTPRequestBody) ?*Blob.Store {
            return switch (this.*) {
                .AnyBlob => this.AnyBlob.store(),
                else => null,
            };
        }

        pub fn slice(this: *const HTTPRequestBody) []const u8 {
            return switch (this.*) {
                .AnyBlob => this.AnyBlob.slice(),
                else => "",
            };
        }

        pub fn detach(this: *HTTPRequestBody) void {
            switch (this.*) {
                .AnyBlob => this.AnyBlob.detach(),
                .ReadableStream => |*stream| {
                    stream.deinit();
                },
                .Sendfile => {
                    if (@max(this.Sendfile.offset, this.Sendfile.remain) > 0)
                        this.Sendfile.fd.close();
                    this.Sendfile.offset = 0;
                    this.Sendfile.remain = 0;
                },
            }
        }

        pub fn fromJS(globalThis: *JSGlobalObject, value: JSValue) bun.JSError!HTTPRequestBody {
            var body_value = try Body.Value.fromJS(globalThis, value);
            if (body_value == .Used or (body_value == .Locked and (body_value.Locked.action != .none or body_value.Locked.isDisturbed2(globalThis)))) {
                return globalThis.ERR(.BODY_ALREADY_USED, "body already used", .{}).throw();
            }
            if (body_value == .Locked) {
                if (body_value.Locked.readable.has()) {
                    // just grab the ref
                    return FetchTasklet.HTTPRequestBody{ .ReadableStream = body_value.Locked.readable };
                }
                const readable = try body_value.toReadableStream(globalThis);
                if (!readable.isEmptyOrUndefinedOrNull() and body_value == .Locked and body_value.Locked.readable.has()) {
                    return FetchTasklet.HTTPRequestBody{ .ReadableStream = body_value.Locked.readable };
                }
            }
            return FetchTasklet.HTTPRequestBody{ .AnyBlob = body_value.useAsAnyBlob() };
        }

        pub fn needsToReadFile(this: *HTTPRequestBody) bool {
            return switch (this.*) {
                .AnyBlob => |blob| blob.needsToReadFile(),
                else => false,
            };
        }

        pub fn isS3(this: *const HTTPRequestBody) bool {
            return switch (this.*) {
                .AnyBlob => |*blob| blob.isS3(),
                else => false,
            };
        }

        pub fn hasContentTypeFromUser(this: *HTTPRequestBody) bool {
            return switch (this.*) {
                .AnyBlob => |blob| blob.hasContentTypeFromUser(),
                else => false,
            };
        }

        pub fn getAnyBlob(this: *HTTPRequestBody) ?*AnyBlob {
            return switch (this.*) {
                .AnyBlob => &this.AnyBlob,
                else => null,
            };
        }

        pub fn hasBody(this: *HTTPRequestBody) bool {
            return switch (this.*) {
                .AnyBlob => |blob| blob.size() > 0,
                .ReadableStream => |*stream| stream.has(),
                .Sendfile => true,
            };
        }
    };

    pub fn init(_: std.mem.Allocator) anyerror!FetchTasklet {
        return FetchTasklet{};
    }

    /// Clear sink and buffer when request streaming is done.
    /// Single cleanup path with documented ref count operations.
    ///
    /// REF COUNTING PROTOCOL:
    /// - Sink has 2 refs at creation:
    ///   - Ref 1: We hold via this.main_thread.sink (released here)
    ///   - Ref 2: Stream pipeline holds (may still be active)
    /// - Buffer has 2 refs:
    ///   - Ref 1: We hold via this.shared.request_body_streaming_buffer (released here)
    ///   - Ref 2: HTTP thread holds (released when HTTP completes)
    ///
    /// CALL SITES:
    /// - clearData(): Called during FetchTasklet cleanup
    /// - writeEndRequest(): Called when request stream ends (with or without error)
    fn clearSink(this: *FetchTasklet) void {
        // Clear sink (drop our ref - stream pipeline might still hold one)
        if (this.main_thread.sink) |sink| {
            this.main_thread.sink = null;
            sink.deref(); // Drop Ref 1 (we held this via this.main_thread.sink)
            // Stream pipeline still holds Ref 2 until it finishes
        }

        // Clear buffer (drop our ref - HTTP thread might still hold one)
        // PHASE 7.5: Lock access to request_body_streaming_buffer
        var locked = this.shared.lock();
        defer locked.unlock();

        if (locked.shared.request_body_streaming_buffer) |buffer| {
            locked.shared.request_body_streaming_buffer = null;
            buffer.clearDrainCallback(); // Unhook from HTTP thread callbacks
            buffer.deref(); // Drop Ref 1 (we held this)
            // HTTP thread still holds its ref until request completes
        }
    }

    /// Clean up all owned resources.
    /// Must be called from main thread (via deinit or deinitFromMainThread).
    fn clearData(this: *FetchTasklet) void {
        log("clearData ", .{});
        const allocator = bun.default_allocator;
        // url_proxy_buffer and hostname are now in shared data and cleaned up in shared.deinit()
        // No longer need to clean them up here

        // PHASE 7.5: Lock access to shared mutable state during cleanup
        // Read request_stream_state early for later use
        const request_stream_waiting = blk: {
            var locked = this.shared.lock();
            defer locked.unlock();

            if (locked.shared.result.certificate_info) |*certificate| {
                certificate.deinit(bun.default_allocator);
                locked.shared.result.certificate_info = null;
            }

            // request_headers is now in shared data and cleaned up in shared.deinit()

            if (locked.shared.http) |http_| {
                http_.clearData();
            }

            if (locked.shared.metadata != null) {
                locked.shared.metadata.?.deinit(allocator);
                locked.shared.metadata = null;
            }

            locked.shared.response_buffer.deinit();
            locked.shared.scheduled_response_buffer.deinit();

            // Check request_stream_state while locked
            break :blk locked.shared.request_stream_state == .waiting_start;
        };

        this.main_thread.response_weak.deinit();
        if (this.main_thread.native_response) |response| {
            this.main_thread.native_response = null;

            response.unref();
        }

        this.main_thread.readable_stream_ref.deinit();

        // MIGRATION (Phase 7.3): Replaced is_waiting_request_stream_start with request_stream_state check
        // Old: if (this.request_body != .ReadableStream or this.is_waiting_request_stream_start)
        // New: Detach if not a stream, or if stream hasn't started yet (waiting_start state)
        if (this.request_body != .ReadableStream or request_stream_waiting) {
            this.request_body.detach();
        }

        this.main_thread.abort_reason.deinit();
        this.main_thread.check_server_identity.deinit();
        this.clearAbortSignal();
        // Clear the sink only after the requested ended otherwise we would potentialy lose the last chunk
        this.clearSink();
    }

    // XXX: 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    /// Destroy the FetchTasklet and free all resources.
    /// Must be called from main thread when ref_count reaches 0.
    pub fn deinit(this: *FetchTasklet) error{}!void {
        log("deinit", .{});

        bun.assert(this.shared.ref_count.load(.monotonic) == 0);

        const allocator = bun.default_allocator;

        this.clearData();

        // PHASE 7: Clean up container fields
        this.main_thread.deinit();
        this.shared.deinit(allocator);

        // PHASE 7.5: Lock access to http pointer for final cleanup
        const http_to_destroy = blk: {
            var locked = this.shared.lock();
            defer locked.unlock();

            const http_ = locked.shared.http;
            locked.shared.http = null;
            break :blk http_;
        };

        if (http_to_destroy) |http_| {
            allocator.destroy(http_);
        }
        allocator.destroy(this);
    }

    fn getCurrentResponse(this: *FetchTasklet) ?*Response {
        // we need a body to resolve the promise when buffering
        if (this.main_thread.native_response) |response| {
            return response;
        }

        // if we did not have a direct reference we check if the Weak ref is still alive
        if (this.main_thread.response_weak.get()) |response_js| {
            if (response_js.as(Response)) |response| {
                return response;
            }
        }

        return null;
    }

    /// MIGRATION (Phase 7.3): Helper method replacing ignore_data boolean flag
    /// Returns true if we should ignore remaining body data
    /// Old: this.ignore_data
    /// New: this.shouldIgnoreData()
    fn shouldIgnoreData(this: *FetchTasklet) bool {
        // PHASE 7.5: Lock access to lifecycle state
        var locked = this.shared.lock();
        defer locked.unlock();

        return shouldIgnoreBodyData(
            locked.shared.lifecycle,
            locked.shared.signal_store.aborted.load(.monotonic),
        );
    }

    /// Start streaming request body to server.
    /// Uses explicit ownership transfer to avoid double-retain bugs.
    ///
    /// REF COUNTING PROTOCOL:
    /// - Before: request_body owns 1 ref to stream
    /// - During: sink created with 2 refs
    ///   - Ref 1: FetchTasklet.sink field (we hold this)
    ///   - Ref 2: Streaming pipeline (consumed when stream pipes data to sink)
    /// - After: stream ownership transferred to sink, we hold sink ref
    pub fn startRequestStream(this: *FetchTasklet) void {
        // MIGRATION (Phase 7.3): Replaced is_waiting_request_stream_start flag with request_stream_state transition
        // Old: this.is_waiting_request_stream_start = false;
        // New: Transition from waiting_start to active
        // PHASE 7.5: Lock access to request_stream_state
        {
            var locked = this.shared.lock();
            defer locked.unlock();
            locked.shared.request_stream_state = .active;
        }
        bun.assert(this.request_body == .ReadableStream);

        if (this.request_body.ReadableStream.get(this.main_thread.global_this)) |stream| {
            // Check for abort before starting stream
            if (this.main_thread.abort_signal) |signal| {
                if (signal.aborted()) {
                    stream.abort(this.main_thread.global_this);
                    return;
                }
            }

            const globalThis = this.main_thread.global_this;

            // Keep FetchTasklet alive until sink completes
            // This ref is released in writeEndRequest or clearSink
            this.ref();

            // Create sink with explicit ref count of 2:
            // - Ref 1: We hold via this.main_thread.sink (released in clearSink)
            // - Ref 2: Stream pipeline holds (released when stream finishes)
            const sink = ResumableSink.initExactRefs(globalThis, stream, this, 2);

            // Store sink - we now hold Ref 1
            this.main_thread.sink = sink;

            // Final state:
            // - FetchTasklet has extra ref (from this.ref() above)
            // - sink has 2 refs as documented
            // - stream ownership transferred to sink (via initExactRefs)
        }
    }

    /// Process initial body data before Response object exists.
    /// Decides whether to buffer or stream based on timing.
    /// Phase 4.1: State-based body streaming dispatch
    fn processBodyDataInitial(this: *FetchTasklet) bun.JSTerminated!void {
        log("processBodyDataInitial", .{});

        // Check if we have a readable stream yet
        const has_stream = this.main_thread.readable_stream_ref.held.has();

        if (has_stream) {
            // Stream exists - transition to streaming mode
            log("processBodyDataInitial: transitioning to streaming", .{});
            try this.streamBodyToJS();
        } else {
            // No stream yet - buffer the data
            log("processBodyDataInitial: buffering data", .{});
            this.bufferBodyData();
        }
    }

    /// Stream body data to JS ReadableStream.
    /// Phase 4.1: Focused streaming logic
    fn streamBodyToJS(this: *FetchTasklet) bun.JSTerminated!void {
        log("streamBodyToJS", .{});
        const globalThis = this.main_thread.global_this;

        // PHASE 7.5: Lock access to scheduled_response_buffer and result
        var locked = this.shared.lock();
        defer locked.unlock();

        // Get data from scheduled_response_buffer
        const data = locked.shared.scheduled_response_buffer.list.items;
        const has_more = locked.shared.result.has_more;

        // Early exit if nothing to do
        if (data.len == 0 and has_more) {
            return;
        }

        // Get stream
        const stream = this.main_thread.readable_stream_ref.get(globalThis) orelse {
            // Stream gone - switch to buffering mode
            log("streamBodyToJS: stream gone, switching to buffering", .{});
            // Data already in scheduled_response_buffer, just return
            return;
        };

        if (stream.ptr != .Bytes) {
            log("streamBodyToJS: stream is not Bytes type", .{});
            return;
        }

        // Update size hint
        stream.ptr.Bytes.size_hint = this.getSizeHint();

        // Write chunk to stream
        if (has_more) {
            try stream.ptr.Bytes.onData(
                .{
                    .temporary = bun.ByteList.fromBorrowedSliceDangerous(data),
                },
                bun.default_allocator,
            );
        } else {
            // Final chunk - close stream
            var prev = this.main_thread.readable_stream_ref;
            this.main_thread.readable_stream_ref = .{};
            defer prev.deinit();

            try stream.ptr.Bytes.onData(
                .{
                    .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(data),
                },
                bun.default_allocator,
            );
        }
    }

    /// Stream body data to Response's ReadableStream.
    /// Phase 4.1: Handle streaming when Response exists
    fn streamBodyToResponse(this: *FetchTasklet, response: *Response) bun.JSTerminated!void {
        log("streamBodyToResponse", .{});
        const globalThis = this.main_thread.global_this;

        // PHASE 7.5: Lock access to body_size, scheduled_response_buffer and result
        var locked = this.shared.lock();
        defer locked.unlock();

        const sizeHint = this.getSizeHint();
        response.setSizeHint(sizeHint);

        const readable = response.getBodyReadableStream(globalThis) orelse {
            log("streamBodyToResponse: no readable stream on response", .{});
            return;
        };

        if (readable.ptr != .Bytes) {
            log("streamBodyToResponse: stream is not Bytes type", .{});
            return;
        }

        const data = locked.shared.scheduled_response_buffer.list.items;
        const has_more = locked.shared.result.has_more;

        if (has_more) {
            try readable.ptr.Bytes.onData(
                .{
                    .temporary = bun.ByteList.fromBorrowedSliceDangerous(data),
                },
                bun.default_allocator,
            );
        } else {
            readable.value.ensureStillAlive();
            response.detachReadableStream(globalThis);
            try readable.ptr.Bytes.onData(
                .{
                    .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(data),
                },
                bun.default_allocator,
            );
        }
    }

    /// Buffer body data in memory (no stream yet).
    /// Phase 4.1: Simple buffering logic
    fn bufferBodyData(this: *FetchTasklet) void {
        _ = this;
        log("bufferBodyData", .{});
        // Data is already in scheduled_response_buffer from the HTTP thread callback
        // Nothing to do here - just keep accumulating
    }

    /// Finalize buffered body data into Response.
    /// Phase 4.1: Complete buffering and resolve body
    fn finalizeBufferedBody(this: *FetchTasklet, response: *Response) bun.JSTerminated!void {
        log("finalizeBufferedBody", .{});

        // PHASE 7.5: Lock access to result and scheduled_response_buffer
        var locked = this.shared.lock();
        defer locked.unlock();

        if (locked.shared.result.has_more) {
            // Not done yet, keep buffering
            return;
        }

        // Transfer buffered data to body
        var scheduled_response_buffer = locked.shared.scheduled_response_buffer.list;
        const body = response.getBodyValue();
        var old = body.*;
        const body_value = Body.Value{
            .InternalBlob = .{
                .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
            },
        };
        body.* = body_value;
        log("finalizeBufferedBody: body_value length={}", .{body_value.InternalBlob.bytes.items.len});

        locked.shared.scheduled_response_buffer = .{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        };

        if (old == .Locked) {
            log("finalizeBufferedBody: resolving locked body", .{});
            try old.resolve(body, this.main_thread.global_this, response.getFetchHeaders());
        }
    }

    /// Handle error case for body reception.
    /// Phase 4.1: Centralized error handling
    fn handleBodyError(this: *FetchTasklet) bun.JSTerminated!void {
        log("handleBodyError", .{});
        const globalThis = this.main_thread.global_this;

        var err = this.onReject();
        var need_deinit = true;
        defer if (need_deinit) err.deinit();
        var js_err = JSValue.zero;

        // if we are streaming update with error
        if (this.main_thread.readable_stream_ref.get(globalThis)) |readable| {
            if (readable.ptr == .Bytes) {
                js_err = err.toJS(globalThis);
                js_err.ensureStillAlive();
                try readable.ptr.Bytes.onData(
                    .{
                        .err = .{ .JSValue = js_err },
                    },
                    bun.default_allocator,
                );
            }
        }

        if (this.main_thread.sink) |sink| {
            if (js_err == .zero) {
                js_err = err.toJS(globalThis);
                js_err.ensureStillAlive();
            }
            sink.cancel(js_err);
            return;
        }

        // if we are buffering resolve the promise
        if (this.getCurrentResponse()) |response| {
            need_deinit = false; // body value now owns the error
            const body = response.getBodyValue();
            try body.toErrorInstance(err, globalThis);
        }
    }

    /// Called from main thread (from onProgressUpdate) when body data is received.
    /// Caller must hold the mutex when calling this function.
    /// Phase 4.1: State-based dispatch - simplified top-level logic
    pub fn onBodyReceived(this: *FetchTasklet) bun.JSTerminated!void {
        const success = this.shared.result.isSuccess();
        // reset the buffer if we are streaming or if we are not waiting for buffering anymore
        var buffer_reset = true;
        log("onBodyReceived success={} has_more={}", .{ success, this.shared.result.has_more });
        defer {
            if (buffer_reset) {
                this.shared.scheduled_response_buffer.reset();
            }
        }

        // Handle error case first
        if (!success) {
            try this.handleBodyError();
            return;
        }

        // Check if we have a Response object yet
        if (this.getCurrentResponse()) |response| {
            // Response exists - check if it has a stream
            if (response.getBodyReadableStream(this.main_thread.global_this)) |_| {
                // Response has its own stream - use it
                try this.streamBodyToResponse(response);
            } else {
                // Response exists but no stream - we're buffering
                buffer_reset = false;
                try this.finalizeBufferedBody(response);
            }
        } else {
            // No Response yet - initial body data
            try this.processBodyDataInitial();
        }
    }

    /// Called on main thread to process received data from HTTP thread.
    /// This is the main thread handler for the callback enqueued from the HTTP thread.
    pub fn onProgressUpdate(this: *FetchTasklet) bun.JSTerminated!void {
        jsc.markBinding(@src());
        log("onProgressUpdate", .{});

        // Reset callback flag first (allows HTTP thread to schedule again)
        defer this.shared.has_schedule_callback.store(false, .release);

        const vm = this.main_thread.javascript_vm;
        // vm is shutting down we cannot touch JS
        if (vm.isShuttingDown()) {
            // Still need to check if we're done for cleanup
            var locked = this.shared.lock();
            const is_done = !locked.shared.result.has_more;
            locked.unlock();
            if (is_done) {
                this.deref();
            }
            return;
        }

        // Acquire lock to read shared state
        var locked = this.shared.lock();
        const is_done = !locked.shared.result.has_more;

        const globalThis = this.main_thread.global_this;
        defer {
            locked.unlock();
            // if we are not done we wait until the next call
            if (is_done) {
                var poll_ref = this.main_thread.poll_ref;
                this.main_thread.poll_ref = .{};
                poll_ref.unref(vm);
                this.deref();
            }
        }
        // MIGRATION (Phase 7.3): Replaced is_waiting_request_stream_start with request_stream_state check
        // Old: if (this.is_waiting_request_stream_start and this.result.can_stream)
        // New: Check if request stream is in waiting_start state
        if (locked.shared.request_stream_state == .waiting_start and locked.shared.result.can_stream) {
            // start streaming
            this.startRequestStream();
        }
        // if we already respond the metadata and still need to process the body
        // MIGRATION (Phase 7.3): Replaced is_waiting_body with lifecycle state check
        // Old: if (this.is_waiting_body)
        // New: Check if we're awaiting body access or actively receiving body
        if (locked.shared.lifecycle == .response_awaiting_body_access) {
            try this.onBodyReceived();
            return;
        }
        if (locked.shared.metadata == null and locked.shared.result.isSuccess()) return;

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit
        // MIGRATION (Phase 7.3): Replaced is_waiting_abort with signal_store.aborted atomic check
        // Old: if (this.is_waiting_abort)
        // New: Check atomic abort flag - this indicates abort pending but waiting for HTTP thread cleanup
        // Note: The original logic set is_waiting_abort = has_more, so we wait if aborted AND has_more
        if (locked.shared.signal_store.aborted.load(.monotonic) and locked.shared.result.has_more) {
            return;
        }

        // Check if we have an abort error to reject with
        if (this.getAbortError()) |abort_error| {
            const promise_value = this.main_thread.promise.valueOrEmpty();
            if (!promise_value.isEmptyOrUndefinedOrNull()) {
                const promise = promise_value.asAnyPromise().?;
                const tracker = this.main_thread.tracker;
                var result = abort_error;
                defer result.deinit();

                promise_value.ensureStillAlive();
                try promise.reject(globalThis, result.toJS(globalThis));

                tracker.didDispatch(globalThis);
                this.main_thread.promise.deinit();
            }
            return;
        }

        const promise_value = this.main_thread.promise.valueOrEmpty();

        if (promise_value.isEmptyOrUndefinedOrNull()) {
            log("onProgressUpdate: promise_value is null", .{});
            this.main_thread.promise.deinit();
            return;
        }

        if (locked.shared.result.certificate_info) |certificate_info| {
            locked.shared.result.certificate_info = null;
            defer certificate_info.deinit(bun.default_allocator);

            // we receive some error
            if (locked.shared.reject_unauthorized and !this.checkServerIdentity(certificate_info)) {
                log("onProgressUpdate: aborted due certError", .{});
                // we need to abort the request
                const promise = promise_value.asAnyPromise().?;
                const tracker = this.main_thread.tracker;
                var result = this.onReject();
                defer result.deinit();

                promise_value.ensureStillAlive();
                try promise.reject(globalThis, result.toJS(globalThis));

                tracker.didDispatch(globalThis);
                this.main_thread.promise.deinit();
                return;
            }
            // everything ok
            if (locked.shared.metadata == null) {
                log("onProgressUpdate: metadata is null", .{});
                return;
            }
        }

        const tracker = this.main_thread.tracker;
        tracker.willDispatch(globalThis);
        defer {
            log("onProgressUpdate: promise_value is not null", .{});
            tracker.didDispatch(globalThis);
            this.main_thread.promise.deinit();
        }
        const success = locked.shared.result.isSuccess();
        const result = switch (success) {
            true => jsc.Strong.Optional.create(this.onResolve(), globalThis),
            false => brk: {
                // in this case we wanna a jsc.Strong.Optional so we just convert it
                var value = this.onReject();
                const err = value.toJS(globalThis);
                if (this.main_thread.sink) |sink| {
                    sink.cancel(err);
                }
                break :brk value.JSValue;
            },
        };

        promise_value.ensureStillAlive();
        const Holder = struct {
            held: jsc.Strong.Optional,
            promise: jsc.Strong.Optional,
            globalObject: *jsc.JSGlobalObject,
            task: jsc.AnyTask,

            pub fn resolve(self: *@This()) bun.JSTerminated!void {
                // cleanup
                defer bun.default_allocator.destroy(self);
                defer self.held.deinit();
                defer self.promise.deinit();
                // resolve the promise
                var prom = self.promise.swap().asAnyPromise().?;
                const res = self.held.swap();
                res.ensureStillAlive();
                try prom.resolve(self.globalObject, res);
            }

            pub fn reject(self: *@This()) bun.JSTerminated!void {
                // cleanup
                defer bun.default_allocator.destroy(self);
                defer self.held.deinit();
                defer self.promise.deinit();

                // reject the promise
                var prom = self.promise.swap().asAnyPromise().?;
                const res = self.held.swap();
                res.ensureStillAlive();
                try prom.reject(self.globalObject, res);
            }
        };
        var holder = bun.handleOom(bun.default_allocator.create(Holder));
        holder.* = .{
            .held = result,
            // we need the promise to be alive until the task is done
            .promise = this.main_thread.promise.strong,
            .globalObject = globalThis,
            .task = undefined,
        };
        this.main_thread.promise.strong = .empty;
        holder.task = switch (success) {
            true => jsc.AnyTask.New(Holder, Holder.resolve).init(holder),
            false => jsc.AnyTask.New(Holder, Holder.reject).init(holder),
        };

        vm.enqueueTask(jsc.Task.init(&holder.task));
    }

    /// Called from main thread (from onProgressUpdate) to validate TLS certificate.
    /// Caller must hold mutex when calling this function.
    /// Uses atomic operations to signal abort to HTTP thread.
    pub fn checkServerIdentity(this: *FetchTasklet, certificate_info: http.CertificateInfo) bool {
        if (this.main_thread.check_server_identity.get()) |check_server_identity| {
            check_server_identity.ensureStillAlive();
            if (certificate_info.cert.len > 0) {
                const cert = certificate_info.cert;
                var cert_ptr = cert.ptr;
                if (BoringSSL.d2i_X509(null, &cert_ptr, @intCast(cert.len))) |x509| {
                    const globalObject = this.main_thread.global_this;
                    defer x509.free();
                    const js_cert = X509.toJS(x509, globalObject) catch |err| {
                        switch (err) {
                            error.JSError => {},
                            error.OutOfMemory => globalObject.throwOutOfMemory() catch {},
                            error.JSTerminated => {},
                        }
                        const check_result = globalObject.tryTakeException().?;
                        // mark to wait until deinit
                        // MIGRATION (Phase 7.3): Removed is_waiting_abort flag write
                        // Old: this.is_waiting_abort = this.result.has_more;
                        // New: signal_store.aborted atomic already stores abort state
                        // The combination of aborted=true + has_more is checked in onProgressUpdate
                        this.main_thread.abort_reason.set(globalObject, check_result);
                        this.shared.signal_store.aborted.store(true, .monotonic);
                        this.main_thread.tracker.didCancel(this.main_thread.global_this);
                        // we need to abort the request
                        if (this.shared.http) |http_| http.http_thread.scheduleShutdown(http_);
                        this.shared.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
                        return false;
                    };
                    var hostname: bun.String = bun.String.cloneUTF8(certificate_info.hostname);
                    defer hostname.deref();
                    const js_hostname = hostname.toJS(globalObject);
                    js_hostname.ensureStillAlive();
                    js_cert.ensureStillAlive();
                    const check_result = check_server_identity.call(globalObject, .js_undefined, &.{ js_hostname, js_cert }) catch |err| globalObject.takeException(err);

                    // > Returns <Error> object [...] on failure
                    if (check_result.isAnyError()) {
                        // mark to wait until deinit
                        // MIGRATION (Phase 7.3): Removed is_waiting_abort flag write
                        // Old: this.is_waiting_abort = this.result.has_more;
                        // New: signal_store.aborted atomic already stores abort state
                        // The combination of aborted=true + has_more is checked in onProgressUpdate
                        this.main_thread.abort_reason.set(globalObject, check_result);
                        this.shared.signal_store.aborted.store(true, .monotonic);
                        this.main_thread.tracker.didCancel(this.main_thread.global_this);

                        // we need to abort the request
                        if (this.shared.http) |http_| {
                            http.http_thread.scheduleShutdown(http_);
                        }
                        this.shared.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
                        return false;
                    }

                    // > On success, returns <undefined>
                    // We treat any non-error value as a success.
                    return true;
                }
            }
        }
        this.shared.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
        return false;
    }

    fn getAbortError(this: *FetchTasklet) ?Body.Value.ValueError {
        if (this.main_thread.abort_reason.has()) {
            defer this.clearAbortSignal();
            const out = this.main_thread.abort_reason;

            this.main_thread.abort_reason = .empty;
            return Body.Value.ValueError{ .JSValue = out };
        }

        if (this.main_thread.abort_signal) |signal| {
            if (signal.reasonIfAborted(this.main_thread.global_this)) |reason| {
                defer this.clearAbortSignal();
                return reason.toBodyValueError(this.main_thread.global_this);
            }
        }

        return null;
    }

    fn clearAbortSignal(this: *FetchTasklet) void {
        const signal = this.main_thread.abort_signal orelse return;
        this.main_thread.abort_signal = null;
        defer {
            signal.pendingActivityUnref();
            signal.unref();
        }

        signal.cleanNativeBindings(this);
    }

    pub fn onReject(this: *FetchTasklet) Body.Value.ValueError {
        // PHASE 7.5: Lock access to result, metadata, and http
        var locked = this.shared.lock();
        defer locked.unlock();

        bun.assert(locked.shared.result.fail != null);
        log("onReject", .{});

        if (this.getAbortError()) |err| {
            return err;
        }

        if (locked.shared.result.abortReason()) |reason| {
            return .{ .AbortReason = reason };
        }

        // some times we don't have metadata so we also check http.url
        const path = if (locked.shared.metadata) |metadata|
            bun.String.cloneUTF8(metadata.url)
        else if (locked.shared.http) |http_|
            bun.String.cloneUTF8(http_.url.href)
        else
            bun.String.empty;

        const fetch_error = jsc.SystemError{
            .code = bun.String.static(switch (locked.shared.result.fail.?) {
                error.ConnectionClosed => "ECONNRESET",
                else => |e| @errorName(e),
            }),
            .message = switch (locked.shared.result.fail.?) {
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

                else => |e| bun.String.createFormat("{s} fetching \"{}\". For more information, pass `verbose: true` in the second argument to fetch()", .{
                    @errorName(e),
                    path,
                }) catch |err| bun.handleOom(err),
            },
            .path = path,
        };

        return .{ .SystemError = fetch_error };
    }

    /// Called from main thread when ReadableStream becomes available.
    /// Main thread only - no locking needed.
    pub fn onReadableStreamAvailable(ctx: *anyopaque, globalThis: *jsc.JSGlobalObject, readable: jsc.WebCore.ReadableStream) void {
        const this = bun.cast(*FetchTasklet, ctx);
        this.main_thread.readable_stream_ref = jsc.WebCore.ReadableStream.Strong.init(readable, globalThis);
    }

    /// Called from main thread when JS starts consuming the response body stream.
    /// Acquires mutex to safely transfer buffered data.
    pub fn onStartStreamingHTTPResponseBodyCallback(ctx: *anyopaque) jsc.WebCore.DrainResult {
        const this = bun.cast(*FetchTasklet, ctx);
        // Atomic check - safe without lock
        if (this.shared.signal_store.aborted.load(.monotonic)) {
            return jsc.WebCore.DrainResult{
                .aborted = {},
            };
        }

        // PHASE 7.5: Lock access to http pointer before using it
        var locked = this.shared.lock();
        defer locked.unlock();

        if (locked.shared.http) |http_| {
            http_.enableResponseBodyStreaming();

            // If the server sent the headers and the response body in two separate socket writes
            // and if the server doesn't close the connection by itself
            // and doesn't send any follow-up data
            // then we must make sure the HTTP thread flushes.
            bun.http.http_thread.scheduleResponseBodyDrain(http_.async_http_id);
        }
        const size_hint = this.getSizeHint();

        var scheduled_response_buffer = locked.shared.scheduled_response_buffer.list;
        // This means we have received part of the body but not the whole thing
        if (scheduled_response_buffer.items.len > 0) {
            locked.shared.scheduled_response_buffer = .{
                .allocator = bun.default_allocator,
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            };

            return .{
                .owned = .{
                    .list = scheduled_response_buffer.toManaged(bun.default_allocator),
                    .size_hint = size_hint,
                },
            };
        }

        return .{
            .estimated_size = size_hint,
        };
    }

    /// Get size hint for body streaming.
    /// PHASE 7.5: Caller must hold mutex when calling this function.
    fn getSizeHint(this: *FetchTasklet) Blob.SizeType {
        return switch (this.shared.body_size) {
            .content_length => @truncate(this.shared.body_size.content_length),
            .total_received => @truncate(this.shared.body_size.total_received),
            .unknown => 0,
        };
    }

    /// Convert response to Body.Value.
    /// PHASE 7.5: Caller must hold mutex when calling this function.
    fn toBodyValue(this: *FetchTasklet) Body.Value {
        if (this.getAbortError()) |err| {
            return .{ .Error = err };
        }
        // MIGRATION (Phase 7.3): Replaced is_waiting_body with lifecycle state check
        // Old: if (this.is_waiting_body)
        // New: Check if we're still awaiting body data (Response created but body not complete)
        if (this.shared.lifecycle == .response_awaiting_body_access) {
            const response = Body.Value{
                .Locked = .{
                    .size_hint = this.getSizeHint(),
                    .task = this,
                    .global = this.main_thread.global_this,
                    .onStartStreaming = FetchTasklet.onStartStreamingHTTPResponseBodyCallback,
                    .onReadableStreamAvailable = FetchTasklet.onReadableStreamAvailable,
                },
            };
            return response;
        }

        var scheduled_response_buffer = this.shared.scheduled_response_buffer.list;
        const response = Body.Value{
            .InternalBlob = .{
                .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
            },
        };
        this.shared.scheduled_response_buffer = .{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        };

        return response;
    }

    fn toResponse(this: *FetchTasklet) Response {
        log("toResponse", .{});

        // PHASE 7.5: Lock access to metadata, result, and lifecycle
        var locked = this.shared.lock();
        defer locked.unlock();

        bun.assert(locked.shared.metadata != null);
        // at this point we always should have metadata
        const metadata = locked.shared.metadata.?;
        const http_response = metadata.response;
        // MIGRATION (Phase 7.3): Replaced is_waiting_body flag with lifecycle state transition
        // Old: this.is_waiting_body = this.result.has_more;
        // New: Set lifecycle based on whether we're still receiving body data
        if (locked.shared.result.has_more) {
            locked.shared.lifecycle = .response_awaiting_body_access;
        } else {
            locked.shared.lifecycle = .completed;
        }
        const redirected = locked.shared.result.redirected;

        return Response.init(
            .{
                .headers = FetchHeaders.createFromPicoHeaders(http_response.headers),
                .status_code = @as(u16, @truncate(http_response.status_code)),
                .status_text = bun.String.createAtomIfPossible(http_response.status),
            },
            Body{
                .value = this.toBodyValue(),
            },
            bun.String.createAtomIfPossible(metadata.url),
            redirected,
        );
    }

    /// Called from main thread when response body should be ignored.
    /// Caller must hold mutex when calling this function.
    fn ignoreRemainingResponseBody(this: *FetchTasklet) void {
        log("ignoreRemainingResponseBody", .{});
        // enabling streaming will make the http thread to drain into the main thread (aka stop buffering)
        // without a stream ref, response body or response instance alive it will just ignore the result
        if (this.shared.http) |http_| {
            http_.enableResponseBodyStreaming();
        }
        // we should not keep the process alive if we are ignoring the body
        const vm = this.main_thread.javascript_vm;
        this.main_thread.poll_ref.unref(vm);
        // clean any remaining refereces
        this.main_thread.readable_stream_ref.deinit();
        this.main_thread.response_weak.deinit();

        if (this.main_thread.native_response) |response| {
            response.unref();
            this.main_thread.native_response = null;
        }

        // MIGRATION (Phase 7.3): Removed ignore_data flag write
        // Old: this.ignore_data = true;
        // New: No explicit flag needed - shouldIgnoreData() computes from lifecycle and abort state
        // Since we're finalizing the response, the lifecycle will reflect this,
        // or abort flag will be set, making shouldIgnoreData() return true automatically
    }

    /// Called when Response JS object is garbage collected.
    /// This is our signal to stop processing body data.
    export fn Bun__FetchResponse_finalize(this: *FetchTasklet) callconv(.C) void {
        log("onResponseFinalize", .{});

        // === ACQUIRE LOCK - Fix race condition ===
        var locked = this.shared.lock();
        defer locked.unlock();

        const lifecycle = locked.lifecycle();

        // Only request abort if we're still receiving body data
        if (lifecycle.canReceiveBody()) {
            // Signal abort to HTTP thread
            this.shared.abort_requested.store(true, .release);

            // Transition to aborted state
            locked.transitionTo(.aborted);

            // Clear accumulated buffers since we're ignoring rest
            locked.shared.response_buffer.list.clearRetainingCapacity();
            locked.shared.scheduled_response_buffer.list.clearRetainingCapacity();
        }

        // If already terminal, nothing to do
    }
    comptime {
        _ = Bun__FetchResponse_finalize;
    }

    pub fn onResolve(this: *FetchTasklet) JSValue {
        log("onResolve", .{});
        const response = bun.new(Response, this.toResponse());
        const response_js = Response.makeMaybePooled(@as(*jsc.JSGlobalObject, this.main_thread.global_this), response);
        response_js.ensureStillAlive();
        this.main_thread.response_weak = jsc.Weak(FetchTasklet).create(response_js, this.main_thread.global_this, .FetchResponse, this);
        this.main_thread.native_response = response.ref();
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

        // PHASE 7: Initialize new container fields
        fetch_tasklet.* = .{
            // Phase 7 container fields
            .main_thread = .{
                .global_this = globalThis,
                .javascript_vm = jsc_vm,
                .promise = promise,
                .abort_signal = fetch_options.signal,
                .check_server_identity = fetch_options.check_server_identity,
                .tracker = jsc.Debugger.AsyncTaskTracker.init(jsc_vm),
            },
            .shared = try SharedData.init(bun.default_allocator),
            // Legacy fields (to be migrated)
            // PHASE 7.4 Part 4: lifecycle now in shared container (initialized in SharedData.init)
            // PHASE 7.4 Part 4: request_stream_state now in shared container (initialized in SharedData.init)
            // PHASE 7.4: scheduled_response_buffer now in shared container
            // PHASE 7.4: response_buffer now in shared container
            // PHASE 7.4: http now in shared container
            // PHASE 7: javascript_vm now in main_thread
            .request_body = fetch_options.body,
            // PHASE 7: global_this now in main_thread
            // PHASE 7: promise now in main_thread
            // PHASE 7.4 Part 4: request_headers now in shared container
            // PHASE 7.4 Part 4: url_proxy_buffer now in shared container
            // PHASE 7.4 Part 4: signal now abort_signal in main_thread container
            // PHASE 7.4 Part 4: hostname now in shared container
            // PHASE 7.4: tracker now in main_thread container
            // PHASE 7.4: check_server_identity now in main_thread container (initialized above)
            // PHASE 7.4 Part 4: reject_unauthorized now in shared container
            // PHASE 7.4 Part 3: upgraded_connection now in shared container
            // PHASE 7.4 Part 4: mutex now in shared container
        };

        // PHASE 7.4 Part 3 & 4: Set fields in shared container
        fetch_tasklet.shared.upgraded_connection = fetch_options.upgraded_connection;
        fetch_tasklet.shared.request_headers = fetch_options.headers;
        fetch_tasklet.shared.url_proxy_buffer = fetch_options.url_proxy_buffer;
        fetch_tasklet.shared.hostname = fetch_options.hostname;
        fetch_tasklet.shared.reject_unauthorized = fetch_options.reject_unauthorized;

        // PHASE 7.4 Part 3: signals now in shared container
        fetch_tasklet.shared.signals = fetch_tasklet.shared.signal_store.to();

        fetch_tasklet.main_thread.tracker.didSchedule(globalThis);

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

        if (fetch_tasklet.main_thread.check_server_identity.has() and fetch_tasklet.shared.reject_unauthorized) {
            fetch_tasklet.shared.signal_store.cert_errors.store(true, .monotonic);
        } else {
            fetch_tasklet.shared.signals.cert_errors = null;
        }

        // PHASE 7.4: Allocate http pointer in shared container
        fetch_tasklet.shared.http = try allocator.create(http.AsyncHTTP);

        // This task gets queued on the HTTP thread.
        fetch_tasklet.shared.http.?.* = http.AsyncHTTP.init(
            bun.default_allocator,
            fetch_options.method,
            fetch_options.url,
            fetch_options.headers.entries,
            fetch_options.headers.buf.items,
            &fetch_tasklet.shared.response_buffer,
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
                .signals = fetch_tasklet.shared.signals,
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
        fetch_tasklet.shared.http.?.client.flags.is_streaming_request_body = isStream;
        // MIGRATION (Phase 7.3): Replaced is_waiting_request_stream_start flag with request_stream_state
        // Old: fetch_tasklet.is_waiting_request_stream_start = isStream;
        // New: Set request_stream_state to waiting_start if streaming, none otherwise
        fetch_tasklet.shared.request_stream_state = if (isStream) .waiting_start else .none;
        if (isStream) {
            // Create buffer for request body streaming
            // REF COUNTING: Buffer created with 1 ref, will gain second ref when HTTP thread starts using it
            // - Ref 1: FetchTasklet.shared.request_body_streaming_buffer (released in clearSink)
            // - Ref 2: HTTP thread holds while streaming (released when request completes)
            const buffer = http.ThreadSafeStreamBuffer.new(.{});
            buffer.setDrainCallback(FetchTasklet, FetchTasklet.onWriteRequestDataDrain, fetch_tasklet);
            fetch_tasklet.shared.request_body_streaming_buffer = buffer; // We hold Ref 1
            fetch_tasklet.shared.http.?.request_body = .{
                .stream = .{
                    .buffer = buffer, // HTTP thread will hold Ref 2 when started
                    .ended = false,
                },
            };
        }
        // TODO is this necessary? the http client already sets the redirect type,
        // so manually setting it here seems redundant
        if (fetch_options.redirect_type != FetchRedirect.follow) {
            fetch_tasklet.shared.http.?.client.remaining_redirect_count = 0;
        }

        // we want to return after headers are received
        fetch_tasklet.shared.signal_store.header_progress.store(true, .monotonic);

        if (fetch_tasklet.request_body == .Sendfile) {
            bun.assert(fetch_options.url.isHTTP());
            bun.assert(fetch_options.proxy == null);
            fetch_tasklet.shared.http.?.request_body = .{ .sendfile = fetch_tasklet.request_body.Sendfile };
        }

        if (fetch_tasklet.main_thread.abort_signal) |signal| {
            signal.pendingActivityRef();
            fetch_tasklet.main_thread.abort_signal = signal.listen(FetchTasklet, fetch_tasklet, FetchTasklet.abortListener);
        }
        return fetch_tasklet;
    }

    /// Called from main thread when abort signal is triggered.
    /// Uses atomic operation to signal HTTP thread.
    pub fn abortListener(this: *FetchTasklet, reason: JSValue) void {
        log("abortListener", .{});
        reason.ensureStillAlive();
        this.main_thread.abort_reason.set(this.main_thread.global_this, reason);
        this.abortTask();
        if (this.main_thread.sink) |sink| {
            sink.cancel(reason);
            return;
        }

        // When there's no sink, we must manually schedule promise rejection.
        // The HTTP thread callback returns early when aborted (line 2303),
        // so onProgressUpdate won't be called otherwise.
        this.ref(); // Keep alive during cross-thread handoff
        this.main_thread.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.onProgressUpdate));
    }

    /// Callback from HTTP thread when request buffer is drained and ready for more data.
    /// THREAD: HTTP thread
    /// REF COUNTING: Adds temporary ref for cross-thread handoff (released in resumeRequestDataStream)
    pub fn onWriteRequestDataDrain(this: *FetchTasklet) void {
        // Keep FetchTasklet alive during cross-thread handoff
        // Released in resumeRequestDataStream() on main thread
        this.ref();
        this.main_thread.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.resumeRequestDataStream));
    }

    /// Resume request data streaming on main thread.
    /// Called after HTTP thread signals buffer is drained.
    /// THREAD: Main thread
    /// REF COUNTING: Releases ref added in onWriteRequestDataDrain()
    // XXX: 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    pub fn resumeRequestDataStream(this: *FetchTasklet) error{}!void {
        // Release ref from onWriteRequestDataDrain() (cross-thread handoff complete)
        defer this.deref();
        log("resumeRequestDataStream", .{});
        if (this.main_thread.sink) |sink| {
            if (this.main_thread.abort_signal) |signal| {
                if (signal.aborted()) {
                    // already aborted; nothing to drain
                    return;
                }
            }
            sink.drain();
        }
    }

    /// Called from main thread to write request body data.
    /// Thread-safe: Uses ThreadSafeStreamBuffer which has internal locking.
    pub fn writeRequestData(this: *FetchTasklet, data: []const u8) ResumableSinkBackpressure {
        log("writeRequestData {}", .{data.len});
        if (this.main_thread.abort_signal) |signal| {
            if (signal.aborted()) {
                return .done;
            }
        }

        // PHASE 7.5: Lock access to request_body_streaming_buffer, http, and upgraded_connection
        var locked = this.shared.lock();
        defer locked.unlock();

        const thread_safe_stream_buffer = locked.shared.request_body_streaming_buffer orelse return .done;
        // acquire/release provides thread-safe access to the buffer
        const stream_buffer = thread_safe_stream_buffer.acquire();
        defer thread_safe_stream_buffer.release();
        const highWaterMark = if (this.main_thread.sink) |sink| sink.highWaterMark else 16384;

        const http_ptr = locked.shared.http.?;
        const upgraded_connection = locked.shared.upgraded_connection;

        var needs_schedule = false;
        defer if (needs_schedule) {
            // wakeup the http thread to write the data
            http.http_thread.scheduleRequestWrite(http_ptr, .data);
        };

        // dont have backpressure so we will schedule the data to be written
        // if we have backpressure the onWritable will drain the buffer
        needs_schedule = stream_buffer.isEmpty();
        if (upgraded_connection) {
            bun.handleOom(stream_buffer.write(data));
        } else {
            //16 is the max size of a hex number size that represents 64 bits + 2 for the \r\n
            var formated_size_buffer: [18]u8 = undefined;
            const formated_size = std.fmt.bufPrint(
                formated_size_buffer[0..],
                "{x}\r\n",
                .{data.len},
            ) catch |err| switch (err) {
                error.NoSpaceLeft => unreachable,
            };
            bun.handleOom(stream_buffer.ensureUnusedCapacity(formated_size.len + data.len + 2));
            stream_buffer.writeAssumeCapacity(formated_size);
            stream_buffer.writeAssumeCapacity(data);
            stream_buffer.writeAssumeCapacity("\r\n");
        }

        // pause the stream if we hit the high water mark
        return if (stream_buffer.size() >= highWaterMark) .backpressure else .want_more;
    }

    /// Called from main thread to end the request body stream.
    /// Thread-safe: Uses atomic operations and ThreadSafeStreamBuffer.
    ///
    /// REF COUNTING:
    /// - Releases the FetchTasklet ref added in startRequestStream()
    /// - This is the matching deref() for the ref() call when sink was created
    pub fn writeEndRequest(this: *FetchTasklet, err: ?jsc.JSValue) void {
        log("writeEndRequest hasError? {}", .{err != null});
        defer this.deref(); // Release ref from startRequestStream()
        if (err) |jsError| {
            // Atomic check - safe without lock
            if (this.shared.signal_store.aborted.load(.monotonic) or this.main_thread.abort_reason.has()) {
                return;
            }
            if (!jsError.isUndefinedOrNull()) {
                this.main_thread.abort_reason.set(this.main_thread.global_this, jsError);
            }
            this.abortTask();
        } else {
            // PHASE 7.5: Lock access to upgraded_connection, request_body_streaming_buffer, and http
            var locked = this.shared.lock();
            defer locked.unlock();

            if (!locked.shared.upgraded_connection) {
                // If is not upgraded we need to send the terminating chunk
                const thread_safe_stream_buffer = locked.shared.request_body_streaming_buffer orelse return;
                const stream_buffer = thread_safe_stream_buffer.acquire();
                defer thread_safe_stream_buffer.release();
                bun.handleOom(stream_buffer.write(http.end_of_chunked_http1_1_encoding_response_body));
            }
            if (locked.shared.http) |http_| {
                // just tell to write the end of the chunked encoding aka 0\r\n\r\n
                http.http_thread.scheduleRequestWrite(http_, .end);
            }
        }
    }

    /// Abort the fetch operation.
    /// Can be called from any thread - uses atomic operation for thread safety.
    /// HTTP thread checks this flag and stops processing.
    pub fn abortTask(this: *FetchTasklet) void {
        // Atomic store - safe from any thread
        this.shared.signal_store.aborted.store(true, .monotonic);
        this.main_thread.tracker.didCancel(this.main_thread.global_this);

        // PHASE 7.5: Lock access to http pointer
        var locked = this.shared.lock();
        defer locked.unlock();

        if (locked.shared.http) |http_| {
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
        node.shared.http.?.schedule(allocator, &batch);
        node.main_thread.poll_ref.ref(global.bunVM());

        // increment ref so we can keep it alive until the http client is done
        node.ref();
        http.http_thread.schedule(batch);

        return node;
    }

    /// Called from HTTP thread. Handles HTTP events received from socket.
    /// This function does MINIMAL work - only atomic operations and data copying under lock.
    pub fn callback(task: *FetchTasklet, async_http: *http.AsyncHTTP, result: http.HTTPClientResult) void {
        // === HTTP THREAD - Minimal work, atomic ops only ===

        const is_done = !result.has_more;
        // we are done with the http client so we can deref our side
        // this is a atomic operation and will enqueue a task to deinit on the main thread
        defer if (is_done) task.derefFromThread();

        // Fast-path check: should we abort?
        if (task.shared.signal_store.aborted.load(.acquire)) {
            // Don't schedule anything, HTTP client will clean up
            return;
        }

        // Prevent duplicate enqueues (atomic swap)
        // If already scheduled, HTTP thread will pick up this data on next callback
        if (task.shared.has_schedule_callback.swap(true, .acq_rel)) {
            // Already scheduled - data will be picked up on next progress update
            // Still need to store the data under lock for the main thread to process
            var locked = task.shared.lock();
            defer locked.unlock();

            locked.shared.http.?.* = async_http.*;
            locked.shared.http.?.response_buffer = async_http.response_buffer;

            const prev_metadata = locked.shared.result.metadata;
            const prev_cert_info = locked.shared.result.certificate_info;
            locked.shared.result = result;

            // Preserve pending certificate info
            if (locked.shared.result.certificate_info == null) {
                if (prev_cert_info) |cert_info| {
                    locked.shared.result.certificate_info = cert_info;
                }
            }

            // metadata should be provided only once
            if (result.metadata orelse prev_metadata) |metadata| {
                if (locked.shared.metadata == null) {
                    locked.shared.metadata = metadata;
                }
                locked.shared.result.metadata = null;
            }

            locked.shared.body_size = result.body_size;
            locked.shared.response_buffer = result.body.?.*;

            // Copy data to scheduled buffer if not ignoring
            // MIGRATION (Phase 7.3): Replaced ignore_data flag with shouldIgnoreData() method call
            // Old: if (!task.ignore_data)
            // New: if (!task.shouldIgnoreData())
            if (!task.shouldIgnoreData()) {
                const success = result.isSuccess();
                if (success) {
                    _ = bun.handleOom(locked.shared.scheduled_response_buffer.write(locked.shared.response_buffer.list.items));
                }
            }
            locked.shared.response_buffer.reset();
            return;
        }

        // Copy data to shared state under lock
        {
            var locked = task.shared.lock();
            defer locked.unlock();

            locked.shared.http.?.* = async_http.*;
            locked.shared.http.?.response_buffer = async_http.response_buffer;

            // MIGRATION (Phase 7.3): Replaced ignore_data in log with shouldIgnoreData() call
            // Old: task.ignore_data
            // New: task.shouldIgnoreData()
            log("callback success={} ignore_data={} has_more={} bytes={}", .{ result.isSuccess(), task.shouldIgnoreData(), result.has_more, result.body.?.list.items.len });

            const prev_metadata = locked.shared.result.metadata;
            const prev_cert_info = locked.shared.result.certificate_info;
            locked.shared.result = result;

            // Preserve pending certificate info if it was provided in the previous update.
            if (locked.shared.result.certificate_info == null) {
                if (prev_cert_info) |cert_info| {
                    locked.shared.result.certificate_info = cert_info;
                }
            }

            // metadata should be provided only once
            if (result.metadata orelse prev_metadata) |metadata| {
                log("added callback metadata", .{});
                if (locked.shared.metadata == null) {
                    locked.shared.metadata = metadata;
                }

                locked.shared.result.metadata = null;
            }

            locked.shared.body_size = result.body_size;

            const success = result.isSuccess();
            locked.shared.response_buffer = result.body.?.*;

            // MIGRATION (Phase 7.3): Replaced ignore_data flag with shouldIgnoreData() method call
            // Old: if (task.ignore_data)
            // New: if (task.shouldIgnoreData())
            if (task.shouldIgnoreData()) {
                locked.shared.response_buffer.reset();

                if (locked.shared.scheduled_response_buffer.list.capacity > 0) {
                    locked.shared.scheduled_response_buffer.deinit();
                    locked.shared.scheduled_response_buffer = .{
                        .allocator = bun.default_allocator,
                        .list = .{
                            .items = &.{},
                            .capacity = 0,
                        },
                    };
                }
                if (success and result.has_more) {
                    // we are ignoring the body so we should not receive more data, so will only signal when result.has_more = true
                    // Reset the flag since we're not enqueueing
                    _ = locked.shared.has_schedule_callback.swap(false, .release);
                    return;
                }
            } else {
                if (success) {
                    // Append new data to scheduled response buffer
                    _ = bun.handleOom(locked.shared.scheduled_response_buffer.write(locked.shared.response_buffer.list.items));
                }
                // reset for reuse
                locked.shared.response_buffer.reset();
            }
        }

        // Keep tasklet alive during callback
        task.ref();

        // Enqueue to main thread
        task.main_thread.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(task, FetchTasklet.onProgressUpdate)) catch {
            // VM is shutting down - cannot enqueue
            task.deref();
            task.shared.has_schedule_callback.store(false, .release);
            if (bun.Environment.isDebug) {
                bun.Output.err(
                    "LEAK",
                    "FetchTasklet HTTP callback not enqueued during VM shutdown (addr=0x{x})",
                    .{@intFromPtr(task)},
                );
            }
        };
    }
};

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

const http = bun.http;
const FetchRedirect = http.FetchRedirect;
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
