const bun = @import("bun");
const JSC = bun.JSC;

pub const JSPropertyIteratorOptions = struct {
    skip_empty_name: bool,
    include_value: bool,
    own_properties_only: bool = true,
    observable: bool = true,
    only_non_index_properties: bool = false,
};

pub fn JSPropertyIterator(comptime options: JSPropertyIteratorOptions) type {
    return struct {
        len: usize = 0,
        i: u32 = 0,
        iter_i: u32 = 0,
        /// null if and only if `object` has no properties (i.e. `len == 0`)
        impl: ?*JSPropertyIteratorImpl = null,

        globalObject: *JSC.JSGlobalObject,
        object: *JSC.JSObject,
        // current property being yielded
        value: JSC.JSValue = .zero,

        pub fn getLongestPropertyName(this: *@This()) usize {
            return if (this.impl) |iter|
                iter.getLongestPropertyName(this.globalObject, this.object)
            else
                0;
        }

        pub fn deinit(this: *@This()) void {
            if (this.impl) |impl| impl.deinit();
            this.* = undefined;
        }

        /// `object` should be a `JSC::JSObject`. Non-objects will be runtime converted.
        pub fn init(globalObject: *JSC.JSGlobalObject, object: *JSC.JSObject) bun.JSError!@This() {
            var len: usize = 0;
            object.ensureStillAlive();
            const impl = try JSPropertyIteratorImpl.init(
                globalObject,
                object,
                &len,
                options.own_properties_only,
                options.only_non_index_properties,
            );
            if (comptime bun.Environment.allow_assert) {
                if (len > 0) {
                    bun.assert(impl != null);
                } else {
                    bun.debugAssert(impl == null);
                }
            }

            return .{
                .object = object,
                .globalObject = globalObject,
                .impl = impl,
                .len = len,
            };
        }

        pub fn reset(this: *@This()) void {
            this.iter_i = 0;
            this.i = 0;
        }

        /// The bun.String returned has not incremented it's reference count.
        pub fn next(this: *@This()) !?bun.String {
            // Reuse stack space.
            while (true) {
                const i: usize = this.iter_i;
                if (i >= this.len) {
                    this.i = this.iter_i;
                    return null;
                }

                this.i = this.iter_i;
                this.iter_i += 1;
                var name = bun.String.dead;
                if (comptime options.include_value) {
                    const FnToUse = if (options.observable) JSPropertyIteratorImpl.getNameAndValue else JSPropertyIteratorImpl.getNameAndValueNonObservable;
                    const current = FnToUse(this.impl.?, this.globalObject, this.object, &name, i);
                    if (current == .zero) {
                        if (this.globalObject.hasException()) {
                            return error.JSError;
                        }
                        continue;
                    }
                    current.ensureStillAlive();
                    this.value = current;
                } else {
                    // Exception check is unnecessary here because it won't throw.
                    this.impl.?.getName(&name, i);
                }

                if (name.tag == .Dead) {
                    continue;
                }

                if (comptime options.skip_empty_name) {
                    if (name.isEmpty()) {
                        continue;
                    }
                }

                return name;
            }

            unreachable;
        }
    };
}

const JSPropertyIteratorImpl = opaque {
    pub fn init(
        globalObject: *JSC.JSGlobalObject,
        object: *JSC.JSObject,
        count: *usize,
        own_properties_only: bool,
        only_non_index_properties: bool,
    ) bun.JSError!?*JSPropertyIteratorImpl {
        var scope: JSC.CatchScope = undefined;
        scope.init(globalObject, @src(), .enabled);
        defer scope.deinit();
        const iter = Bun__JSPropertyIterator__create(globalObject, object.toJS(), count, own_properties_only, only_non_index_properties);
        try scope.returnIfException();
        return iter;
    }

    pub const deinit = Bun__JSPropertyIterator__deinit;
    pub const getNameAndValue = Bun__JSPropertyIterator__getNameAndValue;
    pub const getNameAndValueNonObservable = Bun__JSPropertyIterator__getNameAndValueNonObservable;
    pub const getName = Bun__JSPropertyIterator__getName;
    pub const getLongestPropertyName = Bun__JSPropertyIterator__getLongestPropertyName;

    /// may return null without an exception
    extern "c" fn Bun__JSPropertyIterator__create(globalObject: *JSC.JSGlobalObject, encodedValue: JSC.JSValue, count: *usize, own_properties_only: bool, only_non_index_properties: bool) ?*JSPropertyIteratorImpl;
    extern "c" fn Bun__JSPropertyIterator__getNameAndValue(iter: *JSPropertyIteratorImpl, globalObject: *JSC.JSGlobalObject, object: *JSC.JSObject, propertyName: *bun.String, i: usize) JSC.JSValue;
    extern "c" fn Bun__JSPropertyIterator__getNameAndValueNonObservable(iter: *JSPropertyIteratorImpl, globalObject: *JSC.JSGlobalObject, object: *JSC.JSObject, propertyName: *bun.String, i: usize) JSC.JSValue;
    extern "c" fn Bun__JSPropertyIterator__getName(iter: *JSPropertyIteratorImpl, propertyName: *bun.String, i: usize) void;
    extern "c" fn Bun__JSPropertyIterator__deinit(iter: *JSPropertyIteratorImpl) void;
    extern "c" fn Bun__JSPropertyIterator__getLongestPropertyName(iter: *JSPropertyIteratorImpl, globalObject: *JSC.JSGlobalObject, object: *JSC.JSObject) usize;
};
