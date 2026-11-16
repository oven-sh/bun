// An object that only a rare arm keeps is boxed before the branch: read as any value, handed to a call, held by another object. The arm sees the object as it was filled, and one object an iteration.
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } sum() { return this.x + this.y; } double() { return new Point(this.x * 2, this.y * 2); } }
class Named extends Point { name: string; constructor(x: number, name: string) { super(x, x + 1); this.name = name; } }
function Old(this: any, x: number) { this.x = x; this.z = x * 3; }
(Old as any).prototype.sum = function (this: any) { return this.x + this.z; };

const kept: any[] = [];
function pushes(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum() + p.x; if (i % every === 0) kept.push(p); } return total; }
function pushesTwice(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum(); if (i % every === 0) { kept.push(p, p); p.x = -1; } total += p.x; } return total; }
function holds(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); const pair = { left: p, right: [p, i] }; total += p.y + i; if (i % every === 0) kept.push(pair); } return total; }
function changes(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p: any = new Point(i, 2); p.x += 5; if (i & 1) p.y = i; total += p.sum(); if (i % every === 0) kept.push(p); } return total; }
function named(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p = new Named(i, "n" + (i & 3)); total += p.sum(); if (i % every === 0) kept.push(p, p.name); } return total; }
function old(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p = new (Old as any)(i); total += p.sum() + p.x; if (i % every === 0) kept.push(p); } return total; }
function thrown(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 1); try { if (i % every === 0) throw p; total += p.sum(); } catch (e) { total += (e as Point).x; kept.push(e); } } return total; }
function returned(n: number, at: number): any { for (let i = 0; i < n; i++) { const p = new Point(i, 4); if (p.sum() > at) return [p, p.double()]; } return null; }
function carried(n: number, every: number) { let last: Point | null = null, total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); total += p.sum(); if (i % every === 0) last = p; } return [total, last]; }
function either(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2), q = { x: i, p }; const chosen: any = i % every === 0 ? p : null; total += q.x + p.y; if (chosen) kept.push(chosen, q); } return total; }
function compared(n: number, every: number) { let same = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); const box: any = p; if (i % every === 0) { kept.push(p); if (kept[kept.length - 1] === box) same++; } } return same; }
function closed(n: number, every: number) { let total = 0; for (let i = 0; i < n; i++) { const p = new Point(i, 2); const read = () => p.x + i; total += p.y; if (i % every === 0) { kept.push(read); p.x = 100; } } return total; }

const show = (v: any): string => v === null ? "null" : typeof v === "function" ? "f" + v() : Array.isArray(v) ? "[" + v.map(show).join(",") + "]" : typeof v === "object" ? v.constructor.name + "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join(",") + "}" : String(v);
for (const every of [1, 7, 1000]) {
  for (const run of [pushes, pushesTwice, holds, changes, named, old, thrown, carried, either, compared, closed]) {
    kept.length = 0;
    const result = run(50, every);
    console.log(run.name, every, show(result), kept.length, kept.map(show).join(" ").slice(0, 300));
  }
  console.log("returned", show(returned(50, every)));
}
