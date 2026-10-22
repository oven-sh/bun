const a: number[] = [1, 2, 3];
Object.assign(a, { 0: "text" });
console.log(a.map(n => n + 1).join());

const b: number[] = [1, 2, 3];
const between: Record<number, unknown> = {};
Object.assign(between, { 1: "mid" });
Object.assign(b, between);
console.log(b.map(n => n + 1).join(), b.reduce((sum, n) => sum + n, 0));

const c: number[] = [1, 2, 3];
Object.assign(c, { 5: 9 });
let seen = 0;
c.forEach(() => { seen++; });
console.log(c.length, seen, 4 in c, c.indexOf(9), c.join());

const d: number[] = [1, 2, 3];
Object.assign(d, "xy");
console.log(d.map(n => n + 1).join());

const e: number[] = [1, 2, 3];
Object.assign(e, { length: 1 });
console.log(e.length, e.join(), e[2]);

const f: number[] = [1, 2, 3];
const g = { ...f, 1: "spread" };
console.log(Object.keys(g).join(), g[1], f.join());

const h: number[] = [1.5, 2.5];
Object.assign(h, [true]);
for (const n of h) console.log(typeof n, n);
export {};
