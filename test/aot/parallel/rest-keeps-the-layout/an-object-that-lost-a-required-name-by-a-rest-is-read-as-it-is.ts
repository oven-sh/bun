// The rest of a pattern whose type lists no name keeps the layout of what it copies. So an object of that layout comes to be that lacks a name which the type requires,
// and every read, test, store, listing and copy of such an object answers as it does of any object without the name.
interface Point {
  a: number;
  b: number;
  c: string;
}
function without<T extends { a?: unknown }>({ a, ...rest }: T) {
  return rest;
}
function withoutTwo<T extends { a?: unknown; c?: unknown }>({ a, c, ...rest }: T) {
  return rest;
}
function make(turn: number): Point {
  return { a: turn, b: turn + 1, c: "c" + turn };
}
function readA(point: Point) {
  return point.a;
}
function readAll(point: Point) {
  return point.a + "|" + point.b + "|" + point.c;
}
function hasA(point: Point) {
  return "a" in point;
}
function ownA(point: Point) {
  return Object.hasOwn(point, "a");
}
function sumOf(points: Point[]) {
  let sum = 0;
  for (const point of points) sum += point.a === undefined ? 1000 : point.a;
  return sum;
}
function storeA(point: Point, value: number) {
  point.a = value;
  return point;
}
function keysOf(point: Point) {
  return Object.keys(point).join(",");
}
function spread(point: Point) {
  return { ...point };
}
function spreadAndMore(point: Point) {
  return { ...point, d: 1 };
}
function written(point: Point) {
  return JSON.stringify(point);
}
function listed(point: Point) {
  const names: string[] = [];
  for (const name in point) names.push(name);
  return names.join(",");
}
const out: string[] = [];
for (let turn = 0; turn < 4; turn++) {
  const whole = make(turn);
  const stripped = without(whole) as unknown as Point;
  const bare = withoutTwo(whole) as unknown as Point;
  out.push([readA(whole), readA(stripped), readA(bare)].join(" "));
  out.push([readAll(whole), readAll(stripped), readAll(bare)].join(" "));
  out.push([hasA(whole), hasA(stripped), ownA(whole), ownA(stripped), ownA(bare)].join(" "));
  out.push([keysOf(whole), keysOf(stripped), keysOf(bare)].join(" "));
  out.push([listed(whole), listed(stripped), listed(bare)].join(" "));
  out.push([written(whole), written(stripped), written(bare)].join(" "));
  out.push([written(spread(stripped)), written(spreadAndMore(stripped)), written(spread(bare)), keysOf(spread(stripped) as Point)].join(" "));
  out.push(String(sumOf([whole, stripped, bare, whole])));
  // The name comes back behind the others.
  out.push([written(storeA(stripped, 7)), keysOf(stripped), readA(stripped), written(whole)].join(" "));
  out.push([written(without(stripped)), written(without(without(whole))), written(withoutTwo(without(whole)))].join(" "));
  out.push(String(Object.getPrototypeOf(bare) === Object.prototype) + " " + Object.isExtensible(bare) + " " + (bare !== (whole as unknown)));
}
let sum = 0;
for (let turn = 0; turn < 30000; turn++) {
  const point = turn % 3 ? make(turn) : (without(make(turn)) as unknown as Point);
  const found = readA(point);
  sum += (found === undefined ? 1 : found & 3) + point.b;
}
out.push(String(sum));
console.log(out.join("\n"));
