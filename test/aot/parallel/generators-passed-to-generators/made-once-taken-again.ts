const out: unknown[] = [];
let made = 0;
const next = () => { out.push("next " + ++made); return made; };
function* source(values: number[]): Generator<number> { for (const value of values) yield value; }
function* counted(values: number[], start = next()): Generator<number> { for (const value of values) yield value + start; }
function* named({ first, second }: { first: number; second: number }): Generator<number> { yield first; yield second; }
function* kept(values: number[]): Generator<number> { const read = () => values.length; yield read(); values = [1, 2, 3]; yield read(); }
function* throwing(values: number[], start: number = (() => { throw new Error("default"); })()): Generator<number> { yield start + values.length; }
function* take(it: Iterable<number>, count: number): Generator<number> { for (const n of it) { if (count-- <= 0) return; yield n; } }
function* all(it: Iterable<number>): Generator<number> { for (const n of it) yield n; }
function* twoStages(it: Iterable<number>, add = next()): Generator<number> { for (const n of it) yield n + add; }
const object = { get first() { out.push("get first"); return 1; }, get second() { out.push("get second"); return 2; } };
function outside() { const g = source([1, 2, 3, 4, 5, 6]); for (let round = 0; round < 3; round++) for (const n of take(g, 2)) out.push(n); }
function outsideWhile() { const g = source([1, 2, 3]); let round = 0; while (round++ < 2) for (const n of all(g)) out.push(n); }
function outsideSpread() { const g = source([1, 2, 3]); for (let round = 0; round < 2; round++) out.push([...all(g)].join()); }
function conditional(way: boolean) { const g = source([7, 8]); if (way) for (const n of all(g)) out.push(n); else for (const n of take(g, 1)) out.push(-n); }
function inside() { for (let round = 0; round < 2; round++) { for (const n of take(source([1, 2, 3]), 2)) out.push(n); for (const n of all(take(all(source([4, 5])), 1))) out.push(n); } }
function heads() {
  for (let round = 0; round < 2; round++) for (const n of all(counted([10, 20]))) out.push(n);
  for (const n of all(twoStages(counted([100])))) out.push(n);
  for (const n of all(named(object))) out.push(n);
  for (const n of all(kept([1]))) out.push(n);
  try { for (const n of all(throwing([1]))) out.push(n); } catch (error) { out.push(String(error)); }
  for (const n of take(counted([1, 2, 3]), next())) out.push(n);
}
const g = source([1, 2, 3, 4]);
for (let round = 0; round < 2; round++) for (const n of take(g, 1)) out.push("module " + n);
for (let round = 0; round < 3; round++) { outside(); outsideWhile(); outsideSpread(); conditional(round % 2 === 0); inside(); heads(); }
console.log(out.join(" "));
