interface Inner { d: number; e: number }
interface Outer { b: number; c: Inner }
function make(i: number): Outer { return { b: i, c: { d: i + 1, e: i + 2 } }; }
const a = make(1);
const spread = { ...a };
console.log(spread.c === a.c, JSON.stringify(spread));
const inner = { ...a.c };
console.log(inner === a.c, JSON.stringify(inner));
const t = make(100); const tc = t.c;
Object.assign(t, a);
console.log(t.c === a.c, tc.d, tc.e, t.b);
console.log(JSON.stringify(a), JSON.stringify(a.c), Object.keys(a).join(), Object.keys(a.c).join(), Object.entries(a.c).join("|"));
const clone = structuredClone(a);
console.log(clone.c !== a.c, JSON.stringify(clone), JSON.stringify(structuredClone(a.c)));
const both = structuredClone({ p: a, q: a.c });
console.log(both.p.c === both.q);
for (const k in a) console.log(k, typeof (a as any)[k]);
for (const k in a.c) console.log(k, (a.c as any)[k]);
console.log(Bun.inspect(a), Bun.deepEquals(a, make(1)), a.c === make(1).c);
const { c, ...rest } = a; console.log(c === a.c, JSON.stringify(rest));
const parsed: Outer = JSON.parse(JSON.stringify(a)); console.log(parsed.c.d + parsed.c.e + parsed.b);
