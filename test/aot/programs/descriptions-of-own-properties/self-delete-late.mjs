// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
function kind() { return typeof self; } console.log(kind()); delete globalThis.self; console.log(kind());
