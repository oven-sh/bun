// Build prints: 3 x warn: TS100014: this assignment has no effect: built-in objects are read-only in a compiled executable
// Build prints: 0 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
function attempt(write) { try { return String(write()); } catch (error) { return error.constructor.name; } }
console.log(attempt(() => Reflect.set(Object.prototype, "marker", 1)), attempt(() => Reflect.deleteProperty(Object.prototype, "toString")), attempt(() => Reflect.set(Array.prototype, "push", 1)));
/* Output:
false false false
*/
