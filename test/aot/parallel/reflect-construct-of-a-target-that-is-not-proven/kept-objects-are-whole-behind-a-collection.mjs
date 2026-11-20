class P { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }
const T = { P }, k = JSON.parse('"P"');
const kept = [];
for (let i = 0; i < 40; i++) { const o = Reflect.construct(T[k], [i, "s" + i]); if (i % 7 === 0) kept.push(o); }
Bun.gc(true);
console.log(kept.map((o) => JSON.stringify(o) + o.sum() + (o instanceof P)).join(" "));
