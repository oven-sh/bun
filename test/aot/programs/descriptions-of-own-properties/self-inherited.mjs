// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
const o = Object.create(globalThis); console.log(o.self === globalThis, o.self === o);
