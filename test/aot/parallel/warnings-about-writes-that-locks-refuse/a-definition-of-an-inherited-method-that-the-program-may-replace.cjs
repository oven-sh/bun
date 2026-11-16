// The program may replace Function.prototype.toString, so WeakSet can't have it as its own: the build warns and the definition throws.
// Build prints: 1 x warn: TS100014: this assignment throws if it runs: built-in objects are read-only in a compiled executable
// Build prints: 0 x warn: TS100014: this assignment fails unless it keeps the value that the function inherits: built-in objects are read-only in a compiled executable
const key = JSON.parse('"toString"');
const of = object => { try { object[key] = () => "replaced"; return "stored"; } catch (error) { return error.constructor.name; } };
try {
  Object.defineProperty(WeakSet, "toString", { value: WeakSet.toString });
  console.log("defined", Object.hasOwn(WeakSet, "toString"));
} catch (error) {
  console.log(error.constructor.name, Object.hasOwn(WeakSet, "toString"));
}
console.log(of({}), of(Function.prototype) === "stored", WeakSet.toString === Function.prototype.toString);
/* Output:
TypeError false
stored true true
*/
