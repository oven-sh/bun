// makes an object with Object.assign(Object.create(prototype), { .. }) and reads two of its three properties
interface Point {
  readonly kind: string;
  x: number;
  y: number;
  label: string;
}
const PointProto = { kind: "point" };
function make(x: number, y: number, label: string): Point {
  return Object.assign(Object.create(PointProto), { x, y, label });
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
