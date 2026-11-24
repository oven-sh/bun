// Under: --aot-check=Validate: with the ground of a position handed over unproven this program answered wrongly in silence; the verifier refuses that build, and both words of --aot-harden stop it by name.
"use strict";
const bytes = new Uint8Array(11).map((_, i) => i + 1);
function f(v) { let s = ""; for (let i = 0; i + 2 < v.length; i += 1) { i += 5; s += v[i] + "," + v[i + 1] + ";"; } return s; }
console.log(f(bytes));
