// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
Object.defineProperty(globalThis, "self", { get() { return "mine"; }, configurable: true }); console.log(self, globalThis.self);
