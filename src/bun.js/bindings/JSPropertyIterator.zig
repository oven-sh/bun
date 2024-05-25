const bun = @import("root").bun;
const JSC = bun.JSC;

//extern "C" EncodedJSValue Bun__JSPropertyIterator__getNameAndValue(JSPropertyIterator* iter, JSC::JSGlobalObject* globalObject, JSC::JSObject* object, BunString* propertyName, size_t i)
extern "C" fn Bun__JSPropertyIterator__create(globalObject: *JSC.JSGlobalObject, encodedValue: JSC.JSValue, *usize) ?*anyopaque;
extern "C" fn Bun__JSPropertyIterator__getNameAndValue(iter: ?*anyopaque, globalObject: *JSC.JSGlobalObject, object: *anyopaque, propertyName: *bun.String, i: usize) JSC.JSValue;
extern "C" fn Bun__JSPropertyIterator__getName(iter: ?*anyopaque, propertyName: *bun.String, i: usize) void;
extern "C" fn Bun__JSPropertyIterator__deinit(iter: ?*anyopaque) void;

pub const JSPropertyIteratorOptions = struct {
    skip_empty_name: bool,
    include_value: bool,
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

        pub fn deinit(this: *@This()) void {
            if (this.impl) |impl| {
                Bun__JSPropertyIterator__deinit(impl);
            }
            this.* = undefined;
        }

        pub fn init(globalObject: *JSC.JSGlobalObject, object: JSC.JSValue) @This() {
            var iter = @This(){
                .object = object.asCell(),
                .globalObject = globalObject,
            };

            iter.impl = Bun__JSPropertyIterator__create(globalObject, object, &iter.len);
            return iter;
        }

        pub fn reset(this: *@This()) void {
            this.iter_i = 0;
            this.i = 0;
        }

        /// The bun.String returned has not incremented it's reference count.
        pub fn next(this: *@This()) ?bun.String {
            const i: usize = this.iter_i;
            if (i >= this.len) {
                this.i = this.iter_i;
                return null;
            }

            this.i = this.iter_i;
            this.iter_i += 1;
            var name = bun.String.dead;
            if (comptime options.include_value) {
                const current = Bun__JSPropertyIterator__getNameAndValue(this.impl, this.globalObject, this.object, &name, i);
                if (current.isEmpty()) {
                    return this.next();
                }
                current.ensureStillAlive();
                this.value = current;
            } else {
                Bun__JSPropertyIterator__getName(this.impl, &name, i);
            }

            if (name.tag == .Dead) {
                return this.next();
            }

            if (comptime options.skip_empty_name) {
                if (name.isEmpty()) {
                    return this.next();
                }
            }

            return name;
        }
    };
}
