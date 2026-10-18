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

const ada: Row = { name: "Ada", n: 1 };
const bo: Row = { name: "Bo", n: 2 };
const wide: Wide = { name: "Wi", n: 3, extra: true };
const record: Record<string, Row> = { ada, bo };

function label(row: Row): string {
  return row.name + ":" + row.n;
}
function total(list: Row[]): number {
  let sum = 0;
  for (const row of list) sum += row.n;
  return sum;
}

console.log(Object.values(record).map(row => row.name).join(), Object.values(record).map(label).join(), total(Object.values(record)));
console.log(Object.values(record)[0] === ada, Object.values(record)[1] === bo, Object.values(record).length, Array.isArray(Object.values(record)));
for (const row of Object.values(record)) console.log(row.name, row.n, label(row));
for (const [key, row] of Object.entries(record)) console.log(key, row.name, label(row));
console.log(Object.entries(record).map(([key, row]) => key + "=" + row.n).join());
console.log(Object.entries(record).filter(([, row]) => row.n > 1).map(([key]) => key).join());
console.log(Object.entries(record).sort(([, a], [, b]) => b.n - a.n)[0]![0]);
Object.entries(record).forEach(([key, row], index) => console.log(index, key, row.name));
console.log(Object.entries(record)[0]![1] === ada, typeof Object.entries(record)[0]![0]);

const listed: Row[] = Object.values(record);
listed.push({ name: "Cy", n: 4 });
console.log(listed.length, Object.values(record).length, total(listed));
const pairs: [string, Row][] = Object.entries(record);
console.log(pairs.length, pairs[1]![1].name);
console.log(new Map(Object.entries(record)).get("bo")!.n, new Set(Object.values(record)).has(ada));

record.wide = wide;
record["10"] = { name: "Ten", n: 10 };
record["2"] = { name: "Two", n: 2 };
console.log(Object.keys(record).join(), Object.values(record).map(row => row.name).join());
console.log(Object.values(record).find(row => row === wide) === wide, label(Object.values(record)[4]!));
delete record.ada;
console.log(Object.values(record).map(row => row.name).join(), total(Object.values(record)));

Object.defineProperty(record, "hidden", { value: { name: "Hi", n: 100 }, enumerable: false });
Object.defineProperty(record, "computed", { get: () => bo, enumerable: true });
console.log(Object.values(record).map(row => row.name).join(), Object.entries(record).length);

const inherits: Record<string, Row> = Object.create(record);
inherits.own = ada;
console.log(Object.values(inherits).map(row => row.name).join(), inherits.bo!.name);

const empty: Record<string, Row> = {};
console.log(Object.values(empty).length, Object.entries(empty).length, total(Object.values(empty)));

const points: Record<string, Point> = { a: new Point(1, 2), b: new Point(3, 4) };
console.log(Object.values(points).map(point => point.sum()).join(), Object.entries(points).map(([key, point]) => key + point.x).join());

const maybe: Record<string, Row | undefined> = { ada, none: undefined };
console.log(Object.values(maybe).map(row => row?.name ?? "nobody").join());

const lists: Record<string, Row[]> = { all: [ada, bo], none: [] };
console.log(Object.values(lists).map(total).join(), Object.entries(lists).map(([key, list]) => key + list.length).join());

const nested: Record<string, Record<string, Row>> = { first: { ada }, second: { bo, wide } };
console.log(Object.values(nested).flatMap(inner => Object.values(inner)).map(label).join());

interface Index {
  [key: string]: Row;
}
const index: Index = { ada };
console.log(Object.values(index)[0]!.name, Object.entries(index)[0]![1].n);

for (const row of Object.values(record)) row.n += 1;
console.log(bo.n, wide.n);
