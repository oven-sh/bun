// `"one" in barrel`, where barrel is `export * from "./leaf"` as TypeScript emits it for CommonJS and nobody has looked at it yet. What the star will define is an accessor. The answer is given without making it, in a slot that holds no value, and such a slot may not say that it is an accessor's: a Bun with assertions stopped here.
// COUNT: counter:StarsRecorded = 1
// COUNT: counter:StarsCarriedOutLate = 0
"use strict";
const barrel = require("./barrel.js");
console.log("one" in barrel, "missing" in barrel, Reflect.has(barrel, "one"));
