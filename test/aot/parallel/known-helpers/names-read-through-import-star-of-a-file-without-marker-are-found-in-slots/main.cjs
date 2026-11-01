// `const dep = helpers.__importStar(require("./plain.cjs"))`, the helper out of another file: the holder is the file's own exports or the object of bindings, and a read in a loop looks nothing up in either.
// COUNT: arrivals <= 60
"use strict";
const helpers_1 = require("./helpers.cjs");
const dep = helpers_1.__importStar(require("./plain.cjs"));
function turn(i) { return dep.add(i, dep.two); }
let sum = 0;
for (let i = 0; i < 2000; i++) sum += turn(i & 7);
console.log(sum, dep.default.two, Object.keys(dep).join());
