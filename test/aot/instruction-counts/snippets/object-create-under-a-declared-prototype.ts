// makes an object with Object.create(prototype), where the prototype is a constant of a declared type, and reads what it provides
interface Point {
  readonly kind: string;
  x: number;
  y: number;
  label: string;
}
const PointProto: Omit<Point, "x" | "y" | "label"> = { kind: "point" };
function make(options: { readonly x: number; readonly y: number; readonly label?: string | undefined }): Point {
  const self = Object.create(PointProto);
  self.x = options.x;
  self.y = options.y;
  self.label = options.label ?? "none";
  return self;
}
const operations = 160;
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) {
    const made = make({ x: i, y: 1 });
    total += made.x + made.y + made.kind.length;
  }
}

console.log(total);
