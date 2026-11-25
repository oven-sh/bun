"use strict";
// A comparison with a literal, of a value from before the loop, that is kept and used twice: with and without another use of the value.
function usedAgain(x) { let c = 0; for (let i = 0; i < 24; i++) { const isConst = x === "const"; if (isConst) c += 20; c += isConst ? 1 : 3; } return c; }
function sharesOperand(x) { let c = 0; for (let i = 0; i < 24; i++) { const isConst = x === "const"; if (isConst) c += 2 + x.length; c += isConst ? 1 : 3; } return c + (x ? 1 : 0); }
const values = ["const", "let", "", "con" + String("st"), ("<const>").slice(1, -1), "Const", "const日".slice(0, 5), undefined, null, 0, true, {}, ["const"], new String("const"), Symbol.iterator, 5n];
for (let t = 0; t < 20; t++) { const line = values.map(usedAgain).join() + " " + values.map(sharesOperand).join(); if (t === 0 || t === 19) console.log(line); }
