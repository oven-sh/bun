// Under: --aot-check=Validate: with the ground of a position handed over unproven this store wrote behind the end of its list in silence; the verifier refuses that build at the store, and both words of --aot-harden stop it by name.
"use strict";
const show = list => list.length + ":" + JSON.stringify(list);
const make = n => Array.from({ length: n }, (_, i) => i + 0.5);
function f(v, w) { for (let i = 0; i + 2 < w.length; i += 3) { v[i] = i + 0.25; v[i + 1] = i + 0.25; } return v; }
for (const n of [0, 1, 2, 3, 8]) console.log(n, show(f(make(n), make(9))), show(f(make(9), make(n))));
