const out: string[] = [];
const list: number[] = [];
for (let i = 0; i < 40; i++) list.push((i * 37 + 11) % 100);
function* source(values: number[]): Generator<number> { try { for (const value of values) { out.push("s" + value); yield value; } } finally { out.push("source ends"); } }
function* throws(n: number): Generator<number> { for (let i = 0; i < n; i++) { if (i === 3) throw new Error("source"); yield i; } }
function* evens(it: Iterable<number>): Generator<number> { for (const n of it) if (n % 2 === 0) yield n; }
function* take(it: Iterable<number>, count: number): Generator<number> { try { for (const n of it) { if (count-- <= 0) return; yield n; } } finally { out.push("take ends " + count); } }
function* map(it: Iterable<number>, change: (n: number) => number): Generator<number> { for (const n of it) yield change(n); }
function* twice(it: Iterable<number>): Generator<number> { for (const n of it) yield n; yield -1; for (const n of it) yield n; }
function* inLoop(it: Iterable<number>): Generator<number> { for (let i = 0; i < 2; i++) for (const n of it) { yield n; if (n > 50) break; } }
function* late(it: Iterable<number>): Generator<number> { yield 0; for (const n of it) yield n; yield 0; }
function* byHand(it: Generator<number>): Generator<number> { for (let step = it.next(); !step.done; step = it.next()) yield step.value; }
function* spread(it: Iterable<number>): Generator<number> { yield* [...it]; }
function* first(it: Iterable<number>): Generator<number> { const [a, b] = it; yield a; yield b; }
function sum(it: Iterable<number>, most = 1000): number { let total = 0; for (const n of it) { total += n; if (--most <= 0) break; } return total; }
for (let round = 0; round < 3; round++) {
  let total = 0;
  for (const n of take(evens(source(list)), 4)) total += n;
  for (const n of take(map(evens(source(list)), n => n * 2 + round), 3)) { total += n; if (n > 150) break; }
  for (const n of late(evens(source(list.slice(0, 5))))) total += n;
  for (const n of twice(evens(source(list.slice(0, 5))))) total += n;
  for (const n of inLoop(source(list.slice(0, 6)))) total += n;
  for (const n of byHand(source(list.slice(0, 3)))) total += n;
  for (const n of spread(evens(source(list.slice(0, 5))))) total += n;
  for (const n of first(evens(source(list)))) total += n;
  try { for (const n of take(evens(throws(6)), 9)) total += n; } catch (error) { out.push(String(error)); }
  const kept = source(list.slice(0, 6));
  for (const n of take(kept, 2)) total += n;
  for (const n of take(kept, 2)) total += n;
  const other = evens(source(list));
  total += sum(take(other, 3), 2) + sum(other, 2);
  out.push("total " + total);
}
const looked = evens(source([2, 4, 6]));
out.push(Object.prototype.toString.call(looked), [...take(looked, 2)].join());
console.log(out.join("\n"));
