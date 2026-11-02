// Every number in fields that the program shows small integers.
type Row = { v: number; w?: number | null };
type Pair = { a: number; b: number; c?: number | null };
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
const say = (value: unknown) => (Object.is(value, -0) ? "-0" : String(value));
const texts = [
  "0",
  "1",
  "-1",
  "7",
  "-0",
  "0.5",
  "-0.5",
  "1073741822",
  "1073741823",
  "1073741824",
  "1073741825",
  "-1073741823",
  "-1073741824",
  "-1073741825",
  "2147483647",
  "2147483648",
  "-2147483643",
  "-2147483644",
  "-2147483647",
  "-2147483648",
  "-2147483649",
  "4294967295",
  "4294967296",
  "4294967303",
  "9007199254740991",
  "9007199254740992",
  "-9007199254740991",
  "1e21",
  "1e300",
  "5e-324",
  "1.7976931348623157e308",
  "1e400",
  "-1e400",
];
const rows: Row[] = JSON.parse("[" + texts.map(text => `{"v":${text}}`).join() + "]");
if (rows.length !== texts.length) rows.push({ v: 1, w: 2 });
rows.push({ v: Number("not a number") }, { v: rows[0]!.v / rows[0]!.v });

const pairs: Pair[] = [];
const points: Point[] = [];
for (let index = 0; index < 4; index++) {
  pairs.push({ a: index, b: index });
  points.push(new Point(index, index));
}
for (const row of rows) {
  pairs.push({ a: row.v, b: row.v });
  points.push(new Point(row.v, row.v));
}
console.log(pairs.map(pair => say(pair.a) + " " + say(pair.b)).join("|"));
console.log(points.map(point => say(point.x) + " " + say(point.y)).join("|"));
console.log(JSON.stringify(pairs), JSON.stringify(points));

let sum = 0;
for (const pair of pairs) if (Number.isFinite(pair.a)) sum += pair.a - pair.b + 1;
for (const point of points) if (Number.isFinite(point.x)) sum += point.x - point.y + 1;
console.log(sum);

const spread = pairs.map(pair => ({ ...pair }));
const assigned = pairs.map(pair => Object.assign({ a: 0, b: 0 } as Pair, pair));
const rest = pairs.map(({ a, ...others }) => others);
const cloned = structuredClone(pairs);
console.log(
  spread.map(pair => say(pair.b)).join(),
  assigned.map(pair => say(pair.a)).join(),
  rest.map(pair => say(pair.b)).join(),
  cloned.map(pair => say(pair.a)).join(),
);
console.log(
  points
    .map(point =>
      Object.entries(point)
        .map(([key, value]) => key + say(value))
        .join(""),
    )
    .join(),
);

const one: Pair = { a: 1, b: 2 };
const key = ["a", "b"][rows.length & 1]! as "a" | "b";
const seen: string[] = [];
for (const row of rows) {
  one.a = row.v;
  one[key] = row.v;
  Object.defineProperty(one, "b", { value: row.v, writable: true, enumerable: true, configurable: true });
  one.c = row.v;
  seen.push(say(one.a) + say(one.b) + say(one.c));
  one.c = seen.length & 1 ? null : undefined;
  seen.push(say(one.c));
}
console.log(seen.join());
delete (one as Partial<Pair>).a;
console.log("a" in one, Object.keys(one).join(), say(one.a));
one.a = rows[5]!.v;
console.log(Object.keys(one).join(), say(one.a), JSON.stringify(Object.getOwnPropertyDescriptor(one, "a")));
Object.freeze(one);
try {
  one.a = rows[6]!.v;
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(say(one.a));

const edge: Pair = { a: rows[8]!.v - 2, b: rows[12]!.v + 2 };
const walked: string[] = [];
for (let step = 0; step < 5; step++) {
  edge.a++;
  edge.b--;
  walked.push(say(edge.a) + " " + say(edge.b));
}
for (let step = 0; step < 5; step++) {
  edge.a--;
  edge.b++;
  walked.push(say(edge.a) + " " + say(edge.b));
}
console.log(walked.join());

const kept: Pair[] = [];
for (let round = 0; round < 40; round++) {
  for (let index = 0; index < 5000; index++) {
    const row = rows[(index + round) % rows.length]!;
    const pair: Pair = { a: row.v, b: row.v + 0.25 };
    if (index % 997 === 0) kept.push(pair);
    else if (kept.length) kept[index % kept.length]!.b = row.v;
  }
  if (round % 8 === 0) Bun.gc(true);
}
Bun.gc(true);
let digest = 0;
for (const pair of kept)
  for (const value of [pair.a, pair.b])
    digest =
      (digest * 31 + (Number.isFinite(value) ? value % 1000003 : Number.isNaN(value) ? 5 : value > 0 ? 7 : 11)) %
      1000003;
console.log(kept.length, digest);
