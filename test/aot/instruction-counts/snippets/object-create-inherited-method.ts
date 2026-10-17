// calls a method that the prototype holds on an object made with Object.create(prototype)
interface Point {
  x: number;
  plus(more: number): number;
}
const PointProto = {
  plus(this: Point, more: number): number {
    return this.x + more;
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
  for (let i = 0; i < operations; i++) total += points[i & 7]!.plus(i);
}

console.log(total);
