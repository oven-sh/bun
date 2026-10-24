// Objects inside objects: stored elsewhere. It prints what plain Bun prints.
interface Inner { d: number; e: number }
interface Outer { b: number; c: Inner }
interface Other { held: Inner; n: number }
function make(i: number): Outer { return { b: i, c: { d: i + 1, e: i + 2 } }; }
const inArray: Inner[] = [], inObject: Other[] = [], inMap = new Map<number, Inner>(), inAny: any[] = [], inClosure: (() => number)[] = [];
for (let i = 0; i < 4000; i++) {
  const c = make(i).c;
  switch (i % 5) {
    case 0: inArray.push(c); break;
    case 1: inObject.push({ held: c, n: i }); break;
    case 2: inMap.set(i, c); break;
    case 3: inAny.push(i % 2 ? c : [c]); break;
    case 4: inClosure.push(() => c.d + c.e); break;
  }
}
function churn() { let x = 0; for (let i = 0; i < 150000; i++) x += make(i).c.e; return x; }
for (let i = 0; i < 4; i++) { churn(); Bun.gc(i % 2 === 0); }
let s = 0;
for (const c of inArray) s += c.d; for (const o of inObject) s += o.held.e + o.n; for (const [k, c] of inMap) s += k + c.d;
for (const v of inAny) s += Array.isArray(v) ? v[0].e : v.d; for (const f of inClosure) s += f();
console.log(s);
async function across(i: number) { const c = make(i).c; await null; Bun.gc(true); await new Promise(r => setTimeout(r, 0)); return c.d + c.e; }
function* gen(i: number) { const c = make(i).c; yield 1; Bun.gc(true); yield c.d + c.e; }
console.log(await across(5), [...gen(6)].join());
