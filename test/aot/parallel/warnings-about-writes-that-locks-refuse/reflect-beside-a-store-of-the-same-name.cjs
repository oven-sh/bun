// Build prints: 1 x warn: TS100014: this assignment has no effect: built-in objects are read-only in a compiled executable
// Build prints: 1 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
function attempt(label, write) { try { console.log(label, String(write())); } catch (error) { console.log(label, error.constructor.name); } }
attempt("Reflect.set", () => Reflect.set(Array.prototype, "push", 1));
attempt("a store", () => { Array.prototype.push = 1; return typeof Array.prototype.push; });
/* Output:
Reflect.set false
a store TypeError
*/
