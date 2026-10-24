// Methods under a well-known symbol, a symbol of the program and an index. One object of the class gets an own property under each of the keys in the middle of a loop, the others keep the methods.
const mark = Symbol("mark");
class Row {
  cells: number[];
  constructor(cells: number[]) { this.cells = cells; }
  *[Symbol.iterator](): Generator<number> { yield* this.cells; }
  [Symbol.toPrimitive](): number { return this.cells.length; }
  [mark](): number { return this.cells[0]; }
  0(): number { return this.cells[1]; }
}

function use(row: Row, other: Row, change: () => void): string {
  let a = 0, b = 0, c = 0, d = 0, e = 0;
  for (let i = 0; i < 1500; i++) {
    if (i === 700) change();
    for (const cell of row) a = (a + cell) % 100003;
    for (const cell of other) e = (e + cell) % 100003;
    b = (b + +row + +other) % 100003;
    c = (c + row[mark]() + other[mark]()) % 100003;
    d = (d + row[0]() + other[0]()) % 100003;
  }
  return [a, b, c, d, e].join(" ");
}

const define = new Function("target", "key", "value", "target[key] = value") as (target: object, key: PropertyKey, value: unknown) => void;
const row = new Row([1, 2, 3]), other = new Row([4, 5]);
console.log("before", use(row, other, () => {}));
console.log("iterator", use(row, other, () => { define(row, Symbol.iterator, function* () { yield 100; }); }));
console.log("toPrimitive", use(row, other, () => { define(row, Symbol.toPrimitive, () => 50); }));
console.log("a symbol of the program", use(row, other, () => { define(row, mark, () => 25); }));
console.log("an index", use(row, other, () => { define(row, 0, () => 12); }));
console.log("an index as text", use(other, row, () => { define(other, "0", () => 6); }));
console.log("after", use(row, other, () => {}));
console.log(Reflect.ownKeys(row).map(String).join(), Reflect.ownKeys(other).map(String).join());
