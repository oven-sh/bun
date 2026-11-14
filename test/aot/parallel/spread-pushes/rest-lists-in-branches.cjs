// A rest list is the literal only on the ways that append it.
"use strict";
let n = 0; function f(...xs) { const list = []; if (n++ % 2) { list.push(...xs); return list; } return [list, "not"]; }
const show = (value) => Array.isArray(value) ? "[" + Array.from(value, (item, k) => (k in value ? "" : "hole ") + show(item)).join() + "]" : typeof value + " " + String(value);
let text = "";
function once(k) { const a = f(k, 2), b = f(), c = f("s", k / 2, k), d = f(k); return show(a) + show(b) + show(c) + show(d); }
for (let k = 0; k < 200; k++) { const next = once(k % 5); if (k < 12) console.log(next); text = next; }
console.log(text);
