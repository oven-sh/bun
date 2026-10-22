// The result of a require that is only tested: `typeof a`, `!a`, `a == null`, `a ? .. : ..`. For a module that exports names it is an object. A module that is one value can be zero, a function or null. An ES module gives its namespace object.
const names = require("./names.cjs"),
  zero = require("./zero.cjs"),
  f = require("./function.cjs"),
  nothing = require("./null.cjs"),
  es = require("./es.mjs");
console.log(typeof names, !names, names == null, names ? "truthy" : "falsy");
console.log(typeof zero, !zero, zero == null, zero ? "truthy" : "falsy");
console.log(typeof f, !f, f == null, f ? "truthy" : "falsy");
console.log(typeof nothing, !nothing, nothing == null, nothing ? "truthy" : "falsy");
console.log(typeof es, !es, es == null, es ? "truthy" : "falsy");
