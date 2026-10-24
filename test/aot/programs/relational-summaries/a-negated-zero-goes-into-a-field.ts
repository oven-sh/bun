// `{ n: -i }` holds -0 in the round where i is 0: a field that is filled from a negation, a product or a remainder of integers is no field of integers. The run checks what every field holds against its type.
const show = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
function identity<T>(x: T): T {
  return x;
}
function negated(i: number): { n: number } {
  return { n: -i };
}
function product(i: number, j: number): { n: number } {
  return { n: i * j };
}
function remainder(i: number, j: number): { n: number } {
  return { n: i % j };
}
class Cell {
  constructor(public n: number) {}
}
const out: string[] = [];
for (let i = 0; i < 200; i++) {
  const o = { n: i };
  const p = { n: -i };
  const q = negated(i);
  const r = product(i, -1);
  const s = remainder(-i, 7);
  const t = new Cell(-i);
  identity(o).n++;
  if (i < 2 || i === 7) out.push([o.n, p.n, q.n, r.n, s.n, t.n, identity(p).n, 1 / p.n, 1 / q.n, 1 / t.n].map(show).join());
}
console.log(out.join(" | "));
