// The prototype of the global object is asked to change, and the global object is asked for its own names behind that.
var root = globalThis;
function attempt(name, f) { try { console.log(name, String(f())); } catch (e) { console.log(name, "threw", e.name + ": " + String(e.message).slice(0, 70)); } }
attempt("setPrototypeOf(globalThis, Map.prototype)", () => Object.setPrototypeOf(root, Map.prototype) === root);
attempt("Reflect.setPrototypeOf", () => Reflect.setPrototypeOf(root, Map.prototype));
attempt("__proto__ =", () => { root.__proto__ = Map.prototype; return Object.getPrototypeOf(root) === Map.prototype; });
attempt("prototype now", () => Object.getPrototypeOf(root) === Map.prototype ? "Map.prototype" : Object.getPrototypeOf(root) === Object.prototype ? "Object.prototype" : Object.prototype.toString.call(Object.getPrototypeOf(root)));
attempt("hasOwn toStringTag", () => Object.hasOwn(root, Symbol.toStringTag));
attempt("hasOwn console", () => Object.hasOwn(root, "console"));
attempt("same prototype again", () => Object.setPrototypeOf(root, Object.getPrototypeOf(root)) === root);
attempt("null", () => Object.setPrototypeOf(root, null) === root);
