// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
function put(o, v) { o.self = v; } put(globalThis, 9); console.log(self, globalThis.self);
