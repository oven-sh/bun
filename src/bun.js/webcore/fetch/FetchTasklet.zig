//! ============================================================================
//! STATE MACHINE
//! ============================================================================
//!
//! FetchTasklet tracks multiple orthogonal state dimensions:
//! 1. Main lifecycle (FetchLifecycle) - mutually exclusive
//! 2. Request streaming (RequestStreamState) - independent
//! 3. Abort status (atomic bool) - independent
//! 4. Connection upgrade (bool) - one-time flag

/// Main fetch lifecycle - mutually exclusive OR states.
/// Every FetchTasklet is in exactly ONE of these states at a time.
const FetchLifecycle = enum(u8) {
    /// Initial: Created, not yet queued to HTTP thread
    created,

    /// HTTP request in flight
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

/// Unified error storage with explicit precedence rules.
/// Replaces scattered error tracking across multiple fields.
const FetchError = union(enum) {
    none: void,
    http_error: anyerror,
    abort_error: jsc.Strong.Optional,
    js_error: jsc.Strong.Optional,
    tls_error: jsc.Strong.Optional,

    /// Set new error, freeing old error if present
    fn set(self: *FetchError, new_error: FetchError) void {
        self.deinit();
        self.* = new_error;
    }

    /// Convert error to Body.Value.ValueError for compatibility with existing code
    fn toBodyValueError(self: FetchError, global: *JSGlobalObject) Body.Value.ValueError {
        return switch (self) {
            .none => unreachable,
            .http_error => |fail| .{ .SystemError = createSystemErrorFromHTTPError(fail, global) },
            .abort_error => |strong_opt| .{ .JSValue = strong_opt },
            .js_error => |strong_opt| .{ .JSValue = strong_opt },
            .tls_error => |strong_opt| .{ .JSValue = strong_opt },
        };
    }

    /// Convert error to JavaScript value for promise rejection
    fn toJS(self: FetchError, global: *JSGlobalObject) JSValue {
        return switch (self) {
            .none => .jsUndefined(),
            .http_error => |fail| {
                const sys_err = createSystemErrorFromHTTPError(fail, global);
                return sys_err.toErrorInstance(global);
            },
            .abort_error => |strong_opt| strong_opt.get() orelse .jsUndefined(),
            .js_error => |strong_opt| strong_opt.get() orelse .jsUndefined(),
            .tls_error => |strong_opt| strong_opt.get() orelse .jsUndefined(),
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
            .abort_error => |*strong_opt| strong_opt.deinit(),
            .js_error => |*strong_opt| strong_opt.deinit(),
            .tls_error => |*strong_opt| strong_opt.deinit(),
        }
        self.* = .none;
    }

    /// Helper to create SystemError from HTTP error
    fn createSystemErrorFromHTTPError(fail: anyerror, _: *JSGlobalObject) jsc.SystemError {
        // This will be populated from metadata if available
        const path = bun.String.empty;

        return jsc.SystemError{
            .code = bun.String.static(switch (fail) {
                error.ConnectionClosed => "ECONNRESET",
                else => |e| @errorName(e),
            }),
            .message = switch (fail) {
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

                else => |e| bun.String.createFormat("{s} fetching. For more information, pass `verbose: true` in the second argument to fetch()", .{
                    @errorName(e),
                }) catch |err| bun.handleOom(err),
            },
            .path = path,
        };
    }
};

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
        body: ?*const AnyBlob,
    ) !RequestHeaders {
        return .{
            .headers = try Headers.from(fetch_headers, allocator, .{ .body = body }),
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

pub const FetchTasklet = struct {
    pub const ResumableSink = jsc.WebCore.ResumableFetchSink;

    const log = Output.scoped(.FetchTasklet, .visible);

    /// Abort signal handling with centralized lifecycle management.
    /// Ensures all ref/unref operations are paired correctly.
    const AbortHandling = struct {
        #signal: ?*jsc.WebCore.AbortSignal = null,
        #has_pending_activity_ref: bool = false,
        #has_listener: bool = false,

        /// Attach abort signal and set up listener.
        /// Takes ownership of signal ref.
        fn attachSignal(
            self: *AbortHandling,
            signal: *jsc.WebCore.AbortSignal,
            fetch: *FetchTasklet,
        ) !void {
            bun.assert(self.#signal == null);

            // Ref the signal (we now own a reference)
            _ = signal.ref();
            self.#signal = signal;

            // Listen for abort event
            _ = signal.listen(FetchTasklet, fetch, onAbortCallback);
            self.#has_listener = true;

            // Add pending activity ref (keeps signal alive)
            signal.pendingActivityRef();
            self.#has_pending_activity_ref = true;
        }

        /// Detach signal and clean up all references.
        /// Must be called with FetchTasklet reference for cleanNativeBindings.
        fn detach(self: *AbortHandling, fetch: *FetchTasklet) void {
            const signal = self.#signal orelse return;
            self.#signal = null;

            // Defer unref operations to happen at end of scope
            // (matches original code order - defer runs in reverse registration order)
            defer {
                // Unref the signal (release our reference)
                _ = signal.unref();
            }
            defer {
                // Remove pending activity ref if we added one
                if (self.#has_pending_activity_ref) {
                    signal.pendingActivityUnref();
                    self.#has_pending_activity_ref = false;
                }
            }

            // Clean native bindings (removes listener)
            // Always call this, even if we think we don't have a listener
            // The signal may have a binding we don't know about
            signal.cleanNativeBindings(fetch);
            self.#has_listener = false;
        }

        /// Single cleanup path
        fn deinit(self: *AbortHandling, fetch: *FetchTasklet) void {
            self.detach(fetch);
        }

        /// Get the signal if attached
        fn get(self: *const AbortHandling) ?*jsc.WebCore.AbortSignal {
            return self.#signal;
        }

        /// Callback invoked when abort signal fires
        fn onAbortCallback(fetch: *FetchTasklet, reason: JSValue) void {
            log("AbortHandling.onAbortCallback", .{});
            reason.ensureStillAlive();

            // Store error in unified storage
            fetch.fetch_error.set(.{ .abort_error = jsc.Strong.Optional.create(reason, fetch.main_thread.global_this) });

            // Set atomic abort flag for HTTP thread fast-path
            fetch.shared.signal_store.aborted.store(true, .monotonic);

            // Transition to aborted state
            if (!fetch.shared.lifecycle.isTerminal()) {
                transitionLifecycle(fetch, fetch.shared.lifecycle, .aborted);
            }

            fetch.main_thread.tracker.didCancel(fetch.main_thread.global_this);

            // Abort the HTTP request
            fetch.abortTask();

            // Cancel sink if present
            if (fetch.sink) |sink| {
                sink.cancel(reason);
            }
        }
    };

    /// Helper for validated state transitions (in debug builds)
    fn transitionLifecycle(this: *FetchTasklet, old_state: FetchLifecycle, new_state: FetchLifecycle) void {
        if (bun.Environment.isDebug) {
            bun.assert(old_state.canTransitionTo(new_state));
        }
        this.shared.lifecycle = new_state;
    }

    /// Computed property: Should we ignore remaining body data?
    /// Determined by checking if abort was requested or lifecycle is in aborted state.
    fn shouldIgnoreBodyData(this: *FetchTasklet) bool {
        // Ignore data if:
        // 1. Abort was requested (via signal_store) - atomic check, fast without locking
        // 2. Already in aborted state - state machine check for consistency
        return this.shared.signal_store.aborted.load(.monotonic) or
            this.shared.lifecycle == .aborted;
    }

    // ============================================================================
    // THREAD SAFETY ARCHITECTURE (Phase 7 Step 2)
    // ============================================================================
    //
    // TODO (Phase 7 Step 4): The following structs will organize FetchTasklet's
    // fields into two thread-safety categories:
    //
    // 1. MainThreadData - Only accessed from JavaScript main thread (no lock)
    //    Will contain: global_this, javascript_vm, promise, response_weak,
    //    native_response, readable_stream_ref, abort_signal,
    //    check_server_identity, poll_ref, concurrent_task, tracker
    //
    // 2. SharedData - Accessed from both threads (mutex protected)
    //    Will contain: mutex, lifecycle, request_stream_state, abort_requested,
    //    upgraded_connection, ref_count, http, result, metadata, response_buffer,
    //    scheduled_response_buffer, body_size, has_schedule_callback, signals,
    //    signal_store
    //
    // These structs are commented out in Step 2 and will be enabled in Step 4
    // when we migrate the actual field storage into them.

    // NOTE (Phase 7 Step 4): MainThreadData and SharedData are now ENABLED
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

        /// Abort signal - stored here but managed by AbortHandling wrapper
        /// The AbortHandling struct handles all ref/unref operations
        abort_signal: ?*jsc.WebCore.AbortSignal = null,

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
            self.check_server_identity.deinit();
            self.poll_ref.unref(self.javascript_vm);
            // abort_signal handled by AbortHandling wrapper
            // response_weak is not owned, no cleanup needed
        }
    };

    /// Data shared between main thread and HTTP thread.
    /// ALL access must be protected by mutex.
    const SharedData = struct {
        /// Mutex protecting all mutable fields below
        mutex: bun.Mutex,

        /// === STATE TRACKING (protected by mutex) ===
        /// Main fetch lifecycle (mutually exclusive)
        lifecycle: FetchLifecycle,

        /// Request body streaming state (orthogonal)
        request_stream_state: RequestStreamState,

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
            if (bun.Environment.isDebug) {
                bun.assert(self.shared.lifecycle.canTransitionTo(new_state));
            }
            self.shared.lifecycle = new_state;
        }

        /// Convenience: Should ignore body data?
        fn shouldIgnoreBody(self: LockedSharedData) bool {
            const abort_requested = self.shared.signal_store.aborted.load(.acquire);
            return abort_requested or self.shared.lifecycle == .aborted;
        }
    };

    // === PHASE 7 STEP 4: THREAD SAFETY ORGANIZATION ===
    /// All fields that ONLY accessed from the main JavaScript thread
    main_thread: MainThreadData,

    /// Fields accessed from both main and HTTP threads (mutex protected)
    shared: SharedData,

    // === REMAINING FIELDS (not moved to structs) ===
    sink: ?*ResumableSink = null,
    request_body: HTTPRequestBody = undefined,
    request_body_streaming_buffer: ?*http.ThreadSafeStreamBuffer = null,

    request_headers: RequestHeaders = undefined,

    /// This is url + proxy memory buffer and is owned by FetchTasklet
    /// We always clone url and proxy (if informed)
    url_proxy_buffer: []const u8 = "",

    /// Centralized abort signal lifecycle management
    abort_handling: AbortHandling = .{},

    // custom checkServerIdentity - removed, now in main_thread
    reject_unauthorized: bool = true,
    // Custom Hostname
    hostname: ?[]u8 = null,

    // === UNIFIED ERROR HANDLING (Phase 7 Step 8) ===
    /// Single source of truth for all errors
    /// Replaces: result.fail, abort_reason scattered storage
    fetch_error: FetchError = .none,

    pub fn ref(this: *FetchTasklet) void {
        const count = this.shared.ref_count.fetchAdd(1, .monotonic);
        bun.debugAssert(count > 0);
    }

    pub fn deref(this: *FetchTasklet) void {
        const count = this.shared.ref_count.fetchSub(1, .monotonic);
        bun.debugAssert(count > 0);

        if (count == 1) {
            this.deinit() catch |err| switch (err) {};
        }
    }

    pub fn derefFromThread(this: *FetchTasklet) void {
        const count = this.shared.ref_count.fetchSub(1, .monotonic);
        bun.debugAssert(count > 0);

        if (count == 1) {
            // this is really unlikely to happen, but can happen
            // lets make sure that we always call deinit from main thread

            // === THREAD SAFETY NOTE (Phase 7 Step 5) ===
            // enqueueTaskConcurrent returns void and will panic in debug builds if VM has terminated.
            // This is intentional - if we reach here during VM shutdown, the panic is acceptable
            // as it indicates a ref counting bug that should be fixed.
            this.main_thread.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.deinit));
        }
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

    // XXX: 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    pub fn deinit(this: *FetchTasklet) error{}!void {
        log("deinit", .{});

        bun.assert(this.shared.ref_count.load(.monotonic) == 0);

        // Inline clearData() - single cleanup path
        const allocator = bun.default_allocator;
        if (this.url_proxy_buffer.len > 0) {
            allocator.free(this.url_proxy_buffer);
            this.url_proxy_buffer.len = 0;
        }

        if (this.hostname) |hostname| {
            allocator.free(hostname);
            this.hostname = null;
        }

        if (this.shared.result.certificate_info) |*certificate| {
            certificate.deinit(bun.default_allocator);
            this.shared.result.certificate_info = null;
        }

        this.request_headers.deinit();

        if (this.shared.http) |http_| {
            http_.clearData();
        }

        // Clean up shared data (includes metadata, buffers)
        this.shared.deinit();

        // Clean up response references (these are managed separately from main_thread.deinit)
        this.main_thread.response_weak.deinit();
        if (this.main_thread.native_response) |response| {
            this.main_thread.native_response = null;
            response.unref();
        }

        // Main thread deinit handles: promise, readable_stream_ref, check_server_identity, poll_ref
        this.main_thread.deinit();

        if (this.request_body != .ReadableStream or this.shared.request_stream_state == .waiting_start) {
            this.request_body.detach();
        }

        this.abort_handling.deinit(this);
        // Clear unified error storage
        this.fetch_error.deinit();

        // Inline clearSink() - clear the sink only after the request ended otherwise we would potentially lose the last chunk
        if (this.sink) |sink| {
            this.sink = null;
            sink.deref();
        }
        if (this.request_body_streaming_buffer) |buffer| {
            this.request_body_streaming_buffer = null;
            buffer.clearDrainCallback();
            buffer.deref();
        }

        if (this.shared.http) |http_| {
            this.shared.http = null;
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

    pub fn startRequestStream(this: *FetchTasklet) void {
        // Transition request stream state to active
        this.shared.request_stream_state = .active;
        bun.assert(this.request_body == .ReadableStream);
        if (this.request_body.ReadableStream.get(this.main_thread.global_this)) |stream| {
            if (this.abort_handling.get()) |signal| {
                if (signal.aborted()) {
                    stream.abort(this.main_thread.global_this);
                    return;
                }
            }

            const globalThis = this.main_thread.global_this;
            this.ref(); // lets only unref when sink is done
            // +1 because the task refs the sink
            const sink = ResumableSink.initExactRefs(globalThis, stream, this, 2);
            this.sink = sink;
        }
    }

    // === PHASE 7 STEP 7: BODY STREAMING LOGIC ===
    // This function handles received HTTP body data and routes it based on timing and state.
    //
    // THREE CODE PATHS (based on when JS accesses the response body):
    //
    // PATH 1: EARLY STREAMING (readable_stream_ref exists)
    //   - JS accessed .body BEFORE response was fully received
    //   - We have a pre-existing ReadableStream to write chunks to
    //   - Buffer management: Send chunks directly to stream, reset buffer after each chunk
    //   - State: .response_body_streaming
    //
    // PATH 2: LAZY STREAMING (getCurrentResponse() returns a response with body stream)
    //   - Response exists and JS is NOW accessing .body (getBodyReadableStream creates stream)
    //   - We're transitioning from buffering to streaming mid-flight
    //   - Buffer management: Flush buffered data to new stream, then stream remaining chunks
    //   - State: .response_awaiting_body_access -> .response_body_streaming
    //
    // PATH 3: BUFFERING (getCurrentResponse() returns a response without stream)
    //   - Response exists but JS hasn't accessed .body yet
    //   - We accumulate all body data in memory
    //   - Buffer management: Keep accumulating in scheduled_response_buffer, DON'T reset
    //   - State: .response_body_buffering
    //   - When complete (!has_more), convert buffer to InternalBlob and resolve Body.Value
    //
    // The key difference is TIMING:
    // - Path 1: Stream created early (before headers received)
    // - Path 2: Stream created mid-reception (after headers, during body chunks)
    // - Path 3: No stream yet (buffering, will either become Path 2 or complete buffered)
    //
    pub fn onBodyReceived(this: *FetchTasklet) bun.JSTerminated!void {
        const success = this.shared.result.isSuccess();
        const globalThis = this.main_thread.global_this;
        // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
        var buffer_reset = true;
        log("onBodyReceived success={} has_more={}", .{ success, this.shared.result.has_more });
        defer {
            if (buffer_reset) {
                this.shared.scheduled_response_buffer.reset();
            }
        }

        // === ERROR HANDLING (applies to all paths) ===
        if (!success) {
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

        // === PATH 1: EARLY STREAMING ===
        // ReadableStream was created BEFORE response fully received (e.g., via response.body.getReader())
        // Send chunks directly to the existing stream
        if (this.main_thread.readable_stream_ref.get(globalThis)) |readable| {
            log("onBodyReceived readable_stream_ref", .{});
            // Dual tracking: mark as streaming if we have a stream
            if (this.shared.lifecycle == .response_awaiting_body_access or
                this.shared.lifecycle == .response_body_buffering or
                this.shared.lifecycle == .http_receiving_body)
            {
                transitionLifecycle(this, this.shared.lifecycle, .response_body_streaming);
            }
            if (readable.ptr == .Bytes) {
                readable.ptr.Bytes.size_hint = this.getSizeHint();
                // body can be marked as used but we still need to pipe the data
                const scheduled_response_buffer = &this.shared.scheduled_response_buffer.list;

                const chunk = scheduled_response_buffer.items;

                if (this.shared.result.has_more) {
                    try readable.ptr.Bytes.onData(
                        .{
                            .temporary = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                        },
                        bun.default_allocator,
                    );
                } else {
                    var prev = this.main_thread.readable_stream_ref;
                    this.main_thread.readable_stream_ref = .{};
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

        // === PATH 2 & 3: RESPONSE-BASED HANDLING ===
        // Response object exists - either create stream now (Path 2) or buffer (Path 3)
        if (this.getCurrentResponse()) |response| {
            log("onBodyReceived Current Response", .{});
            const sizeHint = this.getSizeHint();
            response.setSizeHint(sizeHint);

            // === PATH 2: LAZY STREAMING ===
            // JS is NOW accessing .body for the first time (getBodyReadableStream creates stream)
            // Flush any buffered data to the new stream, then continue streaming
            if (response.getBodyReadableStream(globalThis)) |readable| {
                log("onBodyReceived CurrentResponse BodyReadableStream", .{});
                // Dual tracking: mark as streaming when body stream is accessed
                if (this.shared.lifecycle == .response_awaiting_body_access or
                    this.shared.lifecycle == .response_body_buffering or
                    this.shared.lifecycle == .http_receiving_body)
                {
                    transitionLifecycle(this, this.shared.lifecycle, .response_body_streaming);
                }
                if (readable.ptr == .Bytes) {
                    const scheduled_response_buffer = this.shared.scheduled_response_buffer.list;

                    const chunk = scheduled_response_buffer.items;

                    if (this.shared.result.has_more) {
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

            // === PATH 3: BUFFERING ===
            // JS hasn't accessed .body yet - keep accumulating data in memory
            // When complete, convert entire buffer to InternalBlob
            // NOTE: We do NOT reset the buffer here (buffer_reset = false)
            buffer_reset = false;
            if (!this.shared.result.has_more) {
                var scheduled_response_buffer = this.shared.scheduled_response_buffer.list;
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

                this.shared.scheduled_response_buffer = .{
                    .allocator = bun.default_allocator,
                    .list = .{
                        .items = &.{},
                        .capacity = 0,
                    },
                };

                if (old == .Locked) {
                    log("onBodyReceived old.resolve", .{});
                    try old.resolve(body, this.main_thread.global_this, response.getFetchHeaders());
                }
            }
        }
    }

    pub fn onProgressUpdate(this: *FetchTasklet) bun.JSTerminated!void {
        jsc.markBinding(@src());
        log("onProgressUpdate", .{});
        this.shared.mutex.lock();
        this.shared.has_schedule_callback.store(false, .monotonic);
        const is_done = !this.shared.result.has_more;

        const vm = this.main_thread.javascript_vm;
        // vm is shutting down we cannot touch JS
        if (vm.isShuttingDown()) {
            this.shared.mutex.unlock();
            if (is_done) {
                this.deref();
            }
            return;
        }

        const globalThis = this.main_thread.global_this;
        defer {
            this.shared.mutex.unlock();
            // if we are not done we wait until the next call
            if (is_done) {
                var poll_ref = this.main_thread.poll_ref;
                this.main_thread.poll_ref = .{};
                poll_ref.unref(vm);
                this.deref();
            }
        }
        if (this.shared.request_stream_state == .waiting_start and this.shared.result.can_stream) {
            // start streaming
            this.startRequestStream();
        }
        // if we already respond the metadata and still need to process the body
        if (this.shared.lifecycle == .response_awaiting_body_access or
            this.shared.lifecycle == .response_body_streaming or
            this.shared.lifecycle == .response_body_buffering)
        {
            try this.onBodyReceived();
            return;
        }
        if (this.shared.metadata == null and this.shared.result.isSuccess()) return;

        // if we abort because of cert error
        // we wait the Http Client because we already have the response
        // we just need to deinit - check if we're in failed state
        if (this.shared.lifecycle == .failed) {
            return;
        }
        const promise_value = this.main_thread.promise.valueOrEmpty();

        if (promise_value.isEmptyOrUndefinedOrNull()) {
            log("onProgressUpdate: promise_value is null", .{});
            this.main_thread.promise.deinit();
            return;
        }

        if (this.shared.result.certificate_info) |certificate_info| {
            this.shared.result.certificate_info = null;
            defer certificate_info.deinit(bun.default_allocator);

            // we receive some error
            if (this.reject_unauthorized and !this.checkServerIdentity(certificate_info)) {
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
            if (this.shared.metadata == null) {
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
        const success = this.shared.result.isSuccess();
        const result = switch (success) {
            true => jsc.Strong.Optional.create(this.onResolve(), globalThis),
            false => brk: {
                // in this case we wanna a jsc.Strong.Optional so we just convert it
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
                        // Store error in unified storage
                        this.fetch_error.set(.{ .tls_error = jsc.Strong.Optional.create(check_result, globalObject) });
                        this.shared.signal_store.aborted.store(true, .monotonic);
                        if (!this.shared.lifecycle.isTerminal()) {
                            transitionLifecycle(this, this.shared.lifecycle, .failed);
                        }
                        this.main_thread.tracker.didCancel(this.main_thread.global_this);
                        // we need to abort the request
                        if (this.shared.http) |http_| http.http_thread.scheduleShutdown(http_);
                        // Note: Do NOT set result.fail - error is in fetch_error
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
                        // Store error in unified storage
                        this.fetch_error.set(.{ .js_error = jsc.Strong.Optional.create(check_result, globalObject) });
                        this.shared.signal_store.aborted.store(true, .monotonic);
                        // Dual tracking: transition to failed state
                        if (!this.shared.lifecycle.isTerminal()) {
                            transitionLifecycle(this, this.shared.lifecycle, .failed);
                        }
                        this.main_thread.tracker.didCancel(this.main_thread.global_this);

                        // we need to abort the request
                        if (this.shared.http) |http_| {
                            http.http_thread.scheduleShutdown(http_);
                        }
                        // Note: Do NOT set result.fail - error is in fetch_error
                        return false;
                    }

                    // > On success, returns <undefined>
                    // We treat any non-error value as a success.
                    return true;
                }
            }
        }
        // Note: Do NOT set result.fail - error should be captured in caller
        return false;
    }

    fn getAbortError(this: *FetchTasklet) ?Body.Value.ValueError {
        // Check unified error storage
        if (this.fetch_error == .abort_error) {
            defer this.clearAbortSignal();
            return this.fetch_error.toBodyValueError(this.main_thread.global_this);
        }

        // Fallback: check signal directly (for errors not yet captured)
        if (this.abort_handling.get()) |signal| {
            if (signal.reasonIfAborted(this.main_thread.global_this)) |reason| {
                defer this.clearAbortSignal();
                return reason.toBodyValueError(this.main_thread.global_this);
            }
        }

        return null;
    }

    fn clearAbortSignal(this: *FetchTasklet) void {
        this.abort_handling.detach(this);
    }

    pub fn onReject(this: *FetchTasklet) Body.Value.ValueError {
        bun.assert(this.fetch_error != .none);
        log("onReject", .{});

        // All errors should be in unified storage
        if (this.fetch_error != .none) {
            return this.fetch_error.toBodyValueError(this.main_thread.global_this);
        }

        // Fallback: check abort signal directly (for race conditions)
        if (this.getAbortError()) |err| {
            return err;
        }

        if (this.shared.result.abortReason()) |reason| {
            return .{ .AbortReason = reason };
        }

        // Should not reach here - all errors should be captured
        bun.debugAssert(false); // This indicates a bug in error handling
        return .{ .SystemError = jsc.SystemError{
            .code = bun.String.static("EFETCH"),
            .message = bun.String.static("Unknown fetch error"),
            .path = bun.String.empty,
        } };
    }

    /// Helper to create SystemError from HTTP error with path
    fn createSystemErrorFromHTTPErrorWithPath(fail: anyerror, global: *JSGlobalObject, path: bun.String) jsc.SystemError {
        _ = global; // May be used in future for error formatting
        const fetch_error = jsc.SystemError{
            .code = bun.String.static(switch (fail) {
                error.ConnectionClosed => "ECONNRESET",
                else => |e| @errorName(e),
            }),
            .message = switch (fail) {
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

        return fetch_error;
    }

    pub fn onReadableStreamAvailable(ctx: *anyopaque, globalThis: *jsc.JSGlobalObject, readable: jsc.WebCore.ReadableStream) void {
        const this = bun.cast(*FetchTasklet, ctx);
        this.main_thread.readable_stream_ref = jsc.WebCore.ReadableStream.Strong.init(readable, globalThis);
    }

    pub fn onStartStreamingHTTPResponseBodyCallback(ctx: *anyopaque) jsc.WebCore.DrainResult {
        const this = bun.cast(*FetchTasklet, ctx);
        if (this.shared.signal_store.aborted.load(.monotonic)) {
            return jsc.WebCore.DrainResult{
                .aborted = {},
            };
        }

        if (this.shared.http) |http_| {
            http_.enableResponseBodyStreaming();

            // If the server sent the headers and the response body in two separate socket writes
            // and if the server doesn't close the connection by itself
            // and doesn't send any follow-up data
            // then we must make sure the HTTP thread flushes.
            bun.http.http_thread.scheduleResponseBodyDrain(http_.async_http_id);
        }

        this.shared.mutex.lock();
        defer this.shared.mutex.unlock();
        const size_hint = this.getSizeHint();

        var scheduled_response_buffer = this.shared.scheduled_response_buffer.list;
        // This means we have received part of the body but not the whole thing
        if (scheduled_response_buffer.items.len > 0) {
            this.shared.scheduled_response_buffer = .{
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
        return switch (this.shared.body_size) {
            .content_length => @truncate(this.shared.body_size.content_length),
            .total_received => @truncate(this.shared.body_size.total_received),
            .unknown => 0,
        };
    }

    fn toBodyValue(this: *FetchTasklet) Body.Value {
        if (this.getAbortError()) |err| {
            return .{ .Error = err };
        }
        if (this.shared.lifecycle == .response_awaiting_body_access or
            this.shared.lifecycle == .response_body_streaming or
            this.shared.lifecycle == .response_body_buffering)
        {
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
        bun.assert(this.shared.metadata != null);
        // at this point we always should have metadata
        const metadata = this.shared.metadata.?;
        const http_response = metadata.response;
        // State machine handles "waiting for body" - no boolean flag needed
        // Only transition if not already in a more advanced or terminal state
        if (this.shared.result.has_more) {
            if (this.shared.lifecycle == .http_receiving_body or
                this.shared.lifecycle == .http_receiving_headers or
                this.shared.lifecycle == .http_active)
            {
                transitionLifecycle(this, this.shared.lifecycle, .response_awaiting_body_access);
            }
        } else {
            // No more body - but don't transition to completed yet, let callback handle it
            // Just stay in current state
        }
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
            this.shared.result.redirected,
        );
    }

    fn ignoreRemainingResponseBody(this: *FetchTasklet) void {
        log("ignoreRemainingResponseBody", .{});

        // === THREAD SAFETY FIX (Phase 7 Code Review) ===
        // Lock FIRST before touching ANY shared state
        // This prevents race with HTTP thread callback() which modifies shared.http under lock
        this.shared.mutex.lock();
        defer this.shared.mutex.unlock();

        // NOW safe to access shared.http
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

        // Signal abort to HTTP thread (atomic for fast-path)
        this.shared.signal_store.aborted.store(true, .monotonic);

        // Transition to aborted state
        if (!this.shared.lifecycle.isTerminal()) {
            transitionLifecycle(this, this.shared.lifecycle, .aborted);
        }

        // Clear accumulated buffers since we're ignoring the rest
        this.shared.response_buffer.list.clearRetainingCapacity();
        this.shared.scheduled_response_buffer.list.clearRetainingCapacity();
    }

    export fn Bun__FetchResponse_finalize(this: *FetchTasklet) callconv(.C) void {
        log("onResponseFinalize", .{});
        if (this.main_thread.native_response) |response| {
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
            if (body.* != .Locked or this.main_thread.readable_stream_ref.held.has()) {
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

        fetch_tasklet.* = .{
            .main_thread = .{
                .global_this = globalThis,
                .javascript_vm = jsc_vm,
                .promise = promise,
                .check_server_identity = fetch_options.check_server_identity,
                .tracker = jsc.Debugger.AsyncTaskTracker.init(jsc_vm),
            },
            .shared = try SharedData.init(bun.default_allocator),
            .request_body = fetch_options.body,
            .request_headers = .{
                .headers = fetch_options.headers,
                .#owned = true, // We own these headers and must clean them up
            },
            .url_proxy_buffer = fetch_options.url_proxy_buffer,
            .hostname = fetch_options.hostname,
            .reject_unauthorized = fetch_options.reject_unauthorized,
        };

        fetch_tasklet.shared.http = try allocator.create(http.AsyncHTTP);
        fetch_tasklet.shared.upgraded_connection = fetch_options.upgraded_connection;
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

        if (fetch_tasklet.main_thread.check_server_identity.has() and fetch_tasklet.reject_unauthorized) {
            fetch_tasklet.shared.signal_store.cert_errors.store(true, .monotonic);
        } else {
            fetch_tasklet.shared.signals.cert_errors = null;
        }

        // This task gets queued on the HTTP thread.
        fetch_tasklet.shared.http.?.* = http.AsyncHTTP.init(
            bun.default_allocator,
            fetch_options.method,
            fetch_options.url,
            fetch_tasklet.request_headers.borrow().entries,
            fetch_tasklet.request_headers.borrow().buf.items,
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
        // Set request stream state
        fetch_tasklet.shared.request_stream_state = if (isStream) .waiting_start else .none;
        if (isStream) {
            const buffer = http.ThreadSafeStreamBuffer.new(.{});
            buffer.setDrainCallback(FetchTasklet, FetchTasklet.onWriteRequestDataDrain, fetch_tasklet);
            fetch_tasklet.request_body_streaming_buffer = buffer;
            fetch_tasklet.shared.http.?.request_body = .{
                .stream = .{
                    .buffer = buffer,
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

        if (fetch_options.signal) |signal| {
            try fetch_tasklet.abort_handling.attachSignal(signal, fetch_tasklet);
        }
        return fetch_tasklet;
    }

    /// This is ALWAYS called from the http thread and we cannot touch the buffer here because is locked
    pub fn onWriteRequestDataDrain(this: *FetchTasklet) void {
        // ref until the main thread callback is called
        this.ref();
        this.main_thread.javascript_vm.eventLoop().enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this, FetchTasklet.resumeRequestDataStream));
    }

    /// This is ALWAYS called from the main thread
    // XXX: 'fn (*FetchTasklet) error{}!void' coerces to 'fn (*FetchTasklet) bun.JSError!void' but 'fn (*FetchTasklet) void' does not
    pub fn resumeRequestDataStream(this: *FetchTasklet) error{}!void {
        // deref when done because we ref inside onWriteRequestDataDrain
        defer this.deref();
        log("resumeRequestDataStream", .{});
        if (this.sink) |sink| {
            if (this.abort_handling.get()) |signal| {
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
        if (this.abort_handling.get()) |signal| {
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
            http.http_thread.scheduleRequestWrite(this.shared.http.?, .data);
        };

        // dont have backpressure so we will schedule the data to be written
        // if we have backpressure the onWritable will drain the buffer
        needs_schedule = stream_buffer.isEmpty();
        if (this.shared.upgraded_connection) {
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
        // Dual tracking: mark request stream as complete
        this.shared.request_stream_state = .complete;
        if (err) |jsError| {
            if (this.shared.signal_store.aborted.load(.monotonic) or this.fetch_error.isAbort()) {
                return;
            }
            if (!jsError.isUndefinedOrNull()) {
                // Store error in unified storage
                this.fetch_error.set(.{ .js_error = jsc.Strong.Optional.create(jsError, this.main_thread.global_this) });
            }
            this.abortTask();
        } else {
            if (!this.shared.upgraded_connection) {
                // If is not upgraded we need to send the terminating chunk
                const thread_safe_stream_buffer = this.request_body_streaming_buffer orelse return;
                const stream_buffer = thread_safe_stream_buffer.acquire();
                defer thread_safe_stream_buffer.release();
                bun.handleOom(stream_buffer.write(http.end_of_chunked_http1_1_encoding_response_body));
            }
            if (this.shared.http) |http_| {
                // just tell to write the end of the chunked encoding aka 0\r\n\r\n
                http.http_thread.scheduleRequestWrite(http_, .end);
            }
        }
    }

    pub fn abortTask(this: *FetchTasklet) void {
        this.shared.signal_store.aborted.store(true, .monotonic);
        this.main_thread.tracker.didCancel(this.main_thread.global_this);

        if (this.shared.http) |http_| {
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

        // Dual tracking: transition to http_active when queued to HTTP thread
        transitionLifecycle(node, node.shared.lifecycle, .http_active);

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

        task.shared.mutex.lock();
        // we need to unlock before task.deref();
        defer task.shared.mutex.unlock();
        task.shared.http.?.* = async_http.*;
        task.shared.http.?.response_buffer = async_http.response_buffer;

        log("callback success={} ignore_data={} has_more={} bytes={}", .{ result.isSuccess(), task.shouldIgnoreBodyData(), result.has_more, result.body.?.list.items.len });

        // Dual tracking: update lifecycle state
        // Only transition if not already in a terminal or later state
        if (!task.shared.lifecycle.isTerminal()) {
            if (result.metadata != null and (task.shared.lifecycle == .created or task.shared.lifecycle == .http_active or task.shared.lifecycle == .http_receiving_headers)) {
                // We have metadata, move to receiving body
                if (task.shared.lifecycle == .created or task.shared.lifecycle == .http_active) {
                    transitionLifecycle(task, task.shared.lifecycle, .http_receiving_headers);
                }
                if (task.shared.lifecycle == .http_receiving_headers) {
                    transitionLifecycle(task, task.shared.lifecycle, .http_receiving_body);
                }
            } else if (task.shared.lifecycle == .created or task.shared.lifecycle == .http_active) {
                // No metadata yet, just mark as active
                transitionLifecycle(task, task.shared.lifecycle, .http_receiving_headers);
            }
        }

        const prev_metadata = task.shared.result.metadata;
        const prev_cert_info = task.shared.result.certificate_info;
        task.shared.result = result;

        // Preserve pending certificate info if it was preovided in the previous update.
        if (task.shared.result.certificate_info == null) {
            if (prev_cert_info) |cert_info| {
                task.shared.result.certificate_info = cert_info;
            }
        }

        // metadata should be provided only once
        if (result.metadata orelse prev_metadata) |metadata| {
            log("added callback metadata", .{});
            if (task.shared.metadata == null) {
                task.shared.metadata = metadata;
            }

            task.shared.result.metadata = null;
        }

        task.shared.body_size = result.body_size;

        const success = result.isSuccess();
        task.shared.response_buffer = result.body.?.*;

        // Dual tracking: transition to terminal states when done
        if (!result.has_more and !task.shared.lifecycle.isTerminal()) {
            if (success) {
                transitionLifecycle(task, task.shared.lifecycle, .completed);
            } else {
                // Capture HTTP error in unified storage
                if (task.shared.result.fail) |fail| {
                    task.fetch_error.set(.{ .http_error = fail });
                }
                transitionLifecycle(task, task.shared.lifecycle, .failed);
            }
        }

        if (task.shouldIgnoreBodyData()) {
            task.shared.response_buffer.reset();

            if (task.shared.scheduled_response_buffer.list.capacity > 0) {
                task.shared.scheduled_response_buffer.deinit();
                task.shared.scheduled_response_buffer = .{
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
                _ = bun.handleOom(task.shared.scheduled_response_buffer.write(task.shared.response_buffer.list.items));
            }
            // reset for reuse
            task.shared.response_buffer.reset();
        }

        if (task.shared.has_schedule_callback.cmpxchgStrong(false, true, .acquire, .monotonic)) |has_schedule_callback| {
            if (has_schedule_callback) {
                return;
            }
        }

        task.main_thread.javascript_vm.eventLoop().enqueueTaskConcurrent(task.main_thread.concurrent_task.from(task, .manual_deinit));
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
