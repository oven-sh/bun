// The collector is told of a young object stored into an old one: nothing else holds it while small collections run.
// COUNT: counter:BuiltinSubclassStructuresAccepted >= 1
// COUNT: counter:BuiltinSubclassStructuresRejected = 0
"use strict";
class H extends Map { constructor() { super(); this.n = null; this.m = 0; } }
const old = []; for (let i = 0; i < 64; i++) old.push(new H());
Bun.gc(true); Bun.gc(true);
const far = v => [v][JSON.parse("0")];
function make(t) { return { v: t, w: t + 1, x: t + 2 }; }
function store(t) { for (let i = 0; i < 64; i++) { const heir = old[i]; heir.n = make(t + i); heir.m = t; } }
function churn(t) { let last = null; for (let i = 0; i < 400000; i++) last = { v: -1, w: i, x: last === null ? 0 : last.w }; return last.x; }
function deep(k, t) { return k === 0 ? churn(t) : deep(k - 1, t) + 1; }
const storeFromAfar = far(store), deepFromAfar = far(deep);
const turns = +(process.argv[2] ?? 30); let sum = 0, wrong = 0;
for (let t = 0; t < turns; t++) { storeFromAfar(t); sum = (sum + deepFromAfar(24, t)) % 1000003; for (let i = 0; i < 64; i++) { const got = old[i].n; if (got.v !== t + i || got.w !== t + i + 1 || got.x !== t + i + 2) wrong++; } }
console.log(sum, wrong, old[63].m);
