const bun = @import("root").bun;
const JSC = bun.JSC;

//extern "C" EncodedJSValue Bun__JSPropertyIterator__getNameAndValue(JSPropertyIterator* iter, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, BunString* propertyName, size_t i)
extern "C" fn Bun__JSPropertyIterator__create(globalObject: *JSC.JSGlobalObject, encodedValue: JSC.JSValue, *usize, own_properties_only: bool, only_non_index_properties: bool) ?*anyopaque;
extern "C" fn Bun__JSPropertyIterator__getNameAndValue(iter: ?*anyopaque, globalObject: *JSC.JSGlobalObject, object: *anyopaque, propertyName: *bun.String, i: usize) JSC.JSValue;
extern "C" fn Bun__JSPropertyIterator__getNameAndValueNonObservable(iter: ?*anyopaque, globalObject: *JSC.JSGlobalObject, object: *anyopaque, propertyName: *bun.String, i: usize) JSC.JSValue;
extern "C" fn Bun__JSPropertyIterator__getName(iter: ?*anyopaque, propertyName: *bun.String, i: usize) void;
extern "C" fn Bun__JSPropertyIterator__deinit(iter: ?*anyopaque) void;
extern "C" fn Bun__JSPropertyIterator__getLongestPropertyName(iter: ?*anyopaque, globalObject: *JSC.JSGlobalObject, object: *anyopaque) usize;
extern "C" fn Bun__JSPropertyIterator__getCodeProperty(iter: ?*anyopaque, globalObject: *JSC.JSGlobalObject, object: *anyopaque) JSC.JSValue;
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
        impl: ?*anyopaque = null,

        globalObject: *JSC.JSGlobalObject,
        object: *JSC.JSCell = undefined,
        value: JSC.JSValue = .zero,
        tried_code_property: bool = false,

        pub fn getLongestPropertyName(this: *@This()) usize {
            if (this.impl == null) return 0;
            return Bun__JSPropertyIterator__getLongestPropertyName(this.impl, this.globalObject, this.object);
        }

        pub fn deinit(this: *@This()) void {
            if (this.impl) |impl| {
                Bun__JSPropertyIterator__deinit(impl);
            }
            this.* = undefined;
        }

        pub fn init(globalObject: *JSC.JSGlobalObject, object: JSC.JSValue) bun.JSError!@This() {
            var iter = @This(){
                .object = object.asCell(),
                .globalObject = globalObject,
            };

            iter.impl = Bun__JSPropertyIterator__create(globalObject, object, &iter.len, options.own_properties_only, options.only_non_index_properties);
            if (globalObject.hasException()) {
                return error.JSError;
            }
            if (iter.len > 0) {
                bun.debugAssert(iter.impl != null);
            }
            return iter;
        }

        pub fn reset(this: *@This()) void {
            this.iter_i = 0;
            this.i = 0;
            this.tried_code_property = false;
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
                    const FnToUse = if (options.observable) Bun__JSPropertyIterator__getNameAndValue else Bun__JSPropertyIterator__getNameAndValueNonObservable;
                    const current = FnToUse(this.impl, this.globalObject, this.object, &name, i);
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
                    Bun__JSPropertyIterator__getName(this.impl, &name, i);
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

        /// "code" is not always an own property, and we want to get it without risking exceptions.
        pub fn getCodeProperty(this: *@This()) ?bun.String {
            if (comptime !options.include_value) {
                @compileError("TODO");
            }

            if (this.tried_code_property) {
                return null;
            }

            this.tried_code_property = true;

            const current = Bun__JSPropertyIterator__getCodeProperty(this.impl, this.globalObject, this.object);
            if (current == .zero) {
                return null;
            }
            current.ensureStillAlive();
            this.value = current;

            return bun.String.static("code");
        }
    };
}
