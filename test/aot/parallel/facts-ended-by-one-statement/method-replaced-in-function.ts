class Shape {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  area(): number {
    return this.size * this.size;
  }
}
function measure(list: Shape[], n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (i === 2) patch();
    for (const shape of list) total += shape.area();
  }
  return total;
}
let patched = false;
function patch() {
  if (!patched) {
    patched = true;
    (Shape.prototype as any)["area"] = () => 7;
  }
}
const shapes = [new Shape(1), new Shape(2), new Shape(3)];
console.log(measure(shapes, 1));
console.log(measure(shapes, 5));
