// Each reader reads one property of one value, so the read shares its tests with nobody. A value from outside has reached every reader, so none of them knows what it is given.
interface Point { x: number; ratio: number; label: string; next: Point | undefined; flag: boolean; any: unknown }
function readInteger(p: Point) { return p.x; }
function readDouble(p: Point) { return p.ratio; }
function readString(p: Point) { return p.label; }
function readObject(p: Point) { return p.next; }
function readBoolean(p: Point) { return p.flag; }
function readUntyped(p: Point) { return p.any; }
function readNothing(p: Point) { return p; }
const readers: Record<string, (p: Point) => unknown> = { readInteger, readDouble, readString, readObject, readBoolean, readUntyped, readNothing };
const inner: Point = { x: 1, ratio: 0.5, label: "inner", next: undefined, flag: true, any: 1 };
const outer: Point = { x: 2, ratio: 1.5, label: "outer", next: inner, flag: false, any: "s" };
const fromOutside = JSON.parse('{"x":1,"ratio":2,"label":"l","flag":true,"any":3}');

const name = process.argv[2];
if (name) {
  const read = readers[name]!;
  const iterations = Number(process.argv[3]);
  let last: unknown = read(fromOutside);
  for (let i = 0; i < iterations; i++) last = read(i & 1 ? inner : outer);
  console.log(name, typeof last);
} else {
  for (const [name, read] of Object.entries(readers)) console.log(name, JSON.stringify([read(fromOutside), read(inner), read(outer)]));
}
