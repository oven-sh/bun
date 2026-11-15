// Symbol.iterator on the class: written in it, laid on its prototype while the program runs, in the middle of a chain of classes, and taken away again.
class Row extends Array<number> {}
class Middle extends Array<number> {}
class Below extends Middle {}
class Own extends Array<number> { *[Symbol.iterator](): Generator<number> { yield 70; yield 80; } }
function two(list: Iterable<number>): string { const [a, b] = list; return a + "," + b; }
function all(list: Iterable<number>): string { return [...list].join(); }
const row = new Row(); row.push(1, 2, 3);
const below = new Below(); below.push(4, 5, 6);
const own = new Own(); own.push(7, 8, 9);
const said: string[] = [];
for (let i = 0; i < 400; i++) {
  if (i === 100) (Row.prototype as any)[Symbol.iterator] = function* () { yield 10; yield 20; yield 30; };
  if (i === 200) (Middle.prototype as any)[Symbol.iterator] = function* () { yield 40; };
  if (i === 300) { delete (Row.prototype as any)[Symbol.iterator]; delete (Middle.prototype as any)[Symbol.iterator]; }
  const line = [two(row), all(row), two(below), all(below), two(own), all(own)].join(" ");
  if (i % 100 === 0 || i % 100 === 99) said.push(line);
}
console.log(said.join("\n"));
