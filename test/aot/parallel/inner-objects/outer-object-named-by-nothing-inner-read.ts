// The outer object is taken out of the only place that names it, and what lies in it is read behind allocations that collect.
class Payload { constructor(public v: number, public w: string) {} }
class Child { x: number; first: Payload; second: Payload | null; constructor(i: number) { this.x = i; this.first = new Payload(i, "w" + (i & 3)); this.second = null; } }
class Parent { c: Child; tag: number; constructor(i: number) { this.c = new Child(i); this.tag = i; } }
const box: { it: Parent | null }[] = [];
const N = 1500;
for (let i = 0; i < N; i++) box.push({ it: new Parent(i) });
function churn(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += [i, { a: i }, "x" + i].length; return s; }
function takeAndRead(slot: { it: Parent | null }, i: number): number {
  const p = slot.it!;
  slot.it = null;
  const c = p.c;
  const before = c.x;
  const made = churn(8);
  c.second = new Payload(before + made, "late");
  const more = churn(8);
  return c.x + c.first.v + c.first.w.length + c.second.v + c.second.w.length + more;
}
let sum = 0;
for (let i = 0; i < N; i++) sum += takeAndRead(box[i], i);
console.log(sum);
