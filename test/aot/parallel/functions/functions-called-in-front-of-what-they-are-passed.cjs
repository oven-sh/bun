// Flags: --aot-harden=proof-checks
// for (const f of list) f(x); let x = 1; the call ends before it is made, so nothing is ever passed to the functions of the list, which store into what they are passed.
"use strict";
const log = console.log;
const run = (fs, t) => { for (const f of fs) f(t, t, o); let o = { label: t }; return o.label; };
const decorate = (decorators, target, key) => { for (const d of decorators) desc = d(target, key, desc) || desc; let desc = Object.getOwnPropertyDescriptor(target, key); Object.defineProperty(target, key, desc); };
const rows = JSON.parse("[{},{},{}]"), counted = [];
try { log(run([(t, k, d) => { const inner = d.value; d.value = function () { counted.push(k); return inner.call(this) + 1; }; }], 1)); } catch (error) { log(error.name + ": " + error.message); }
try { log(run([(t, d) => ({})], 2)); } catch (error) { log(error.name + ": " + error.message); }
log(run([], 3));
class Box { constructor(w) { this.w = w; } twice() { return this.w * 2; } }
try { decorate([(t, k, d) => { const inner = d.value; d.value = function () { counted.push(k); return inner.call(this) + 1; }; }], Box.prototype, "twice"); log("decorated"); } catch (error) { log(error.name + ": " + error.message); }
try { decorate([(t, k, d) => ({ ...d, get() { return 5; } })], Box.prototype, "twice"); log("decorated"); } catch (error) { log(error.name + ": " + error.message); }
decorate([], Box.prototype, "twice");
Object.defineProperty(rows[2], "label", { value: "own" });
log(rows[2].label, new Box(3).twice(), counted.length);
const step = (fs, n) => { let sum = 0; for (let i = 0; i < n; i++) { for (const f of fs) sum += f(at, i); } let at = { value: 1 }; return at.value + sum; };
for (const n of [0, 1, 3]) { try { log(step([(p, i) => { p.value = i; return p.value; }, p => 1], n)); } catch (error) { log(error.name); } log(step([], n)); }
