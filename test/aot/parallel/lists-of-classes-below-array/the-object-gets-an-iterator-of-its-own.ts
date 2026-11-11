// Symbol.iterator on the object itself, as a value and as a getter, and other names that change nothing.
class Row extends Array<number> {}
function two(list: Iterable<number>): string { const [a, b] = list; return a + "," + b; }
function all(list: Iterable<number>): string { return [...list].join(); }
const plain = new Row(); plain.push(1, 2, 3);
const named = new Row(); named.push(4, 5, 6); (named as any).label = "named";
const own = new Row(); own.push(7, 8, 9);
const got = new Row(); got.push(10, 11, 12);
let reads = 0;
const said: string[] = [];
for (let i = 0; i < 300; i++) {
  if (i === 100) (own as any)[Symbol.iterator] = function* () { yield 70; };
  if (i === 100) Object.defineProperty(got, Symbol.iterator, { configurable: true, get() { reads++; return Array.prototype[Symbol.iterator]; } });
  if (i === 200) { delete (own as any)[Symbol.iterator]; delete (got as any)[Symbol.iterator]; }
  const line = [two(plain), all(named), two(named), two(own), all(own), two(got), all(got), reads].join(" ");
  if (i % 100 === 0 || i % 100 === 99) said.push(line);
}
console.log(said.join("\n"));
