// A closure reads a field between two stores into it, and what it returns is needed behind the loop or in the next iteration alone. The first store is needed then.
// STATISTIC: OverwrittenSlotStoresDropped >= 1
const said = [];
function arrow(n) { const o = { v: 0, w: 1 }; const get = () => o.v; let other = 1; for (let i = 0; i < n; i++) { o.v = i; other = get(); o.v = 3; } return [o.v, other].join("/"); }
function twice(n) { const o = { v: 0, w: 1 }; const get = () => o.v * 2; let other = 1; let i = 0; while (i++ < n) { o.v = i; other = get(); o.v = 3; } return [o.v, other].join("/"); }
function picked(n) { const o = { v: 0, w: 1 }; const p = o; const get = [() => p.v * 2, function () { return p.v; }][n & 1]; let other = 1, i = 0; while (o.v < 10 && i++ < n) { o.v = i; other = get(); o.v = 3; } return [o.v, other].join("/"); }
function round(n) { const o = { v: 0 }; const get = () => o.v; let last = 0, sum = 0; for (let i = 0; i < n; i++) { o.v = i * 0.5; sum = last; last = get(); o.v = -1; } return [o.v, last, sum].join("/"); }
function some(n) { const o = { v: 0, w: 0 }; const get = () => o.v; let other = 7; for (let i = 0; i < n; i++) { o.v = "s" + i; other = i & 1 ? get() : other; o.v = "t"; } return [o.v, other].join("/"); }
function method(n) { const o = { v: 0 }; const holder = { get: () => o.v, get now() { return o.v; } }; let a = 0, b = 0; for (let i = 0; i < n; i++) { o.v = [i]; a = holder.get(); o.v = { i }; b = holder.now; o.v = null; } return JSON.stringify([o.v, a, b]); }
function kept(n) { const o = { v: 0 }; const all = []; for (let i = 0; i < n; i++) { o.v = i; all.push(() => o.v); o.v = i + 1; } return all.map(f => f()).join("/"); }
function never(n) { const o = { v: 0, w: 1 }; for (let i = 0; i < n; i++) { o.v = i; o.w = i; o.v = i + 1; } return o.v + "/" + o.w; }
function never2(n, o) { for (let i = 0; i < n; i++) { o.v = i; o.v = i + 1; o.w = i; } return o.v + "/" + o.w; }
for (const n of [0, 1, 2, 9, 12]) said.push("arrow " + arrow(n));
for (const n of [0, 1, 2, 9, 12]) said.push("twice " + twice(n));
for (const n of [0, 1, 2, 9, 12]) said.push("picked " + picked(n));
for (const n of [0, 1, 2, 9, 12]) said.push("round " + round(n));
for (const n of [0, 1, 2, 9, 12]) said.push("some " + some(n));
for (const n of [0, 1, 2, 9, 12]) said.push("method " + method(n));
for (const n of [0, 1, 2, 9, 12]) said.push("kept " + kept(n));
for (const n of [0, 1, 2, 9, 12]) said.push("never " + never(n));
said.push(never2(4, { v: 9, w: 9 }));
console.log(said.join("\n"));
