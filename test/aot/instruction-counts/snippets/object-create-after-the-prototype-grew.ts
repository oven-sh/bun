// makes an object with Object.create(prototype) and stores three properties, after the prototype was given one more method
interface Point {
  readonly kind: string;
  x: number;
  y: number;
  label: string;
}
const PointProto = { kind: "point" };
function make(options: { readonly x: number; readonly y: number; readonly label?: string | undefined }): Point {
  const self = Object.create(PointProto);
  self.x = options.x;
  self.y = options.y;
  self.label = options.label ?? "none";
  return self;
}
const operations = 160;
let total = make({ x: 0, y: 0 }).x;
(PointProto as any).later = () => 1;

kernel: {
  for (let i = 0; i < operations; i++) {
    const made = make({ x: i, y: 1 });
    total += made.x + made.y;
  }
}

console.log(total);
