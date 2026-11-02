// A CommonJS file is sloppy code, where a store to a read-only property is dropped without a word. A built-in object of an executable is more than read-only:
// the program goes on with a member that it believes it has replaced. So the refusal throws in sloppy code too.
const attempt = change => { try { return "went through: " + String(change()); } catch (error) { return error.name; } };
const push = Array.prototype.push;
console.log("a store:", attempt(() => { Array.prototype.push = function () { return 0; }; }), Array.prototype.push === push);
console.log("a store under a computed name:", attempt(() => { Array.prototype[["pu", "sh"].join("")] = function () { return 0; }; }), Array.prototype.push === push);
console.log("a deletion:", attempt(() => delete Array.prototype.map), typeof [].map);
console.log("a new member of Object.prototype:", attempt(() => { Object.prototype.extra = 1; }), "extra" in {});
console.log("a definition:", attempt(() => Object.defineProperty(Array.prototype, "push", { value: 1 })), Array.prototype.push === push);
console.log("Reflect.set answers:", attempt(() => Reflect.set(Array.prototype, "push", 1)), Array.prototype.push === push);
/* Output:
a store: TypeError true
a store under a computed name: TypeError true
a deletion: TypeError function
a new member of Object.prototype: TypeError false
a definition: TypeError true
Reflect.set answers: went through: false true
*/
