// A script declares all of its names or none.
const evaluate = eval;
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.name + ": " + error.message;
  }
};
require("node:vm").runInThisContext("let lexical = 1; const constant = 2;");
Object.defineProperty(globalThis, "fixed", { value: 3, configurable: false, writable: false, enumerable: false });
Object.defineProperty(globalThis, "accessor", { get: () => 4, set: value => console.log("set", value), configurable: false });
console.log(attempt(() => evaluate("var first = 1, lexical = 2;")), typeof first);
console.log(attempt(() => evaluate("var second = 1; function constant() {}")), typeof second);
console.log(attempt(() => evaluate("var third = 1; function fixed() {}")), typeof third);
console.log(attempt(() => evaluate("var fixed = 5; fixed")), attempt(() => evaluate("function accessor() {}")));
console.log(attempt(() => evaluate("var accessor = 6; accessor")));
console.log(attempt(() => evaluate("var fourth = 1; throw new TypeError('thrown ' + fourth);")), fourth);
console.log(attempt(() => evaluate("'use strict'; var fifth = 1; typeof fifth")), typeof fifth);
Object.preventExtensions(globalThis);
console.log(attempt(() => evaluate("var sixth = 1;")), typeof sixth, attempt(() => evaluate("var fourth = 7; fourth")));
