// reads a getter that the prototype holds from an object made with Object.create(prototype)
interface Point {
  readonly double: number;
  x: number;
}
const PointProto = {
  get double(): number {
    return (this as unknown as Point).x * 2;
  },
};
function make(x: number): Point {
  const self = Object.create(PointProto);
  self.x = x;
  return self;
}
const points: Point[] = [];
for (let i = 0; i < 8; i++) points.push(make(i));
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += points[i & 7]!.double;
}

console.log(total);
