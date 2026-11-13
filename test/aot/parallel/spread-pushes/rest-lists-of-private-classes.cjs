// STATISTIC: RestListsUsedAsLiterals >= 2
"use strict";
class W { static #n = 0; #l = []; constructor(...xs) { W.#n++; this.#l.push(...xs); } add(x) { this.#l.push(x); return this.#l; } } function f(...xs) { return new W(...xs, 1).add("w"); }
const show = (value) => Array.isArray(value) ? "[" + Array.from(value, (item, k) => (k in value ? "" : "hole ") + show(item)).join() + "]" : typeof value + " " + String(value);
let text = "";
function once(k) { const a = f(k, 2), b = f(), c = f("s", k / 2, k), d = f(k); return show(a) + show(b) + show(c) + show(d); }
for (let k = 0; k < 200; k++) { const next = once(k % 5); if (k < 12) console.log(next); text = next; }
console.log(text);
