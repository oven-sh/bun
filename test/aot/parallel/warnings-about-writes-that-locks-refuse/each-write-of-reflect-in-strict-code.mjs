// Build prints: 4 x warn: TS100014: this assignment has no effect: built-in objects are read-only in a compiled executable
// Build prints: 0 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
function attempt(label, write) { try { console.log(label, String(write())); } catch (error) { console.log(label, error.constructor.name); } }
attempt("set, a new name", () => Reflect.set(Object.prototype, "marker", 1));
attempt("set, a function", () => Reflect.set(Array.prototype, "push", 1));
attempt("deleteProperty, a function", () => Reflect.deleteProperty(Object.prototype, "toString"));
attempt("defineProperty, a function", () => Reflect.defineProperty(Array.prototype, "shift", { value: 1 }));
/* Output:
set, a new name false
set, a function false
deleteProperty, a function false
defineProperty, a function false
*/
