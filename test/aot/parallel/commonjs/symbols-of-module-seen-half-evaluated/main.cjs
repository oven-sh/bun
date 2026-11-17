// A module on a cycle reads the symbols of a module whose body has not ended: the keys are undefined there and the symbols everywhere else, in one and the same function.
"use strict";
const early = require("./symbols.cjs");
const { make, read } = require("./holder.cjs");
const late = make(1, 2);
console.log(Reflect.ownKeys(late).map(String).join(","), read(late));
console.log(Object.keys(early).join(","), typeof early.kFirst, require("./holder.cjs").sawAtStart);
