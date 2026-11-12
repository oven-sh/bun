// A field that is written as a number takes a fraction, then an object that converts to a number.
class Shape {
  size: number;
  constructor(size: number) {
    this.size = size;
  }
  area(): number {
    return this.size * this.size;
  }
  get label(): string {
    return "shape " + this.size;
  }
}
const shapes: Shape[] = [new Shape(1), new Shape(2), new Shape(3)];
function measure(list: Shape[]): number {
  let total = 0;
  for (const shape of list) total += shape.area();
  return total;
}
for (let round = 0; round < 5; round++) {
  if (round === 2) shapes[0].size = 1.5;
  if (round === 3) (shapes[0] as any).size = { valueOf: () => 6, toString: () => "six" };
  console.log(measure(shapes), shapes[0].label, shapes[1].label);
}
