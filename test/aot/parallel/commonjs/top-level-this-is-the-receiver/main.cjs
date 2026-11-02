// `this` at the top of a CommonJS file is the receiver of the call of `function (exports, require, module, __filename, __dirname) { .. }`: the loader passes `module.exports` as it is at that moment, and a store to `exports` or to `module.exports` does not change it. Plain Bun's transpiler writes the variable `exports` in its place, so the expected output follows ECMAScript.
const first = exports;
console.log(this === first, this === module.exports);
exports = "stored";
console.log(this === first, typeof this);
module.exports = { replaced: true };
console.log(this === first, this === module.exports);
console.log((() => this === first)(), (() => () => typeof this)()());
{
  console.log(this === first);
}
function own() { return this === first; }
console.log(own(), own.call(first));
this.added = 1;
console.log(first.added, module.exports.added);
console.log(eval("this") === first);
require("./called-again.cjs");
require("./strict.cjs");
/* Output:
true true
true object
true false
true object
true
false true
1 undefined
true
first true
again 7 object receiver receiver
true true
*/
