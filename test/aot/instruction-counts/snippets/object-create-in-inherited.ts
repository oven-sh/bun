// asks with `in` for a name that the prototype holds, of an object made with Object.create(prototype)
const TypeId = "~snippet/Point";
interface Point {
  readonly [TypeId]: typeof TypeId;
  x: number;
}
const PointProto = { [TypeId]: TypeId };
function make(x: number): Point {
  const self = Object.create(PointProto);
  self.x = x;
  return self;
}
const isPoint = (u: unknown): u is Point => typeof u === "object" && u !== null && TypeId in u;
const values: unknown[] = [];
for (let i = 0; i < 8; i++) values.push(make(i));
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) if (isPoint(values[i & 7])) total++;
}

console.log(total);
