// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
const root = typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : this; console.log(root === globalThis, typeof root.setTimeout);
