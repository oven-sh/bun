// The class is handed out, so the constructor's store stands behind a guard that the loop asks in front. Between two runs of the loop a setter is laid above the objects, then taken away again. What is printed is what plain Bun prints.
"use strict";
const Meter = class { constructor(v) { this.v = v; } };
globalThis.kept = Meter;
const seen = [];
function total(t) { let s = t & 1; for (let i = 0; i < 64; i++) s = (s + new Meter(i).v) | 0; return s; }
const told = [total(0), total(1)];
Object.defineProperty(globalThis.kept.prototype, "v", { set(x) { if (x > 61) seen.push(x); }, get() { return 2; }, configurable: true });
told.push(total(0), seen.join());
delete globalThis.kept.prototype.v;
told.push(total(1), seen.join());
console.log(told.join(" "));
