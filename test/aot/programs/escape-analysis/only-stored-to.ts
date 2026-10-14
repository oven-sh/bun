// An object that is only ever written to is not allocated, however the stores are written.
function assertNotAllocated(_: unknown): void {}
class P { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y } }
class Q { x = 1; y: number; constructor(y: number) { this.y = y } }
type Link = { next: Link | null; n: number };
function viaConstructor(a: number, b: number): number {
  const p = new P(a, b); //! removed
  assertNotAllocated(p);
  return p.x;
}
function viaInitializer(a: number): number {
  const q = new Q(a); //! removed
  assertNotAllocated(q);
  return q.y + q.x;
}
function storedLater(a: number): number {
  const p = { a: 0, b: 0 }; //! removed
  p.a = a;
  p.b = a + 1;
  assertNotAllocated(p);
  return a;
}
function nested(a: number): number {
  const inner = new P(a, a); //! removed
  const outer = { inner, a }; //! removed
  assertNotAllocated(inner);
  assertNotAllocated(outer);
  return a;
}
function cycle(a: number): number {
  const first: Link = { next: null, n: a }; //! removed
  const second: Link = { next: first, n: a }; //! removed
  first.next = second;
  assertNotAllocated(first);
  assertNotAllocated(second);
  return a;
}
function each(i: number): number {
  return viaConstructor(i, 1) + viaInitializer(i) + storedLater(i) + nested(i) + cycle(i);
}
let n = 0;
for (let i = 0; i < 4; i++) n += each(i);
console.log(n);
