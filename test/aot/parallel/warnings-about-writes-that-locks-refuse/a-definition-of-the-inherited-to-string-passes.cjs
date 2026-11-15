// Build prints: 0 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
// Build prints: 0 x warn: TS100014: this assignment fails unless it keeps the value that the function inherits: built-in objects are read-only in a compiled executable
Object.defineProperty(WeakSet, "toString", { value: WeakSet.toString });
console.log(Object.hasOwn(WeakSet, "toString"), WeakSet.toString === Function.prototype.toString, String(WeakSet).slice(0, 8));
/* Output:
true true function
*/
