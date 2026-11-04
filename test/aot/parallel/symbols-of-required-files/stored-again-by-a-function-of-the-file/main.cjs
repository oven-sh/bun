// What a CommonJS file exports is found by whoever requires it as its body left it. ONE DEED: a function of the file stores another symbol under the name.
"use strict";
const symbols = require("./symbols.cjs");
const look = () => { const o = {}; o[symbols.kA] = 1; o[symbols.kB] = 2; return Reflect.ownKeys(o).map(String).join(); };
console.log(look());
symbols.renew();
console.log(look());
console.log(require("./later.cjs"));
