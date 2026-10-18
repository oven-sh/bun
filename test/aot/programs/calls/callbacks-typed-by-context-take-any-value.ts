interface Row {
  name: string;
  n: number;
}
interface Wide extends Row {
  extra: boolean;
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

const rows: Row[] = [
  { name: "Ada", n: 1 },
  { name: "Bo", n: 2 },
];
const kept: Row[] = [];
let last: Row | undefined;

function label(row: Row): string {
  return row.name + ":" + row.n;
}
function attempt(title: string, run: () => unknown): void {
  try {
    console.log(title, run());
  } catch (error) {
    console.log(title, "threw", error instanceof TypeError ? "TypeError" : String(error));
  }
}
function promised<T>(value: unknown): Promise<T> {
  return Promise.resolve(value) as Promise<T>;
}

await Promise.resolve(rows[0]!).then(row => console.log("own", row.name, row.n, label(row)));
await Promise.resolve(rows[1]!).then(row => {
  kept.push(row);
  last = row;
});
console.log(kept.length, kept[0] === rows[1], last === rows[1], label(kept[0]!));

const wide: Wide = { name: "Wi", n: 3, extra: true };
await Promise.resolve<Row>(wide).then(row => console.log("wide", row.name, row.n, label(row), row === wide));

const parsed = JSON.parse('{"name":"Pa","n":4}');
await promised<Row>(parsed).then(row => console.log("parsed", row.name, row.n, row === parsed));
await promised<Row>(parsed).then(row => console.log("parsed into a function", label(row)));

const more = JSON.parse('{"extra":1,"n":5,"name":"Mo","other":[1]}');
await promised<Row>(more).then(row => console.log("more", row.name, row.n, Object.keys(row).join(), row === more));

const lying = JSON.parse('{"name":6,"n":"six"}');
await promised<Row>(lying).then(row => console.log("lying", row.name, row.n, typeof row.name, typeof row.n));

const lacking = JSON.parse('{"name":"La"}');
await promised<Row>(lacking).then(row => console.log("lacking", row.name, row.n, "n" in row));

await promised<Row>(undefined).then(row => console.log("undefined", row === undefined, row?.name));
await promised<Row>(null).then(row => console.log("null", row === null, row?.name));
await promised<Row>(7).then(row => console.log("number", typeof row, row.name));
await promised<Row>("text").then(row => console.log("string", typeof row, row.name, (row as unknown as string).length));
await promised<Row>([1, 2]).then(row => console.log("array", Array.isArray(row), row.name));
await promised<Row>(() => 1).then(row => console.log("function", typeof row, row.name));
await promised<Row>(new Point(1, 2)).then(row => console.log("instance", row.name, row.n, row instanceof Point));
await promised<Row>(Object.freeze({ name: "Fr", n: 8 })).then(row => console.log("frozen", row.name, row.n, Object.isFrozen(row)));
await promised<Row>({
  get name() {
    return "Ge";
  },
  n: 9,
}).then(row => console.log("getter", row.name, row.n));
await promised<Row>(new Proxy({ name: "Pr", n: 10 }, {})).then(row => console.log("proxy", row.name, row.n));

await promised<Point>(new Point(3, 4)).then(point => console.log("point", point.x, point.y, point.sum()));
await promised<Point>({ x: 5, y: 6, sum: () => -1 }).then(point => console.log("like a point", point.x, point.y, point.sum(), point instanceof Point));
await promised<Point>(Object.create(Point.prototype)).then(point => console.log("made of the prototype", point.x, point.y, point instanceof Point));

await promised<Row[]>(rows).then(list => console.log("list", list.length, list[0]!.name, label(list[1]!)));
await promised<Row[]>(JSON.parse('[{"name":"Li","n":11}]')).then(list => console.log("parsed list", list.length, list[0]!.name));
await promised<Row[]>("ab").then(list => console.log("a string for a list", list.length, list[0]));

await promised<Row>(parsed).then(row => {
  row.n += 1;
  row.name += "!";
});
console.log(parsed.name, parsed.n);

await promised<Row>(parsed).then(row => attempt("a parsed row is pushed", () => (kept.push(row), kept.length)));
attempt("and read again", () => kept[kept.length - 1]!.name + " " + (kept[kept.length - 1] === parsed));
await promised<Row>(parsed).then(row => attempt("a parsed row is kept", () => ((last = row), last.name)));
attempt("and is the same", () => last === parsed);

const seen: string[] = [];
await Promise.all([promised<Row>(rows[0]), promised<Row>(parsed), promised<Row>(wide)].map(promise => promise.then(row => seen.push(row.name))));
console.log(seen.join());

function twice(row: Row, then: (row: Row) => string): string {
  return then(row) + then(row);
}
console.log(twice(rows[0]!, row => row.name));
console.log(await Promise.resolve(rows[0]!).then(row => twice(row, inner => inner.name + row.n)));
console.log(await promised<Row>(parsed).then(row => [row].map(inner => inner.name + row.n).join()));
