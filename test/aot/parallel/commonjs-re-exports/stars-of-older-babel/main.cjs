// export * as Babel 6 and 7 wrote it: without the comparison of names, with a list of own names, with getters that bear a name.
"use strict";
var named = require("./named.cjs");
var listed_named = require("./listed-named.cjs");
var babel_7_0 = require("./babel-7-0.cjs");
var babel_6 = require("./babel-6.cjs");
var listed_7_0 = require("./listed-7-0.cjs");
var listed_7_0_named = require("./listed-7-0-named.cjs");
function run(n) {
  let s = 0;
  for (let i = 0; i < n; i++) s += (0, named.add)(i, 0) + (0, listed_named.add)(i, 1) + (0, babel_7_0.add)(i, 2) + (0, babel_6.add)(i, 3) + (0, listed_7_0.add)(i, 4) + (0, listed_7_0_named.add)(i, 5);
  return s;
}
console.log(run(20));
for (const lib of [named, listed_named, babel_7_0, babel_6, listed_7_0, listed_7_0_named]) console.log(Object.keys(lib).sort().join(), lib.__esModule, lib.default, lib.own, lib.sub(5, 3), lib.calls(), JSON.stringify(Object.getOwnPropertyDescriptor(lib, "add")));
