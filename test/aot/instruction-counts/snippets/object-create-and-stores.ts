// makes an object with Object.create(prototype) and three stores, and reads two of them
interface Point {
  readonly kind: string;
  x: number;
  y: number;
  label: string;
}
const PointProto = { kind: "point" };
function make(x: number, y: number, label: string): Point {
  const self = Object.create(PointProto);
  self.x = x;
  self.y = y;
  self.label = label;
  return self;
}
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const made = make(i, 1, "p");
    total += made.x + made.y;
  }
}

console.log(total);
