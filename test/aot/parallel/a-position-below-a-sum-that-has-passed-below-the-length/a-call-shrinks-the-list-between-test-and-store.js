// Under: --aot-testing=EmittersAloneTestEveryPosition: the walk and its proofs as users build, every position tested where it is used: a store that is told inside and is not stops by name.
"use strict";
function say(word, value) { console.log("SAID " + word + " " + value); }
const shrink = new Function("v", "i", "if (i === 3) v.length = 1;");
function f(v) { let s = 0; for (let i = 0; i + 2 < v.length; i += 3) { shrink(v, i); v[i] = i + 0.25; v[i + 2] = i + 0.75; s++; } return s; }
const make = n => Array.from({ length: n }, (_, i) => i + 0.5);
for (const n of [0, 1, 2, 3, 4, 11, 12]) { const list = make(n); const given = f(list); say("length-" + n, list.length); say("given-" + n, given); say("list-" + n, JSON.stringify(list)); }
