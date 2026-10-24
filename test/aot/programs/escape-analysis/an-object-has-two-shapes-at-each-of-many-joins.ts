// At each join the object has two shapes, with and without a field, and behind the next store it has one again. However many such joins follow each other, it is never built.
type Late = { a: number; p1?: number; p2?: number; p3?: number; p4?: number; p5?: number; p6?: number };

function sixJoins(c: number, v: number): number {
  const o: Late = { a: v };
  if (c & 1) o.p1 = 1;
  o.p1 = (o.p1 ?? 10) + 1;
  if (c & 2) o.p2 = 1;
  o.p2 = (o.p2 ?? 10) + 1;
  if (c & 4) o.p3 = 1;
  o.p3 = (o.p3 ?? 10) + 1;
  if (c & 8) o.p4 = 1;
  o.p4 = (o.p4 ?? 10) + 1;
  if (c & 16) o.p5 = 1;
  o.p5 = (o.p5 ?? 10) + 1;
  if (c & 32) o.p6 = 1;
  o.p6 = (o.p6 ?? 10) + 1;
  return o.a + o.p1 + o.p2 * 2 + o.p3 * 3 + o.p4 * 4 + o.p5 * 5 + o.p6 * 6;
}

let total = 0;
for (let i = 0; i < 1000; i++) total = (total + sixJoins(i, i)) % 1000003;
console.log(total);
