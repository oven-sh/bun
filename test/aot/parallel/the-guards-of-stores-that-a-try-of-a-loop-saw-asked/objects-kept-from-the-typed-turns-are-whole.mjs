class P { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
function make(C, ...all) { return Reflect.construct(C, all); }
globalThis.kept = make;
function run(n) { const list = []; for (let i = 0; i < n; i++) { const o = make(P, i, "k" + i); if (i % 3 === 0) list.push(o); } Bun.gc(true); return list.map((o) => JSON.stringify(o) + o.sum() + (o instanceof P)).join(" "); }
console.log(run(Number("8")));
