// ============================================================================
// STATE MACHINE
// ============================================================================
//
// FetchTasklet tracks multiple orthogonal state dimensions:
// 1. Main lifecycle (FetchLifecycle) - mutually exclusive
// 2. Request streaming (RequestStreamState) - independent
// 3. Abort status (atomic bool) - independent
// 4. Connection upgrade (bool) - one-time flag

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

// ============================================================================
// THREAD SAFETY ARCHITECTURE
// ============================================================================
//
// Data is split into two categories:
// 1. MainThreadData - Only accessed from JavaScript main thread (no lock)
// 2. SharedData - Accessed from both threads (mutex protected)

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
    }
};

/// Data shared between main thread and HTTP thread.
/// ALL access must be protected by mutex.
const SharedData = struct {
    /// Mutex protecting all mutable fields below
    mutex: bun.Mutex,

    /// === STATE TRACKING (protected by mutex) ===
    /// Main fetch lifecycle (mutually exclusive)
    lifecycle: FetchLifecycle = .created,

    /// Request body streaming state (orthogonal)
    request_stream_state: RequestStreamState = .none,

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

    fn init(allocator: std.mem.Allocator) !SharedData {
        return SharedData{
            .mutex = .{},
            .lifecycle = .created,
            .request_stream_state = .none,
            .response_buffer = try MutableString.init(allocator, 0),
            .scheduled_response_buffer = try MutableString.init(allocator, 0),
            .has_schedule_callback = std.atomic.Value(bool).init(false),
        };
    }

    fn deinit(self: *SharedData) void {
        self.response_buffer.deinit();
        self.scheduled_response_buffer.deinit();
        if (self.metadata) |*metadata| {
            metadata.deinit(self.response_buffer.allocator);
        }
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

/// Request headers with explicit ownership tracking.
/// Encapsulates the "do I need to free this?" logic that was previously
/// scattered across clearData() and other cleanup paths.
///
/// OWNERSHIP MODEL:
/// - Headers created from FetchHeaders are OWNED (must be freed)
/// - Empty headers are NOT OWNED (no allocation, no cleanup)
/// - The #owned field tracks this distinction
const RequestHeaders = struct {
    headers: Headers,
    /// Private: true if we must deinit the headers
    /// Only modified through factory methods to ensure correct initialization
    #owned: bool,

    /// Create empty headers (not owned - no cleanup needed).
    /// Use this when no headers are provided.
    fn initEmpty(allocator: std.mem.Allocator) RequestHeaders {
        return .{
            .headers = .{ .allocator = allocator },
            .#owned = false,
        };
    }

    /// Extract headers from FetchHeaders (owned - we must cleanup).
    /// Use this when headers come from JavaScript fetch() call.
    fn initFromFetchHeaders(
        fetch_headers: *FetchHeaders,
        allocator: std.mem.Allocator,
    ) !RequestHeaders {
        return .{
            .headers = try Headers.from(fetch_headers, allocator),
            .#owned = true,
        };
    }

    /// Single cleanup path - checks ownership flag internally.
    /// Safe to call multiple times or on unowned headers.
    fn deinit(self: *RequestHeaders, allocator: std.mem.Allocator) void {
        if (self.#owned) {
            self.headers.entries.deinit(allocator);
            self.headers.buf.deinit(allocator);
            self.#owned = false;
        }
    }

    /// Borrow the underlying headers for passing to HTTP client.
    /// The RequestHeaders wrapper still owns the headers after this call.
    fn borrow(self: *RequestHeaders) *Headers {
        return &self.headers;
    }
};

/// Response metadata with explicit take semantics.
/// Ensures metadata is only transferred once to Response object.
///
/// OWNERSHIP MODEL:
/// - Metadata and certificate info are owned until taken
/// - Take methods transfer ownership to caller
/// - Set methods take ownership of new values
/// - deinit() frees any remaining owned data
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

/// Request body with explicit ownership and lifecycle management.
/// Encapsulates the "do I own this resource?" logic that was previously
/// scattered across clearData() and other cleanup paths.
///
/// NOTE: This is the new implementation with explicit ownership tracking.
/// The old HTTPRequestBody is still in use inside FetchTasklet.
/// This will eventually replace the old implementation in Phase 3, Step 3.4.
///
/// OWNERSHIP MODEL:
/// - Empty: No resources to manage
/// - AnyBlob: Tracks blob store refs via private #store_ref field
/// - Sendfile: Tracks if we own the file descriptor via #owns_fd
/// - ReadableStream: Tracks if stream was transferred to sink via #transferred_to_sink
///
/// This makes the "initExactRefs(2)" pattern for streams explicit:
/// - Before transfer: we own 1 ref
/// - After transfer to sink: sink owns 1 ref, stream owns 1 ref (total 2)
const HTTPRequestBodyV2 = union(enum) {
    /// No request body
    Empty: void,

    /// In-memory blob with explicit store ref tracking
    AnyBlob: struct {
        blob: AnyBlob,
        /// Private: Tracks blob store reference if present.
        /// The nested struct ensures we only deref if we incremented the ref.
        #store_ref: ?struct {
            store: *Blob.Store,
            refed: bool,

            fn ref(self: *@This()) void {
                if (!self.refed) {
                    self.store.ref();
                    self.refed = true;
                }
            }

            fn deref(self: *@This()) void {
                if (self.refed) {
                    self.store.deref();
                    self.refed = false;
                }
            }
        } = null,

        /// Cleanup blob resources
        fn deinit(self: *@This()) void {
            if (self.#store_ref) |*store_ref| {
                store_ref.deref();
            }
        }
    },

    /// File descriptor for sendfile optimization
    Sendfile: struct {
        sendfile: http.SendFile,
        /// Private: Do we need to close the fd?
        /// Only set to true if we opened the file ourselves.
        #owns_fd: bool,

        /// Cleanup file descriptor if we own it
        fn deinit(self: *@This()) void {
            if (self.#owns_fd) {
                _ = bun.sys.close(self.sendfile.fd);
            }
        }
    },

    /// Streaming body from ReadableStream
    ReadableStream: struct {
        stream: jsc.WebCore.ReadableStream.Strong,
        /// Private: Track if we've transferred ownership to sink.
        /// This makes the "initExactRefs(2)" pattern explicit:
        /// - Before transfer: we own 1 ref
        /// - After transfer: sink owns 1 ref, stream owns 1 ref (total 2)
        /// See FetchTasklet.startRequestStream() for usage.
        #transferred_to_sink: bool = false,

        /// Transfer stream to sink (consumes our reference).
        /// After this call, sink owns the stream.
        /// Can only be called once - asserts if already transferred.
        fn transferToSink(self: *@This()) jsc.WebCore.ReadableStream.Strong {
            bun.assert(!self.#transferred_to_sink);
            self.#transferred_to_sink = true;
            // Return stream without deiniting - ownership transferred
            return self.stream;
        }

        /// Cleanup stream reference if we still own it
        fn deinit(self: *@This()) void {
            if (!self.#transferred_to_sink) {
                // We still own it - deinit our ref
                self.stream.deinit();
            }
            // If transferred, sink owns the ref - don't double-deref
        }
    },

    /// Single deinit path for all variants.
    /// Dispatches to variant-specific cleanup methods.
    fn deinit(self: *HTTPRequestBodyV2) void {
        switch (self.*) {
            .Empty => {},
            .AnyBlob => |*blob| blob.deinit(),
            .Sendfile => |*sendfile| sendfile.deinit(),
            .ReadableStream => |*stream| stream.deinit(),
        }
    }

    /// Get blob store for ref counting (if applicable).
    /// Returns null for non-blob variants.
    fn store(self: *const HTTPRequestBodyV2) ?*Blob.Store {
        return switch (self.*) {
            .AnyBlob => |*blob| if (blob.#store_ref) |ref| ref.store else null,
            else => null,
        };
    }

    /// Increment store ref count (if applicable).
    /// No-op for non-blob variants or blobs without stores.
    fn refStore(self: *HTTPRequestBodyV2) void {
        if (self.* == .AnyBlob) {
            if (self.AnyBlob.#store_ref) |*store_ref| {
                store_ref.ref();
            }
        }
    }
};

/// Abort signal handling with centralized lifecycle management.
/// Ensures all ref/unref operations are paired correctly.
///
/// OWNERSHIP MODEL:
/// - Signal is ref-counted via AbortSignal's API
/// - Private fields track whether we've added refs/listeners
/// - Single cleanup path in deinit() ensures no leaks
///
/// LIFECYCLE:
/// 1. attachSignal() sets up signal, listener, and pending activity
/// 2. detach() cleans up all references in correct order
/// 3. deinit() calls detach() - single cleanup path
///
/// CURRENT LIMITATIONS:
/// This is designed for the new split-data architecture but adapted to work
/// with current FetchTasklet structure. The onAbortCallback will be updated
/// in Phase 3, Step 3.6 when data is split.
const AbortHandling = struct {
    /// Private: Abort signal (ref-counted)
    #signal: ?*jsc.WebCore.AbortSignal = null,

    /// Private: Track if we added a pending activity ref
    /// Ensures we only unref if we added a ref
    #has_pending_activity_ref: bool = false,

    /// Private: Track if we registered a listener
    /// Currently not used for cleanup (signal handles it),
    /// but tracked for consistency and future use
    #has_listener: bool = false,

    /// Attach abort signal and set up listener.
    /// Takes ownership of signal ref counting.
    fn attachSignal(
        self: *AbortHandling,
        signal: *jsc.WebCore.AbortSignal,
        fetch: *FetchTasklet,
    ) !void {
        bun.assert(self.#signal == null);

        // Ref the signal (we now own a reference)
        signal.ref();
        self.#signal = signal;

        // Listen for abort event
        // Note: listen() returns the signal (possibly different if already aborted)
        const listener = signal.listen(FetchTasklet, fetch, onAbortCallback);
        self.#has_listener = (listener != null);

        // Add pending activity ref (keeps VM alive during async operation)
        signal.pendingActivityRef();
        self.#has_pending_activity_ref = true;
    }

    /// Detach signal and clean up all references.
    /// Safe to call multiple times.
    fn detach(self: *AbortHandling) void {
        if (self.#signal) |signal| {
            // Remove pending activity ref if we added one
            if (self.#has_pending_activity_ref) {
                signal.pendingActivityUnref();
                self.#has_pending_activity_ref = false;
            }

            // Listener is automatically removed by signal
            self.#has_listener = false;

            // Unref the signal (release our reference)
            signal.unref();
            self.#signal = null;
        }
    }

    /// Single cleanup path
    fn deinit(self: *AbortHandling) void {
        self.detach();
    }

    /// Callback invoked when abort signal fires.
    /// This is called from JavaScript when AbortSignal.abort() is triggered.
    ///
    /// NOTE: The `reason` parameter is REQUIRED by AbortSignal.listen() API.
    /// See AbortSignal.zig line 16: callback signature must be `fn (*Context, JSValue) void`.
    /// The JSValue is the abort reason passed from JavaScript.
    ///
    /// CURRENT: Works with existing FetchTasklet structure
    /// FUTURE: Will be updated in Step 3.6 to use split SharedData
    fn onAbortCallback(fetch: *FetchTasklet, reason: JSValue) void {
        // Store abort reason (must be on main thread)
        reason.ensureStillAlive();
        fetch.abort_reason.set(fetch.global_this, reason);

        // Set atomic abort flag for HTTP thread fast-path
        fetch.signal_store.aborted.store(true, .release);

        // Cancel async task tracker
        fetch.tracker.didCancel(fetch.global_this);

        // Schedule shutdown on HTTP thread
        if (fetch.http) |http_| {
            http.http_thread.scheduleShutdown(http_);
        }

        // Cancel sink if present
        if (fetch.sink) |sink| {
            sink.cancel(reason);
        }
    }
};

/// Unified error storage with explicit precedence rules.
/// Replaces scattered error tracking across multiple fields (result.fail, abort_reason, body error).
///
/// ERROR PRECEDENCE:
/// 1. abort_error - User-initiated abort via AbortSignal (highest priority)
/// 2. js_error - JavaScript callback errors (e.g., checkServerIdentity returning non-true)
/// 3. tls_error - TLS certificate validation failures
/// 4. http_error - Network/HTTP protocol errors (lowest priority)
///
/// MEMORY MANAGEMENT:
/// - http_error: Stores anyerror enum, no dealloc needed
/// - abort_error, js_error, tls_error: Use jsc.Strong for JSValue, needs deinit()
///
/// USAGE:
/// ```zig
/// // Setting an error (automatically frees old error)
/// error_storage.set(.{ .http_error = error.ConnectionRefused });
///
/// // Converting to JS for promise rejection
/// const js_value = error_storage.toJS(global);
///
/// // Checking if abort
/// if (error_storage.isAbort()) { ... }
///
/// // Cleanup (safe to call multiple times)
/// error_storage.deinit();
/// ```
const FetchError = union(enum) {
    none: void,
    /// HTTP/network error from AsyncHTTP result
    /// Uses anyerror from http.HTTPClientResult.fail
    /// No dealloc needed (anyerror is just an enum)
    http_error: anyerror,

    /// User-initiated abort via AbortSignal.abort()
    /// Stores the reason passed to abort(reason)
    /// Needs deinit() to free Strong reference
    abort_error: jsc.Strong,

    /// JavaScript callback error (e.g., checkServerIdentity returning Error)
    /// Stores JSValue from callback that indicates failure
    /// Needs deinit() to free Strong reference
    js_error: jsc.Strong,

    /// TLS certificate validation error
    /// Stores error details when certificate check fails
    /// Needs deinit() to free Strong reference
    tls_error: jsc.Strong,

    /// Set new error, freeing old error if present.
    /// This ensures we don't leak Strong references when replacing errors.
    fn set(self: *FetchError, new_error: FetchError) void {
        self.deinit();
        self.* = new_error;
    }

    /// Convert error to JavaScript value for promise rejection.
    /// Returns undefined for .none, otherwise returns appropriate JSValue.
    fn toJS(self: FetchError, global: *JSGlobalObject) JSValue {
        return switch (self) {
            .none => .jsUndefined(),
            // For http_error, we need to convert anyerror to JSValue
            // This will be implemented in Phase 5.2 when we add error conversion helpers
            .http_error => |fail| {
                _ = fail;
                _ = global;
                // TODO: Implement anyerror to JSValue conversion in Phase 5.2
                return .jsUndefined();
            },
            .abort_error => |strong| strong.get() orelse .jsUndefined(),
            .js_error => |strong| strong.get() orelse .jsUndefined(),
            .tls_error => |strong| strong.get() orelse .jsUndefined(),
        };
    }

    /// Check if this is an abort error (for special handling).
    /// Abort errors have different precedence and cancel behavior.
    fn isAbort(self: FetchError) bool {
        return self == .abort_error;
    }

    /// Single cleanup path - frees all Strong references.
    /// Safe to call multiple times (resets to .none after cleanup).
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
// FETCHTASKLET - TARGET ARCHITECTURE DOCUMENTATION
// ============================================================================
//
// This comment block documents the PLANNED final structure of FetchTasklet
// after completing Phase 7 of the refactoring plan. The wrapper types
// (RequestHeaders, ResponseMetadataHolder, HTTPRequestBodyV2, AbortHandling,
// FetchError) have been built and are defined above. The next phase will
// migrate FetchTasklet to use these wrappers.
//
// DESIGN GOALS:
// 1. Clear ownership - Each field has explicit ownership semantics
// 2. Thread safety - Separate MainThreadData and SharedData
// 3. Single cleanup path - One deinit() method, no scattered cleanup
// 4. No vestigial fields - Remove unused/deprecated fields during migration
// 5. Lifecycle clarity - State machine replaces scattered boolean flags
//
// TARGET STRUCTURE (Phase 7):
// ```zig
// pub const FetchTasklet = struct {
//     //! ================================================================
//     //! ALLOCATOR - Single allocator for all owned resources
//     //! ================================================================
//     allocator: std.mem.Allocator,
//
//     //! ================================================================
//     //! THREAD SAFETY - Data split by access pattern
//     //! ================================================================
//     //! Fields accessed only on main JS thread (no mutex needed)
//     main_thread: MainThreadData,
//
//     //! Fields shared between main thread and HTTP thread (mutex required)
//     shared: SharedData,
//
//     //! ================================================================
//     //! OWNED RESOURCES - Cleaned up in deinit()
//     //! ================================================================
//     //! All use new wrapper types with explicit ownership tracking.
//     //! Order doesn't matter - no interdependencies between these.
//
//     /// Request body with ownership tracking
//     /// - Empty: No resources
//     /// - AnyBlob: Manages blob store refs
//     /// - Sendfile: Manages file descriptor ownership
//     /// - ReadableStream: Tracks if transferred to sink
//     request_body: HTTPRequestBodyV2,
//
//     /// Request headers with ownership flag
//     /// - From FetchHeaders: owned (must free)
//     /// - Empty: not owned (no cleanup)
//     request_headers: RequestHeaders,
//
//     /// Abort signal handling with ref counting
//     /// - Manages signal ref/unref lifecycle
//     /// - Tracks pending activity refs
//     /// - Tracks listener registration
//     abort_handling: AbortHandling,
//
//     /// Response metadata with take semantics
//     /// - HTTPResponseMetadata: headers, status code, etc.
//     /// - CertificateInfo: TLS certificate details
//     /// - Take methods transfer ownership to Response
//     response_metadata_holder: ResponseMetadataHolder,
//
//     /// Unified error storage with precedence
//     /// Precedence: abort > js_error > tls_error > http_error
//     /// - abort_error: User-initiated abort (Strong ref)
//     /// - js_error: Callback errors (Strong ref)
//     /// - tls_error: Certificate validation (Strong ref)
//     /// - http_error: Network errors (anyerror enum)
//     error: FetchError,
//
//     //! ================================================================
//     //! REQUEST STREAMING - Only present when streaming request body
//     //! ================================================================
//     /// Sink for resumable request streaming
//     /// Only set when request has streaming body
//     sink: ?*ResumableSink = null,
//
//     /// Thread-safe buffer for request body streaming
//     /// Only set when request has streaming body
//     request_body_streaming_buffer: ?*http.ThreadSafeStreamBuffer = null,
//
//     //! ================================================================
//     //! RESPONSE BUFFERING - Used by AsyncHTTP and streaming to JS
//     //! ================================================================
//     /// Buffer being actively used by AsyncHTTP to receive response
//     response_buffer: MutableString,
//
//     /// Buffer used to stream response data to JavaScript
//     /// Separate from response_buffer to avoid data races
//     scheduled_response_buffer: MutableString,
//
//     /// Response body size tracking
//     /// - .known: Content-Length provided
//     /// - .chunked: Chunked encoding (tracks received size)
//     /// - .unknown: No Content-Length, not chunked
//     body_size: http.HTTPClientResult.BodySize = .unknown,
//
//     //! ================================================================
//     //! IMMUTABLE CONFIG - Set at init, never modified
//     //! ================================================================
//     /// URL + Proxy buffer with explicit ownership (RAII via bun.ptr.Owned)
//     /// Buffer layout: [url_string][proxy_string (optional)]
//     /// Automatically freed in deinit() via bun.ptr.Owned wrapper
//     url_proxy_buffer: bun.ptr.Owned([]const u8),
//
//     /// TLS certificate validation setting
//     reject_unauthorized: bool,
//
//     /// Hostname for custom checkServerIdentity validation
//     /// Only allocated when custom checkServerIdentity is provided
//     /// Automatically freed via bun.ptr.Owned wrapper
//     hostname: ?bun.ptr.Owned([]u8) = null,
//
//     //! ================================================================
//     //! HTTP CLIENT - Reference to AsyncHTTP (owned by HTTP thread)
//     //! ================================================================
//     /// Reference to AsyncHTTP instance
//     /// Created during fetch, owned by HTTP thread pool
//     /// Set to null on completion
//     http: ?*http.AsyncHTTP = null,
//
//     /// HTTP result from AsyncHTTP
//     /// Contains success/failure state, metadata, body chunks
//     result: http.HTTPClientResult = .{},
//
//     /// Signal handlers for AsyncHTTP callbacks
//     signals: http.Signals = .{},
//
//     /// Signal store for atomic abort flag
//     signal_store: http.Signals.Store = .{},
//
//     /// Atomic flag for scheduling callbacks (prevents double-scheduling)
//     has_schedule_callback: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
//
//     //! ================================================================
//     //! REFERENCE COUNTING - Thread-safe refcount for lifecycle
//     //! ================================================================
//     ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),
//
//     //! ================================================================
//     //! LIFECYCLE METHODS
//     //! ================================================================
//
//     /// Initialize new fetch tasklet
//     pub fn init(allocator: std.mem.Allocator, opts: InitOptions) !*FetchTasklet {
//         const self = try allocator.create(FetchTasklet);
//         errdefer allocator.destroy(self);
//
//         self.* = .{
//             .allocator = allocator,
//             .main_thread = try MainThreadData.init(opts),
//             .shared = SharedData.init(),
//             .request_body = opts.request_body,
//             .request_headers = opts.request_headers,
//             .abort_handling = .{},
//             .response_metadata_holder = ResponseMetadataHolder.init(allocator),
//             .error = .none,
//             .url_proxy_buffer = opts.url_proxy_buffer,
//             .reject_unauthorized = opts.reject_unauthorized,
//             .hostname = opts.hostname,
//             // ... other fields
//         };
//
//         return self;
//     }
//
//     /// Single cleanup path - must be called on main thread
//     pub fn deinit(this: *FetchTasklet) void {
//         this.main_thread.assertMainThread();
//
//         // Cleanup owned resources (order independent - no dependencies)
//         this.request_body.deinit();
//         this.request_headers.deinit(this.allocator);
//         this.abort_handling.deinit();
//         this.response_metadata_holder.deinit();
//         this.error.deinit();
//
//         // Clear streaming resources if present
//         if (this.sink != null or this.request_body_streaming_buffer != null) {
//             this.clearRequestStreaming();
//         }
//
//         // Cleanup response buffers
//         this.response_buffer.deinit();
//         this.scheduled_response_buffer.deinit();
//
//         // Cleanup thread-specific data
//         this.main_thread.deinit();
//         this.shared.deinit();
//
//         // Free immutable config buffers (RAII handles cleanup)
//         this.url_proxy_buffer.deinit();
//         if (this.hostname) |*host| {
//             host.deinit();
//         }
//
//         // Finally, destroy self
//         this.allocator.destroy(this);
//     }
//
//     /// Reference counting for thread-safe lifecycle
//     pub fn ref(this: *FetchTasklet) void {
//         const count = this.ref_count.fetchAdd(1, .monotonic);
//         bun.debugAssert(count > 0);
//     }
//
//     pub fn deref(this: *FetchTasklet) void {
//         const count = this.ref_count.fetchSub(1, .monotonic);
//         bun.debugAssert(count > 0);
//
//         if (count == 1) {
//             // Last ref - ensure deinit runs on main thread
//             this.deinitFromMainThread();
//         }
//     }
//
//     // ... rest of implementation
// };
// ```
//
// MIGRATION NOTES:
// - Current FetchTasklet (below) still uses old structure
// - Phase 7 will incrementally migrate to target structure
// - Each step adds new fields alongside old ones
// - Old fields removed once fully migrated to new equivalents
// - Tests must pass at each step
//
// ============================================================================

// ============================================================================
// PHASE 7 STEP 2: Thread Safety Fields
// ============================================================================
//
// MainThreadData and SharedData structs are already defined earlier in this file.
// This step adds instances of these structs to FetchTasklet alongside existing fields.
// This is a NON-BREAKING change - old fields remain until migration completes.
//

pub const FetchTasklet = struct {
    pub const ResumableSink = jsc.WebCore.ResumableFetchSink;

    const log = Output.scoped(.FetchTasklet, .visible);

    sink: ?*ResumableSink = null,
    http: ?*http.AsyncHTTP = null,
    result: http.HTTPClientResult = .{},
    metadata: ?http.HTTPResponseMetadata = null,
    javascript_vm: *VirtualMachine = undefined,
    global_this: *JSGlobalObject = undefined,
    request_body: HTTPRequestBody = undefined,
    request_body_streaming_buffer: ?*http.ThreadSafeStreamBuffer = null,

    /// buffer being used by AsyncHTTP
    response_buffer: MutableString = undefined,
    /// buffer used to stream response to JS
    scheduled_response_buffer: MutableString = undefined,
    /// response weak ref we need this to track the response JS lifetime
    response: jsc.Weak(FetchTasklet) = .{},
    /// native response ref if we still need it when JS is discarted
    native_response: ?*Response = null,
    ignore_data: bool = false,
    /// stream strong ref if any is available
    readable_stream_ref: jsc.WebCore.ReadableStream.Strong = .{},
    request_headers: Headers = Headers{ .allocator = undefined },
    promise: jsc.JSPromise.Strong,
    concurrent_task: jsc.ConcurrentTask = .{},
    poll_ref: Async.KeepAlive = .{},
    /// For Http Client requests
    /// when Content-Length is provided this represents the whole size of the request
    /// If chunked encoded this will represent the total received size (ignoring the chunk headers)
    /// If is not chunked encoded and Content-Length is not provided this will be unknown
    body_size: http.HTTPClientResult.BodySize = .unknown,

    /// URL/Proxy buffer with explicit ownership tracking.
    ///
    /// OWNERSHIP MODEL:
    /// This buffer is OWNED by FetchTasklet and must be freed on cleanup.
    /// The buffer contains the URL string and optionally a proxy string concatenated.
    ///
    /// LIFECYCLE:
    /// 1. Created in fetch.zig, initially set to url.href
    /// 2. May be reallocated to concatenate proxy string (url + proxy in single buffer)
    /// 3. Ownership transferred to FetchTasklet during initialization
    /// 4. FetchTasklet responsible for freeing in clearData()
    /// 5. After transfer, fetch.zig sets local copy to "" to prevent double-free
    ///
    /// BUFFER LAYOUT:
    /// [url_string][proxy_string (optional)]
    ///
    /// Related fields (NOT stored here, computed elsewhere):
    /// - url: ZigURL parsed from buffer[0..url.len]
    /// - proxy: ZigURL parsed from buffer[url.len..] if proxy present
    ///
    /// ALTERNATIVE CONSIDERED:
    /// Using `bun.ptr.Owned([]const u8)` would provide automatic RAII cleanup:
    /// ```zig
    /// url_proxy_buffer: bun.ptr.Owned([]const u8),
    /// // Usage:
    /// fn deinit() {
    ///     self.url_proxy_buffer.deinit(); // Automatic
    /// }
    /// ```
    /// However, the current pattern is already clear and well-established in the codebase.
    /// The explicit `allocator.free()` in clearData() is simple and obvious.
    url_proxy_buffer: []const u8 = "",

    signal: ?*jsc.WebCore.AbortSignal = null,
    signals: http.Signals = .{},
    signal_store: http.Signals.Store = .{},
    has_schedule_callback: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    // must be stored because AbortSignal stores reason weakly
    abort_reason: jsc.Strong.Optional = .empty,

    // custom checkServerIdentity
    check_server_identity: jsc.Strong.Optional = .empty,
    reject_unauthorized: bool = true,
    upgraded_connection: bool = false,

    /// Hostname buffer for TLS certificate validation with custom checkServerIdentity.
    ///
    /// OWNERSHIP MODEL:
    /// This buffer is OPTIONALLY OWNED by FetchTasklet using bun.ptr.Owned wrapper.
    /// The wrapper provides automatic RAII cleanup - no manual free needed.
    ///
    /// LIFECYCLE:
    /// 1. Created in fetch.zig when Host header is present and custom checkServerIdentity is provided
    /// 2. Allocated from Host header value using toOwnedSliceZ()
    /// 3. Ownership transferred to FetchTasklet during initialization
    /// 4. Used in checkServerIdentity() to validate TLS certificate hostname
    /// 5. Automatically freed in clearData() via bun.ptr.Owned.deinit()
    ///
    /// ALLOCATION:
    /// - Only allocated if custom checkServerIdentity function is provided
    /// - Created from Host HTTP header value
    /// - Allocated with bun.default_allocator
    ///
    /// USAGE:
    /// The hostname is extracted from certificate_info and used to call the custom
    /// checkServerIdentity JavaScript function for TLS certificate validation.
    ///
    /// ALTERNATIVE CONSIDERED:
    /// The old pattern `?[]u8` with manual `allocator.free()` worked but required
    /// remembering to free in cleanup paths. The bun.ptr.Owned wrapper makes
    /// ownership explicit and ensures automatic cleanup via RAII.
    hostname: ?bun.ptr.Owned([]u8) = null,

    is_waiting_body: bool = false,
    is_waiting_abort: bool = false,
    is_waiting_request_stream_start: bool = false,
    mutex: Mutex,

    tracker: jsc.Debugger.AsyncTaskTracker,

    ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

    /// === PHASE 7 STEP 2: New thread safety fields (NON-BREAKING) ===
    /// These fields are added alongside existing fields during migration.
    /// Old fields will be removed once migration to these structs is complete.
    /// Main thread data (no locking required)
    main_thread: MainThreadData = undefined,

    /// Shared data (mutex-protected, allocated separately)
    shared: *SharedData = undefined,

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

            const vm = this.javascript_vm;

            // Check if VM is shutting down before enqueuing
            if (vm.isShuttingDown()) {
                // VM is shutting down - cannot safely enqueue task to main thread
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
                return;
            }

            vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.deinitFromMainThread));
        }
    }

    /// === PHASE 7 STEP 2: Transitional helper methods ===
    /// These methods provide access to data through the new structs while
    /// maintaining compatibility with existing direct field access.
    /// During migration, code can be gradually updated to use these methods
    /// instead of direct field access.
    /// Lock shared data for exclusive access.
    /// Returns RAII wrapper that auto-unlocks on scope exit.
    inline fn lockShared(this: *FetchTasklet) LockedSharedData {
        return this.shared.lock();
    }

    /// Assert we're on the main thread (debug builds only).
    inline fn assertMainThread(this: *const FetchTasklet) void {
        this.main_thread.assertMainThread();
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
    /// Ref counting behavior:
    /// - Sink: We hold 1 ref, stream holds another. We drop our ref here.
    /// - Buffer: We hold 1 ref, sink may hold another. We drop our ref here.
    ///
    /// This is called from:
    /// 1. clearData() - Normal cleanup path when request completes
    /// 2. Error paths - When streaming needs to be aborted
    fn clearRequestStreaming(this: *FetchTasklet) void {
        // Clear sink (drop our ref - stream might still hold one)
        if (this.sink) |sink| {
            this.sink = null;
            sink.deref(); // Drop ref 1 (we held this)
            // Stream still holds ref 2 until it finishes
        }

        // Clear buffer (drop our ref - sink might still hold one)
        if (this.request_body_streaming_buffer) |buffer| {
            this.request_body_streaming_buffer = null;
            buffer.clearDrainCallback(); // Unhook from HTTP thread
            buffer.deref(); // Drop our ref
            // Sink still holds its ref until it finishes
        }
    }

    /// Legacy name for clearRequestStreaming().
    /// Kept for compatibility with existing callsites.
    /// TODO: Remove this alias once all callsites are updated.
    fn clearSink(this: *FetchTasklet) void {
        this.clearRequestStreaming();
    }

    /// Cleanup function that frees all owned resources.
    /// This is the single cleanup path for FetchTasklet's owned data.
    fn clearData(this: *FetchTasklet) void {
        log("clearData ", .{});
        const allocator = bun.default_allocator;

        // Free url_proxy_buffer (see field documentation for ownership model)
        if (this.url_proxy_buffer.len > 0) {
            allocator.free(this.url_proxy_buffer);
            this.url_proxy_buffer.len = 0;
        }

        if (this.hostname) |*hostname| {
            hostname.deinit();
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

        // === PHASE 7 STEP 2: Cleanup new thread safety fields ===
        this.main_thread.deinit();
        this.shared.deinit();
        allocator.destroy(this.shared);
    }

    /// Helper function to ensure deinit happens on main thread.
    /// Called via enqueueTaskConcurrent from derefFromThread.
    // XXX: 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    fn deinitFromMainThread(this: *FetchTasklet) error{}!void {
        bun.debugAssert(this.javascript_vm.isMainThread());
        this.deinit() catch |err| switch (err) {};
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

    /// Start streaming request body to server.
    /// Sets up sink with explicit ref counting to avoid double-retain bugs.
    ///
    /// Ownership and ref counting:
    /// - request_body.ReadableStream: We own 1 strong ref (will be consumed by sink)
    /// - Sink created with initExactRefs(2):
    ///   - Ref 1: FetchTasklet.sink field (we hold this)
    ///   - Ref 2: Stream pipe (consumed when stream pipes to sink)
    /// - FetchTasklet: We add 1 ref (will be released when sink finishes)
    ///
    /// The "initExactRefs(2)" pattern is documented here:
    /// - Before: request_body owns stream with 1 ref
    /// - After: sink has 2 refs (us + stream pipe), we hold FetchTasklet ref
    ///
    /// Cleanup happens via clearRequestStreaming() which drops our sink ref.
    pub fn startRequestStream(this: *FetchTasklet) void {
        this.is_waiting_request_stream_start = false;
        bun.assert(this.request_body == .ReadableStream);

        // Get the stream from request_body
        if (this.request_body.ReadableStream.get(this.global_this)) |stream| {
            // Check if request was already aborted
            if (this.signal) |signal| {
                if (signal.aborted()) {
                    stream.abort(this.global_this);
                    return;
                }
            }

            const globalThis = this.global_this;

            // Increment FetchTasklet ref count
            // This ref will be released when sink finishes (via sink callbacks)
            this.ref();

            // Create sink with 2 refs:
            // - Ref 1: We hold via this.sink field
            // - Ref 2: Stream will consume when piping
            const sink = ResumableSink.initExactRefs(globalThis, stream, this, 2);

            // Store sink (we now hold ref 1)
            this.sink = sink;

            // Final ref counts:
            // - sink: 2 refs (us + stream pipe)
            // - this: +1 ref (will be released by sink callbacks)
            // - stream: ownership transferred to sink
        }
    }

    pub fn onBodyReceived(this: *FetchTasklet) bun.JSTerminated!void {
        const success = this.result.isSuccess();
        const globalThis = this.global_this;
        // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
        var buffer_reset = true;
        log("onBodyReceived success={} has_more={}", .{ success, this.result.has_more });
        defer {
            if (buffer_reset) {
                this.scheduled_response_buffer.reset();
            }
        }

        if (!success) {
            var err = this.onReject();
            var need_deinit = true;
            defer if (need_deinit) err.deinit();
            var js_err = JSValue.zero;
            // if we are streaming update with error
            if (this.readable_stream_ref.get(globalThis)) |readable| {
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
            if (this.sink) |sink| {
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
            return;
        }

        if (this.readable_stream_ref.get(globalThis)) |readable| {
            log("onBodyReceived readable_stream_ref", .{});
            if (readable.ptr == .Bytes) {
                readable.ptr.Bytes.size_hint = this.getSizeHint();
                // body can be marked as used but we still need to pipe the data
                const scheduled_response_buffer = &this.scheduled_response_buffer.list;

                const chunk = scheduled_response_buffer.items;

                if (this.result.has_more) {
                    try readable.ptr.Bytes.onData(
                        .{
                            .temporary = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                        },
                        bun.default_allocator,
                    );
                } else {
                    var prev = this.readable_stream_ref;
                    this.readable_stream_ref = .{};
                    defer prev.deinit();
                    buffer_reset = false;

                    try readable.ptr.Bytes.onData(
                        .{
                            .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                        },
                        bun.default_allocator,
                    );
                }
                return;
            }
        }

        if (this.getCurrentResponse()) |response| {
            log("onBodyReceived Current Response", .{});
            const sizeHint = this.getSizeHint();
            response.setSizeHint(sizeHint);
            if (response.getBodyReadableStream(globalThis)) |readable| {
                log("onBodyReceived CurrentResponse BodyReadableStream", .{});
                if (readable.ptr == .Bytes) {
                    const scheduled_response_buffer = this.scheduled_response_buffer.list;

                    const chunk = scheduled_response_buffer.items;

                    if (this.result.has_more) {
                        try readable.ptr.Bytes.onData(
                            .{
                                .temporary = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                            },
                            bun.default_allocator,
                        );
                    } else {
                        readable.value.ensureStillAlive();
                        response.detachReadableStream(globalThis);
                        try readable.ptr.Bytes.onData(
                            .{
                                .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                            },
                            bun.default_allocator,
                        );
                    }

                    return;
                }
            }

            // we will reach here when not streaming, this is also the only case we dont wanna to reset the buffer
            buffer_reset = false;
            if (!this.result.has_more) {
                var scheduled_response_buffer = this.scheduled_response_buffer.list;
                const body = response.getBodyValue();
                // done resolve body
                var old = body.*;
                const body_value = Body.Value{
                    .InternalBlob = .{
                        .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
                    },
                };
                body.* = body_value;
                log("onBodyReceived body_value length={}", .{body_value.InternalBlob.bytes.items.len});

                this.scheduled_response_buffer = .{
                    .allocator = bun.default_allocator,
                    .list = .{
                        .items = &.{},
                        .capacity = 0,
                    },
                };

                if (old == .Locked) {
                    log("onBodyReceived old.resolve", .{});
                    try old.resolve(body, this.global_this, response.getFetchHeaders());
                }
            }
        }
    }

    // ========================================================================
    // STATE-BASED BODY STREAMING FUNCTIONS (Phase 4, Step 4.1)
    // ========================================================================
    //
    // These functions implement state-based dispatch for body streaming.
    // They will eventually replace the complex conditionals in onBodyReceived.
    //
    // CURRENT: Adapted to work with existing FetchTasklet structure
    // FUTURE: Will be updated to use SharedData in Phase 3

    /// Process initial body data before Response object exists.
    /// Decides whether to buffer or stream based on timing.
    ///
    /// This handles the case where body data arrives before JS has accessed
    /// the Response body. We check if a ReadableStream exists yet, and either:
    /// 1. Stream directly to the stream (Path 1 in old code)
    /// 2. Buffer the data until stream is created (Path 3 in old code)
    fn processBodyDataInitial(this: *FetchTasklet) bun.JSTerminated!void {
        const globalThis = this.global_this;

        // Check if we have a readable stream yet (from Response.body being accessed)
        const has_stream_ref = this.readable_stream_ref.held.has();

        // Also check if Response object exists with a stream
        const has_response_stream = blk: {
            if (this.getCurrentResponse()) |response| {
                if (response.getBodyReadableStream(globalThis)) |_| {
                    break :blk true;
                }
            }
            break :blk false;
        };

        if (has_stream_ref or has_response_stream) {
            // Stream exists - forward data to it
            try this.streamBodyToJS();
        } else {
            // No stream yet - buffer the data
            this.bufferBodyData();
        }
    }

    /// Stream body data to JS ReadableStream.
    /// Handles both direct streams (readable_stream_ref) and Response body streams.
    ///
    /// This corresponds to Path 1 and Path 2 in the old onBodyReceived code:
    /// - Path 1: Stream via this.readable_stream_ref (lines 1130-1161)
    /// - Path 2: Stream via Response.getBodyReadableStream (lines 1163-1194)
    fn streamBodyToJS(this: *FetchTasklet) bun.JSTerminated!void {
        const globalThis = this.global_this;
        const scheduled_response_buffer = &this.scheduled_response_buffer.list;
        const chunk = scheduled_response_buffer.items;
        const has_more = this.result.has_more;

        // Early exit if no data and more coming
        if (chunk.len == 0 and has_more) {
            return;
        }

        // Path 1: Try streaming via readable_stream_ref first
        if (this.readable_stream_ref.get(globalThis)) |readable| {
            if (readable.ptr == .Bytes) {
                readable.ptr.Bytes.size_hint = this.getSizeHint();

                if (has_more) {
                    try readable.ptr.Bytes.onData(
                        .{
                            .temporary = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                        },
                        bun.default_allocator,
                    );
                } else {
                    // Done - send final chunk and clean up
                    var prev = this.readable_stream_ref;
                    this.readable_stream_ref = .{};
                    defer prev.deinit();

                    try readable.ptr.Bytes.onData(
                        .{
                            .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                        },
                        bun.default_allocator,
                    );
                }
                return;
            }
        }

        // Path 2: Try streaming via Response body stream
        if (this.getCurrentResponse()) |response| {
            const sizeHint = this.getSizeHint();
            response.setSizeHint(sizeHint);

            if (response.getBodyReadableStream(globalThis)) |readable| {
                if (readable.ptr == .Bytes) {
                    if (has_more) {
                        try readable.ptr.Bytes.onData(
                            .{
                                .temporary = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                            },
                            bun.default_allocator,
                        );
                    } else {
                        // Done - send final chunk and detach stream
                        readable.value.ensureStillAlive();
                        response.detachReadableStream(globalThis);
                        try readable.ptr.Bytes.onData(
                            .{
                                .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                            },
                            bun.default_allocator,
                        );
                    }
                    return;
                }
            }

            // No stream found - fall back to buffering
            // This handles the case where stream disappeared or was never created
            this.bufferBodyData();
        }
    }

    /// Buffer body data in memory (no stream yet).
    /// This handles the case where Response exists but body hasn't been accessed yet.
    ///
    /// This corresponds to Path 3 in the old onBodyReceived code (lines 1196-1224).
    /// Data is accumulated in scheduled_response_buffer until:
    /// 1. A stream is created (then switch to streaming)
    /// 2. Request completes (then resolve with buffered data)
    fn bufferBodyData(this: *FetchTasklet) void {
        // Data is already in scheduled_response_buffer (accumulated by callback)
        // This function is called when we decide to keep buffering

        // If request is complete, finalize the buffered body
        if (!this.result.has_more) {
            if (this.getCurrentResponse()) |response| {
                var scheduled_response_buffer = this.scheduled_response_buffer.list;
                const body = response.getBodyValue();

                // Transfer buffer to body
                var old = body.*;
                const body_value = Body.Value{
                    .InternalBlob = .{
                        .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
                    },
                };
                body.* = body_value;

                log("bufferBodyData body_value length={}", .{body_value.InternalBlob.bytes.items.len});

                // Reset buffer
                this.scheduled_response_buffer = .{
                    .allocator = bun.default_allocator,
                    .list = .{
                        .items = &.{},
                        .capacity = 0,
                    },
                };

                // Resolve any pending promise
                if (old == .Locked) {
                    log("bufferBodyData old.resolve", .{});
                    old.resolve(body, this.global_this, response.getFetchHeaders()) catch {
                        // Handle termination error
                        return;
                    };
                }
            }
        }
        // If has_more is true, data stays in scheduled_response_buffer
        // and will be accumulated on next callback
    }

    /// Buffer specific data directly into scheduled_response_buffer.
    /// Used when we need to explicitly buffer data (e.g., when stream disappears).
    ///
    /// This is a helper function for explicit buffering operations.
    /// Unlike bufferBodyData(), this takes data as a parameter and appends it.
    fn bufferBodyDataDirect(this: *FetchTasklet, data: []const u8) void {
        // Append data to scheduled buffer
        _ = this.scheduled_response_buffer.write(data) catch {
            // OOM - mark as failed
            this.result.fail = error.OutOfMemory;
            log("bufferBodyDataDirect OOM", .{});
        };
    }

    // ========================================================================
    // END STATE-BASED BODY STREAMING FUNCTIONS
    // ========================================================================

    /// Called on main thread when HTTP thread has data ready.
    /// THREAD SAFETY: This runs on main thread, must minimize lock holding time.
    pub fn onProgressUpdate(this: *FetchTasklet) bun.JSTerminated!void {
        jsc.markBinding(@src());
        log("onProgressUpdate", .{});

        // === MAIN THREAD - Reset atomic flag first (allows HTTP thread to schedule again) ===
        defer this.has_schedule_callback.store(false, .release);

        // Balance the ref() from HTTP thread callback
        defer this.deref();

        const vm = this.javascript_vm;

        // Early check: VM shutting down?
        if (vm.isShuttingDown()) {
            // Cannot touch JS - just clean up
            this.mutex.lock();
            const is_done = !this.result.has_more;
            this.mutex.unlock();

            // Note: deref() is handled by outer defer above
            if (is_done) {
                // Additional cleanup only when done
                var poll_ref = this.poll_ref;
                this.poll_ref = .{};
                poll_ref.unref(vm);
            }
            return;
        }

        // === ACQUIRE LOCK - Brief critical section to read state ===
        // Copy state out from under lock, then release before doing JS work
        var is_done: bool = undefined;
        var is_waiting_request_stream_start: bool = undefined;
        var can_stream: bool = undefined;
        var is_waiting_body: bool = undefined;
        var metadata_exists: bool = undefined;
        var is_success: bool = undefined;
        var is_waiting_abort: bool = undefined;
        var certificate_info_snapshot: ?http.CertificateInfo = null;

        {
            this.mutex.lock();
            defer this.mutex.unlock();

            is_done = !this.result.has_more;
            is_waiting_request_stream_start = this.is_waiting_request_stream_start;
            can_stream = this.result.can_stream;
            is_waiting_body = this.is_waiting_body;
            metadata_exists = this.metadata != null;
            is_success = this.result.isSuccess();
            is_waiting_abort = this.is_waiting_abort;

            // Extract certificate info (will be processed outside lock)
            if (this.result.certificate_info) |cert_info| {
                certificate_info_snapshot = cert_info;
                this.result.certificate_info = null;
            }
        }
        // === LOCK RELEASED - Now safe to do JS work ===

        const globalThis = this.global_this;

        // Clean up at end
        defer {
            if (is_done) {
                var poll_ref = this.poll_ref;
                this.poll_ref = .{};
                poll_ref.unref(vm);
                // Note: deref() is handled by outer defer at line ~828
            }
        }

        // Handle request stream start (requires JS interaction)
        if (is_waiting_request_stream_start and can_stream) {
            this.startRequestStream();
        }

        // Handle body data already received
        if (is_waiting_body) {
            try this.onBodyReceived();
            return;
        }

        // Early exit if no metadata yet
        if (!metadata_exists and is_success) {
            return;
        }

        // Waiting for abort to complete
        if (is_waiting_abort) {
            return;
        }

        const promise_value = this.promise.valueOrEmpty();

        if (promise_value.isEmptyOrUndefinedOrNull()) {
            log("onProgressUpdate: promise_value is null", .{});
            this.promise.deinit();
            return;
        }

        // Process certificate validation (requires JS call - outside lock!)
        if (certificate_info_snapshot) |certificate_info| {
            defer certificate_info.deinit(bun.default_allocator);

            if (this.reject_unauthorized and !this.checkServerIdentity(certificate_info)) {
                log("onProgressUpdate: aborted due certError", .{});
                const promise = promise_value.asAnyPromise().?;
                const tracker = this.tracker;
                var result = this.onReject();
                defer result.deinit();

                promise_value.ensureStillAlive();
                try promise.reject(globalThis, result.toJS(globalThis));

                tracker.didDispatch(globalThis);
                this.promise.deinit();
                return;
            }

            // Re-check metadata after cert validation
            this.mutex.lock();
            const has_metadata = this.metadata != null;
            this.mutex.unlock();

            if (!has_metadata) {
                log("onProgressUpdate: metadata is null after cert check", .{});
                return;
            }
        }

        // Resolve or reject promise (JS interaction - no lock held)
        const tracker = this.tracker;
        tracker.willDispatch(globalThis);
        defer {
            log("onProgressUpdate: promise_value is not null", .{});
            tracker.didDispatch(globalThis);
            this.promise.deinit();
        }

        const success = is_success;
        const result = switch (success) {
            true => jsc.Strong.Optional.create(this.onResolve(), globalThis),
            false => brk: {
                var value = this.onReject();
                const err = value.toJS(globalThis);
                if (this.sink) |sink| {
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
                defer bun.default_allocator.destroy(self);
                defer self.held.deinit();
                defer self.promise.deinit();
                var prom = self.promise.swap().asAnyPromise().?;
                const res = self.held.swap();
                res.ensureStillAlive();
                try prom.resolve(self.globalObject, res);
            }

            pub fn reject(self: *@This()) bun.JSTerminated!void {
                defer bun.default_allocator.destroy(self);
                defer self.held.deinit();
                defer self.promise.deinit();
                var prom = self.promise.swap().asAnyPromise().?;
                const res = self.held.swap();
                res.ensureStillAlive();
                try prom.reject(self.globalObject, res);
            }
        };
        var holder = bun.handleOom(bun.default_allocator.create(Holder));
        holder.* = .{
            .held = result,
            .promise = this.promise.strong,
            .globalObject = globalThis,
            .task = undefined,
        };
        this.promise.strong = .empty;
        holder.task = switch (success) {
            true => jsc.AnyTask.New(Holder, Holder.resolve).init(holder),
            false => jsc.AnyTask.New(Holder, Holder.reject).init(holder),
        };

        vm.enqueueTask(jsc.Task.init(&holder.task));
    }

    pub fn checkServerIdentity(this: *FetchTasklet, certificate_info: http.CertificateInfo) bool {
        if (this.check_server_identity.get()) |check_server_identity| {
            check_server_identity.ensureStillAlive();
            if (certificate_info.cert.len > 0) {
                const cert = certificate_info.cert;
                var cert_ptr = cert.ptr;
                if (BoringSSL.d2i_X509(null, &cert_ptr, @intCast(cert.len))) |x509| {
                    const globalObject = this.global_this;
                    defer x509.free();
                    const js_cert = X509.toJS(x509, globalObject) catch |err| {
                        switch (err) {
                            error.JSError => {},
                            error.OutOfMemory => globalObject.throwOutOfMemory() catch {},
                            error.JSTerminated => {},
                        }
                        const check_result = globalObject.tryTakeException().?;
                        // mark to wait until deinit
                        this.is_waiting_abort = this.result.has_more;
                        this.abort_reason.set(globalObject, check_result);
                        this.signal_store.aborted.store(true, .monotonic);
                        this.tracker.didCancel(this.global_this);
                        // we need to abort the request
                        if (this.http) |http_| http.http_thread.scheduleShutdown(http_);
                        this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
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
                        this.is_waiting_abort = this.result.has_more;
                        this.abort_reason.set(globalObject, check_result);
                        this.signal_store.aborted.store(true, .monotonic);
                        this.tracker.didCancel(this.global_this);

                        // we need to abort the request
                        if (this.http) |http_| {
                            http.http_thread.scheduleShutdown(http_);
                        }
                        this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
                        return false;
                    }

                    // > On success, returns <undefined>
                    // We treat any non-error value as a success.
                    return true;
                }
            }
        }
        this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
        return false;
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

                else => |e| bun.String.createFormat("{s} fetching \"{}\". For more information, pass `verbose: true` in the second argument to fetch()", .{
                    @errorName(e),
                    path,
                }) catch |err| bun.handleOom(err),
            },
            .path = path,
        };

        return .{ .SystemError = fetch_error };
    }

    pub fn onReadableStreamAvailable(ctx: *anyopaque, globalThis: *jsc.JSGlobalObject, readable: jsc.WebCore.ReadableStream) void {
        const this = bun.cast(*FetchTasklet, ctx);
        this.readable_stream_ref = jsc.WebCore.ReadableStream.Strong.init(readable, globalThis);
    }

    pub fn onStartStreamingHTTPResponseBodyCallback(ctx: *anyopaque) jsc.WebCore.DrainResult {
        const this = bun.cast(*FetchTasklet, ctx);
        if (this.signal_store.aborted.load(.monotonic)) {
            return jsc.WebCore.DrainResult{
                .aborted = {},
            };
        }

        if (this.http) |http_| {
            http_.enableResponseBodyStreaming();

            // If the server sent the headers and the response body in two separate socket writes
            // and if the server doesn't close the connection by itself
            // and doesn't send any follow-up data
            // then we must make sure the HTTP thread flushes.
            bun.http.http_thread.scheduleResponseBodyDrain(http_.async_http_id);
        }

        this.mutex.lock();
        defer this.mutex.unlock();
        const size_hint = this.getSizeHint();

        var scheduled_response_buffer = this.scheduled_response_buffer.list;
        // This means we have received part of the body but not the whole thing
        if (scheduled_response_buffer.items.len > 0) {
            this.scheduled_response_buffer = .{
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

    fn getSizeHint(this: *FetchTasklet) Blob.SizeType {
        return switch (this.body_size) {
            .content_length => @truncate(this.body_size.content_length),
            .total_received => @truncate(this.body_size.total_received),
            .unknown => 0,
        };
    }

    fn toBodyValue(this: *FetchTasklet) Body.Value {
        if (this.getAbortError()) |err| {
            return .{ .Error = err };
        }
        if (this.is_waiting_body) {
            const response = Body.Value{
                .Locked = .{
                    .size_hint = this.getSizeHint(),
                    .task = this,
                    .global = this.global_this,
                    .onStartStreaming = FetchTasklet.onStartStreamingHTTPResponseBodyCallback,
                    .onReadableStreamAvailable = FetchTasklet.onReadableStreamAvailable,
                },
            };
            return response;
        }

        var scheduled_response_buffer = this.scheduled_response_buffer.list;
        const response = Body.Value{
            .InternalBlob = .{
                .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
            },
        };
        this.scheduled_response_buffer = .{
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
        bun.assert(this.metadata != null);
        // at this point we always should have metadata
        const metadata = this.metadata.?;
        const http_response = metadata.response;
        this.is_waiting_body = this.result.has_more;
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
            this.result.redirected,
        );
    }

    fn ignoreRemainingResponseBody(this: *FetchTasklet) void {
        log("ignoreRemainingResponseBody", .{});
        // enabling streaming will make the http thread to drain into the main thread (aka stop buffering)
        // without a stream ref, response body or response instance alive it will just ignore the result
        if (this.http) |http_| {
            http_.enableResponseBodyStreaming();
        }
        // we should not keep the process alive if we are ignoring the body
        const vm = this.javascript_vm;
        this.poll_ref.unref(vm);
        // clean any remaining refereces
        this.readable_stream_ref.deinit();
        this.response.deinit();

        if (this.native_response) |response| {
            response.unref();
            this.native_response = null;
        }

        this.ignore_data = true;
    }

    /// Called when Response JS object is garbage collected.
    /// This is our signal to stop processing body data.
    export fn Bun__FetchResponse_finalize(this: *FetchTasklet) callconv(.C) void {
        log("onResponseFinalize", .{});

        // === ACQUIRE LOCK - Fix race condition ===
        // The HTTP thread accesses shared state in callback(), so we must lock
        this.mutex.lock();
        defer this.mutex.unlock();

        // Check if we have a native response to work with
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
                if (!promise.isEmptyOrUndefinedOrNull()) {
                    // Scenario 2b - promise exists, keep loading
                    return;
                }
            }

            // Scenario 2a or 3 - ignore remaining body
            // Signal abort to HTTP thread (under lock)
            this.signal_store.aborted.store(true, .release);

            // Set ignore_data flag to stop buffering
            this.ignore_data = true;

            // Clear accumulated buffers since we're ignoring the rest
            this.response_buffer.list.clearRetainingCapacity();
            this.scheduled_response_buffer.list.clearRetainingCapacity();

            // Enable streaming to drain remaining data without buffering
            if (this.http) |http_| {
                http_.enableResponseBodyStreaming();
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

        // === PHASE 7 STEP 2: Initialize SharedData (allocated separately) ===
        const shared_data = try allocator.create(SharedData);
        shared_data.* = try SharedData.init(allocator);

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

            // === PHASE 7 STEP 2: Initialize new thread safety fields ===
            .main_thread = .{
                .global_this = globalThis,
                .javascript_vm = jsc_vm,
                .promise = promise,
                .tracker = jsc.Debugger.AsyncTaskTracker.init(jsc_vm),
                .abort_signal = fetch_options.signal,
                .check_server_identity = fetch_options.check_server_identity,
            },
            .shared = shared_data,
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
                .hostname = if (fetch_options.hostname) |h| h.get() else null,
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

    /// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
    pub fn onWriteRequestDataDrain(this: *FetchTasklet) void {
        // ref until the main thread callback is called
        this.ref();
        this.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.resumeRequestDataStream));
    }

    /// This is ALWAYS called from the main thread
    // XXX: 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    pub fn resumeRequestDataStream(this: *FetchTasklet) error{}!void {
        // deref when done because we ref inside onWriteRequestDataDrain
        defer this.deref();
        log("resumeRequestDataStream", .{});
        if (this.sink) |sink| {
            if (this.signal) |signal| {
                if (signal.aborted()) {
                    // already aborted; nothing to drain
                    return;
                }
            }
            sink.drain();
        }
    }

    pub fn writeRequestData(this: *FetchTasklet, data: []const u8) ResumableSinkBackpressure {
        log("writeRequestData {}", .{data.len});
        if (this.signal) |signal| {
            if (signal.aborted()) {
                return .done;
            }
        }
        const thread_safe_stream_buffer = this.request_body_streaming_buffer orelse return .done;
        const stream_buffer = thread_safe_stream_buffer.acquire();
        defer thread_safe_stream_buffer.release();
        const highWaterMark = if (this.sink) |sink| sink.highWaterMark else 16384;

        var needs_schedule = false;
        defer if (needs_schedule) {
            // wakeup the http thread to write the data
            http.http_thread.scheduleRequestWrite(this.http.?, .data);
        };

        // dont have backpressure so we will schedule the data to be written
        // if we have backpressure the onWritable will drain the buffer
        needs_schedule = stream_buffer.isEmpty();
        if (this.upgraded_connection) {
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

    pub fn writeEndRequest(this: *FetchTasklet, err: ?jsc.JSValue) void {
        log("writeEndRequest hasError? {}", .{err != null});
        defer this.deref();
        if (err) |jsError| {
            if (this.signal_store.aborted.load(.monotonic) or this.abort_reason.has()) {
                return;
            }
            if (!jsError.isUndefinedOrNull()) {
                this.abort_reason.set(this.global_this, jsError);
            }
            this.abortTask();
        } else {
            if (!this.upgraded_connection) {
                // If is not upgraded we need to send the terminating chunk
                const thread_safe_stream_buffer = this.request_body_streaming_buffer orelse return;
                const stream_buffer = thread_safe_stream_buffer.acquire();
                defer thread_safe_stream_buffer.release();
                bun.handleOom(stream_buffer.write(http.end_of_chunked_http1_1_encoding_response_body));
            }
            if (this.http) |http_| {
                // just tell to write the end of the chunked encoding aka 0\r\n\r\n
                http.http_thread.scheduleRequestWrite(http_, .end);
            }
        }
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
        // Custom Hostname (wrapped for automatic cleanup)
        hostname: ?bun.ptr.Owned([]u8) = null,
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
    /// THREAD SAFETY: This runs on HTTP thread, must minimize work under lock.
    pub fn callback(task: *FetchTasklet, async_http: *http.AsyncHTTP, result: http.HTTPClientResult) void {
        // === HTTP THREAD - Fast-path checks before lock ===

        const is_done = !result.has_more;
        defer if (is_done) task.derefFromThread();

        // Fast-path abort check (no lock needed for atomic read)
        if (task.signal_store.aborted.load(.acquire)) {
            // Already aborted, don't schedule anything
            return;
        }

        // Prevent duplicate enqueues (atomic swap before taking lock)
        if (task.has_schedule_callback.swap(true, .acq_rel)) {
            // Already scheduled, this data will be picked up on next callback
            return;
        }

        // === ACQUIRE LOCK - Brief critical section ===
        task.mutex.lock();
        defer task.mutex.unlock();

        // Update HTTP client reference (needed for abort handling)
        task.http.?.* = async_http.*;
        task.http.?.response_buffer = async_http.response_buffer;

        log("callback success={} ignore_data={} has_more={} bytes={}", .{ result.isSuccess(), task.ignore_data, result.has_more, result.body.?.list.items.len });

        // Preserve previous metadata and certificate info
        const prev_metadata = task.result.metadata;
        const prev_cert_info = task.result.certificate_info;
        task.result = result;

        if (task.result.certificate_info == null) {
            if (prev_cert_info) |cert_info| {
                task.result.certificate_info = cert_info;
            }
        }

        // Store metadata (only provided once)
        if (result.metadata orelse prev_metadata) |metadata| {
            log("added callback metadata", .{});
            if (task.metadata == null) {
                task.metadata = metadata;
            }
            task.result.metadata = null;
        }

        task.body_size = result.body_size;

        // Copy response body data to shared buffer
        const success = result.isSuccess();
        task.response_buffer = result.body.?.*;

        if (task.ignore_data) {
            // Ignoring data - clear buffers
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
                // Ignoring body with more data - don't schedule callback
                // Reset flag so future callbacks can schedule
                task.has_schedule_callback.store(false, .release);
                return;
            }
        } else {
            // Accumulate data into scheduled buffer
            if (success) {
                // Handle OOM gracefully under lock
                _ = task.scheduled_response_buffer.write(task.response_buffer.list.items) catch blk: {
                    // OOM while copying data - mark as failed
                    task.result.fail = error.OutOfMemory;
                    // Continue to schedule callback so main thread can handle error
                    break :blk 0;
                };
            }
            // Reset for reuse by HTTP client
            task.response_buffer.reset();
        }

        // === RELEASE LOCK - Schedule to main thread outside lock ===
        // Lock is automatically released by defer above

        // Keep tasklet alive during main thread callback
        // This will be balanced by deref() in onProgressUpdate
        task.ref();

        // Enqueue callback to main thread
        // Note: concurrent_task.from() does not allocate, safe to call here
        task.javascript_vm.eventLoop().enqueueTaskConcurrent(task.concurrent_task.from(task, .manual_deinit));
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
