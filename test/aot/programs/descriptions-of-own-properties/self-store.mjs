// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
self = 5; console.log(self, globalThis.self, typeof self, Object.keys(Object.getOwnPropertyDescriptor(globalThis, "self")).join());
