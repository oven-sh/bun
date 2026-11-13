// The control: the field takes numbers alone.
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
  if (round === 2) shapes[0].size = 15;
  console.log(measure(shapes), shapes[0].label, shapes[1].label);
}
