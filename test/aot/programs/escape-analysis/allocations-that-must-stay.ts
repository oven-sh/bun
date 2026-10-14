// Allocations that must not be removed: the program behaves as under plain Bun.
const sink: { a: number }[] = [];
function stored(a: number): number {
  const p = { a }; //! heap: CallBuiltin
  sink.push(p);
  return p.a;
}
function returned(a: number): { a: number } {
  return { a }; //! heap
}
function merged(a: number, c: boolean): number {
  const p = c ? { a } : { a: a + 1 }; //! heap: a block parameter
  return p.a;
}
function same(a: number): boolean {
  const p = { a }; //! heap: CallBuiltin
  sink.push(p);
  return sink[sink.length - 1] === p;
}
let n = 0;
const held: { a: number }[] = [];
for (let i = 0; i < 4; i++) { held.push(returned(i)); n += stored(i) + merged(i, i % 2 === 0) + (same(i) ? 10 : 0); }
console.log(n, sink.length, held.length, held[3].a);
