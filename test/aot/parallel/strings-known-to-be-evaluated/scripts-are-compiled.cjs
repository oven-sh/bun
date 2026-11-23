// An indirect eval of a string that the build knows runs compiled code. The variables and functions that the script declares
// are properties of the global object, and the script sees no name of the file.
// COUNTER: InterpretedEvalCode = 0
// COUNTER: InterpretedFunctionCode = 0
var print = "of the file";
const evaluate = eval;
function load() {
  evaluate(
    "var total = 0, step = 2; function add(count) { for (var index = 0; index < count; index++) total += step; return total; } " +
      "const own = [typeof print, typeof require, this === globalThis, typeof arguments]; function readOwn() { return own.join(); } " +
      "for (var last = 0; last < 3; ) var last = last + 1; if (total === 0) { var found = typeof add; }"
  );
}
load();
console.log(add(10), total, last, found, readOwn(), typeof own);
console.log((0, eval)("var product = add(1) * 2; product + 1"), product);
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(globalThis, "product")), delete globalThis.product, typeof product);
total = 100;
console.log(add(1), globalThis.total, Object.keys(globalThis).includes("readOwn"));
globalThis.step = 5;
console.log(add(2), print);
load();
console.log(total, step, add(1));
