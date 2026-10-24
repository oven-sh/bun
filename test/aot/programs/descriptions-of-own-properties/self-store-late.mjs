// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
function read() { return self; } console.log(read() === globalThis); globalThis.self = 7; console.log(read(), self);
