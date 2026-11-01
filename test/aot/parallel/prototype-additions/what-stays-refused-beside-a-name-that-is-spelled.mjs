// A new name that a file spells is let in. What replaces a member stays refused, and so does a name that the build cannot read.
const attempt = (what, write) => {
  try { write(); console.log(what, "done"); } catch (error) { console.log(what, error.name, error.message.split(" (")[0]); }
};
const computed = ["made", "up$"].join("");
attempt("a spelled name", () => { Function.prototype.spelled$ = 1; });
attempt("a computed name", () => { Function.prototype[computed] = 1; });
attempt("a spelled name on Object.prototype", () => { Object.prototype.spelled$ = 1; });
attempt("a computed name on Object.prototype", () => { Object.prototype[computed] = 1; });
attempt("Function.prototype.call", () => { Function.prototype.call = function () {}; });
attempt("Array.prototype.sort", () => { Array.prototype.sort = function () {}; });
attempt("Object.prototype.hasOwnProperty", () => { Object.prototype.hasOwnProperty = function () {}; });
attempt("delete Function.prototype.apply", () => { delete Function.prototype.apply; });
attempt("a symbol", () => { Function.prototype[Symbol.iterator] = 1; });
console.log((function () {}).spelled$, (function () {})[computed], [3, 1, 2].sort().join(), typeof Function.prototype.call);
/* Output:
a spelled name done
a computed name TypeError Cannot assign to Function.prototype.madeup$ because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in Function.prototype.madeup$ = value
a spelled name on Object.prototype TypeError Cannot assign to Object.prototype.spelled$ because built-in objects are read-only in a compiled executable
a computed name on Object.prototype TypeError Cannot assign to Object.prototype.madeup$ because built-in objects are read-only in a compiled executable
Function.prototype.call TypeError Cannot assign to Function.prototype.call because built-in objects are read-only in a compiled executable
Array.prototype.sort TypeError Cannot assign to Array.prototype.sort because built-in objects are read-only in a compiled executable
Object.prototype.hasOwnProperty TypeError Cannot assign to Object.prototype.hasOwnProperty because built-in objects are read-only in a compiled executable
delete Function.prototype.apply TypeError Cannot delete Function.prototype.apply because built-in objects are read-only in a compiled executable
a symbol TypeError Cannot assign to Function.prototype[Symbol(Symbol.iterator)] because built-in objects are read-only in a compiled executable
1 undefined 1,2,3 function
*/
