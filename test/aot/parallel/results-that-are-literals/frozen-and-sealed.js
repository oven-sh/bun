"use strict";
function id(x) { return x; }
const frozen = id(Object.freeze({ a: 1 })), plain = id({ b: 2 });
let threw = false;
try { frozen.b = 1; } catch { threw = true; }
plain.a = 5;
console.log(threw, frozen.b, plain.a, Object.isFrozen(frozen), Object.isFrozen(plain));
