// Fields added late one after the other in many orders.
class Wide {
  id: number;
  a?: Wide | number;
  b?: Wide | number;
  c?: Wide | number;
  d?: Wide | number;
  e?: Wide | number;
  f?: Wide | number;
  g?: Wide | number;
  h?: Wide | number;
  i?: Wide | number;
  j?: Wide | number;
  k?: Wide | number;
  l?: Wide | number;
  m?: Wide | number;
  n?: Wide | number;
  o?: Wide | number;
  p?: Wide | number;
  constructor(id: number) {
    this.id = id;
  }
}
const setters: ((wide: Wide, value: Wide | number) => void)[] = [
  (wide, value) => { wide.a = value; },
  (wide, value) => { wide.b = value; },
  (wide, value) => { wide.c = value; },
  (wide, value) => { wide.d = value; },
  (wide, value) => { wide.e = value; },
  (wide, value) => { wide.f = value; },
  (wide, value) => { wide.g = value; },
  (wide, value) => { wide.h = value; },
  (wide, value) => { wide.i = value; },
  (wide, value) => { wide.j = value; },
  (wide, value) => { wide.k = value; },
  (wide, value) => { wide.l = value; },
  (wide, value) => { wide.m = value; },
  (wide, value) => { wide.n = value; },
  (wide, value) => { wide.o = value; },
  (wide, value) => { wide.p = value; },
];
function numberOf(value: Wide | number | undefined): number {
  return value === undefined ? 0 : typeof value === "number" ? value : value.id;
}
function sumOf(wide: Wide): number {
  return (
    numberOf(wide.a) + 2 * numberOf(wide.b) + 3 * numberOf(wide.c) + 4 * numberOf(wide.d) + 5 * numberOf(wide.e) + 6 * numberOf(wide.f) +
    7 * numberOf(wide.g) + 8 * numberOf(wide.h) + 9 * numberOf(wide.i) + 10 * numberOf(wide.j) + 11 * numberOf(wide.k) + 12 * numberOf(wide.l) +
    13 * numberOf(wide.m) + 14 * numberOf(wide.n) + 15 * numberOf(wide.o) + 16 * numberOf(wide.p)
  );
}
let seed = 12345;
function next(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed % limit;
}
const kept: Wide[] = [];
const expected: number[] = [];
let total = 0;
for (let round = 0; round < 40000; round++) {
  const wide = new Wide(round);
  const count = next(17);
  let sum = 0;
  const taken = new Set<number>();
  for (let step = 0; step < count; step++) {
    const which = next(16);
    const value = step % 3 === 0 ? wide : step + 1;
    if (taken.has(which)) continue;
    taken.add(which);
    setters[which](wide, value);
    sum += (which + 1) * numberOf(value);
    if (sumOf(wide) !== sum) throw new Error("round " + round + " step " + step + ": " + sumOf(wide) + " is not " + sum);
  }
  total = (total + sum) % 1000003;
  if (round % 16 === 0) {
    kept.push(wide);
    expected.push(sum);
  }
  if (round % 10000 === 9999) Bun.gc(true);
}
let wrong = 0;
for (let index = 0; index < kept.length; index++) if (sumOf(kept[index]) !== expected[index]) wrong++;
const inOrder = new Wide(7);
for (let which = 0; which < 16; which++) setters[which](inOrder, which + 1);
const backwards = new Wide(8);
for (let which = 15; which >= 0; which--) setters[which](backwards, which + 1);
console.log(total, wrong, kept.length, sumOf(inOrder), sumOf(backwards), Object.keys(inOrder).join(""), Object.keys(backwards).join(""));
