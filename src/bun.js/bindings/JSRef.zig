/// Holds a reference to a JSValue with lifecycle management.
///
/// JSRef is used to safely maintain a reference to a JavaScript object from native code,
/// with explicit control over whether the reference keeps the object alive during garbage collection.
///
/// # Common Usage Pattern
///
/// JSRef is typically used in native objects that need to maintain a reference to their
/// corresponding JavaScript wrapper object. The reference can be upgraded to "strong" when
/// the native object has pending work or active connections, and downgraded to "weak" when idle:
///
/// ```zig
/// const MyNativeObject = struct {
///     this_value: jsc.JSRef = .empty(),
///     connection: SomeConnection,
///
///     pub fn init(globalObject: *jsc.JSGlobalObject) *MyNativeObject {
///         const this = MyNativeObject.new(.{});
///         const this_value = this.toJS(globalObject);
///         // Start with strong ref - object has pending work (initialization)
///         this.this_value = .initStrong(this_value, globalObject);
///         return this;
///     }
///
///     fn updateReferenceType(this: *MyNativeObject) void {
///         if (this.connection.isActive()) {
///             // Keep object alive while connection is active
///             if (this.this_value.isNotEmpty() and this.this_value == .weak) {
///                 this.this_value.upgrade(globalObject);
///             }
///         } else {
///             // Allow GC when connection is idle
///             if (this.this_value.isNotEmpty() and this.this_value == .strong) {
///                 this.this_value.downgrade();
///             }
///         }
///     }
///
///     pub fn onMessage(this: *MyNativeObject) void {
///         // Safely retrieve the JSValue if still alive
///         const this_value = this.this_value.tryGet() orelse return;
///         // Use this_value...
///     }
///
///     pub fn finalize(this: *MyNativeObject) void {
///         // Called when JS object is being garbage collected
///         this.this_value.finalize();
///         this.cleanup();
///     }
/// };
/// ```
///
/// # States
///
/// - **weak**: Holds a JSValue directly. Does NOT prevent garbage collection.
///   The JSValue may become invalid if the object is collected.
///   Use `tryGet()` to safely check if the value is still alive.
///
/// - **strong**: Holds a Strong reference that prevents garbage collection.
///   The JavaScript object will stay alive as long as this reference exists.
///   Must call `deinit()` or `finalize()` to release.
///
/// - **finalized**: The reference has been finalized (object was GC'd or explicitly cleaned up).
///   Indicates the JSValue is no longer valid. `tryGet()` returns null.
///
/// # Key Methods
///
/// - `initWeak()` / `initStrong()`: Create a new JSRef in weak or strong mode
/// - `tryGet()`: Safely retrieve the JSValue if still alive (returns null if finalized or empty)
/// - `upgrade()`: Convert weak → strong to prevent GC
/// - `downgrade()`: Convert strong → weak to allow GC (keeps the JSValue if still alive)
/// - `finalize()`: Mark as finalized and release resources (typically called from GC finalizer)
/// - `deinit()`: Release resources without marking as finalized
///
/// # When to Use Strong vs Weak
///
/// Use **strong** references when:
/// - The native object has active operations (network connections, pending requests, timers)
/// - You need to guarantee the JS object stays alive
/// - You'll call methods on the JS object from callbacks
///
/// Use **weak** references when:
/// - The native object is idle with no pending work
/// - The JS object should be GC-able if no other references exist
/// - You want to allow natural garbage collection
///
/// Common pattern: Start strong, downgrade to weak when idle, upgrade to strong when active.
/// See ServerWebSocket, UDPSocket, MySQLConnection, and ValkeyClient for examples.
///
pub const JSRef = union(enum) {
    weak: jsc.JSValue,
    strong: jsc.Strong.Optional,
    finalized: void,

    pub fn initWeak(value: jsc.JSValue) @This() {
        bun.assert(!value.isEmptyOrUndefinedOrNull());
        return .{ .weak = value };
    }

    pub fn initStrong(value: jsc.JSValue, globalThis: *jsc.JSGlobalObject) @This() {
        bun.assert(!value.isEmptyOrUndefinedOrNull());
        return .{ .strong = .create(value, globalThis) };
    }

    pub fn empty() @This() {
        return .{ .weak = .js_undefined };
    }

    pub fn tryGet(this: *const @This()) ?jsc.JSValue {
        return switch (this.*) {
            .weak => if (this.weak.isEmptyOrUndefinedOrNull()) null else this.weak,
            .strong => this.strong.get(),
            .finalized => null,
        };
    }
    pub fn setWeak(this: *@This(), value: jsc.JSValue) void {
        bun.assert(!value.isEmptyOrUndefinedOrNull());
        switch (this.*) {
            .weak => {},
            .strong => {
                this.strong.deinit();
            },
            .finalized => {
                return;
            },
        }
        this.* = .{ .weak = value };
    }

    pub fn setStrong(this: *@This(), value: jsc.JSValue, globalThis: *jsc.JSGlobalObject) void {
        bun.assert(!value.isEmptyOrUndefinedOrNull());
        if (this.* == .strong) {
            this.strong.set(globalThis, value);
            return;
        }
        this.* = .{ .strong = .create(value, globalThis) };
    }

    pub fn upgrade(this: *@This(), globalThis: *jsc.JSGlobalObject) void {
        switch (this.*) {
            .weak => {
                bun.assert(!this.weak.isEmptyOrUndefinedOrNull());
                const weak = this.weak;
                this.* = .{ .strong = .create(weak, globalThis) };
            },
            .strong => {},
            .finalized => {
                bun.debugAssert(false);
            },
        }
    }

    pub fn downgrade(this: *@This()) void {
        switch (this.*) {
            .weak => {},
            .strong => |*strong| {
                const value = strong.trySwap() orelse .js_undefined;
                value.ensureStillAlive();
                strong.deinit();
                this.* = .{ .weak = value };
            },
            .finalized => {
                bun.debugAssert(false);
            },
        }
    }

    pub fn isEmpty(this: *const @This()) bool {
        return switch (this.*) {
            .weak => this.weak.isEmptyOrUndefinedOrNull(),
            .strong => !this.strong.has(),
            .finalized => true,
        };
    }

    pub fn isNotEmpty(this: *const @This()) bool {
        return switch (this.*) {
            .weak => !this.weak.isEmptyOrUndefinedOrNull(),
            .strong => this.strong.has(),
            .finalized => false,
        };
    }

    /// Test whether this reference is a strong reference.
    pub fn isStrong(this: *const @This()) bool {
        return this.* == .strong;
    }

    pub fn deinit(this: *@This()) void {
        switch (this.*) {
            .weak => {
                this.weak = .js_undefined;
            },
            .strong => {
                this.strong.deinit();
            },
            .finalized => {},
        }
    }

    pub fn finalize(this: *@This()) void {
        this.deinit();
        this.* = .{ .finalized = {} };
    }

    pub fn update(this: *@This(), globalThis: *jsc.JSGlobalObject, value: JSValue) void {
        switch (this.*) {
            .weak => {
                bun.debugAssert(!value.isEmptyOrUndefinedOrNull());
                this.weak = value;
            },
            .strong => {
                if (this.strong.get() != value) {
                    this.strong.set(globalThis, value);
                }
            },
            .finalized => {
                bun.debugAssert(false);
            },
        }
    }
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
