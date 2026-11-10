// An object is made in each turn and asked in its constructor whether it is of its class. Every turn stores an element, and one turn calls a function that lays Symbol.hasInstance on the class.
// The next turn must find it, so the guards of the question are not asked in front of the loop alone.
// STATISTIC: LoopsBuiltTwice >= 1
"use strict";
const far = v => [v][JSON.parse("0")];
let hits = 0;
function check(x) { return x instanceof Node_; }
class Node_ { constructor(kind, text) { this.ok = check(this); this.kind = kind & 7; this.text = text; } }
function run(i) { const made = new Node_(i, "t" + i); return (made.ok ? 1 : 0) + made.kind; }
function lay() { far(Object).defineProperty(far(Node_), far(Symbol).hasInstance, { configurable: true, value(o) { hits++; return false; } }); }
const out = [0, 0, 0, 0, 0, 0, 0, 0]; globalThis.out = out;
let sum = 0;
for (let i = 0; i < 600; i++) { sum += run(i & 7); out[i & 7] = i; if (i === 300) lay(); }
console.log(sum, hits, out.join());
