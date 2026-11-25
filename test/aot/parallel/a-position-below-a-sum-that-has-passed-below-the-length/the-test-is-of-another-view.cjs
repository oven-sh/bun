// Under: --aot-check=Validate: with the ground of a position handed over unproven this program answered wrongly in silence; the verifier refuses that build, and both words of --aot-harden stop it by name.
"use strict";
const bytes = new Uint8Array(11).map((_, i) => i + 1);
const short = new Uint8Array(4).fill(5);
function f(a, b) { let s = ""; for (let i = 0; i + 2 < b.length; i += 3) s += a[i] + "," + a[i + 1] + "," + a[i + 2] + ";"; return s; }
console.log(f(short, bytes), f(bytes, short));
