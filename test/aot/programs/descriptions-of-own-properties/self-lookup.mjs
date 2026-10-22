// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
console.log(typeof globalThis.__lookupGetter__("self"), typeof globalThis.__lookupSetter__("self"));
