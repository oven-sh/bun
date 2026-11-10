// x = left; y = right; left = 5; z = right; w = left: the look at right stands inside the stretch of left.
// STATISTIC: StaticFieldsAccessedOnLookOfTheirArms >= 0
"use strict";
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const through = new Function("x", "return x");
class Pair { static left = 1; static right = 2; }
function weave(turns) { let sum = 0; for (let i = 0; i < turns; i++) { const x = Pair.left; const y = Pair.right; Pair.left = i; const z = Pair.right; const w = Pair.left; Pair.right = x + 1; sum = (Math.imul(sum, 31) + x + y * 3 + z * 5 + w * 7 + Pair.right * 11 + Pair.left * 13) | 0; } return sum; }
tell(() => weave(3000)); tell(() => Pair.left + ":" + Pair.right);
console.log(said.join(" | "));
