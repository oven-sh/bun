// Under: --aot-testing=CheckBoundsInEmittersOnly: the walk and its proofs as users build, every position tested where it is used: a store that is told inside and is not stops by name.
"use strict";
function say(word, value) { console.log("SAID " + word + " " + value); }
const box = { at: -1 };
function f(v) { let s = 0; for (let i = 0; i + 2 < v.length; i += 3) { v[i] = box; v[i + 1] = box; v[i + 2] = box; s++; } return s; }
const make = n => Array.from({ length: n }, (_, i) => ({ at: i }));
for (const n of [0, 1, 2, 3, 4, 11, 12]) { const list = make(n); const given = f(list); say("length-" + n, list.length); say("given-" + n, given); say("list-" + n, JSON.stringify(list)); }
