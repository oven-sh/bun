// A default in a pattern is not what is stored.
for (const name of ["array", "object", "loop", "nested"]) {
  const m = require("./" + name + ".cjs");
  console.log(name, typeof m.f(), m.f() === m);
}
const array = require("./array.cjs"), object = require("./object.cjs"), loop = require("./loop.cjs"), nested = require("./nested.cjs");
console.log(array.f() === array, object.f() === object, loop.f() === loop, nested.f() === nested);
