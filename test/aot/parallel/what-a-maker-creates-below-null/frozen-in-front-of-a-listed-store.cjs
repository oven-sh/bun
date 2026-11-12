"use strict";
const N = Object.create(null);
N.a = 1;
if (process.argv[2] !== "open") Object.freeze(N);
let said = "stored";
try { N.b = 2; } catch (error) { said = error.constructor.name; }
console.log(said, N.a, N.b, Object.isFrozen(N), Object.keys(N).join());
