// A field that every constructor fills is deleted from one object before the loops run.
class Shape {
  size;
  constructor(size) {
    this.size = size;
  }
  area() {
    return this.size * this.size;
  }
  get label() {
    return "shape " + this.size;
  }
}
const shapes = [new Shape(1), new Shape(2), new Shape(3)];
function measure(list) {
  let total = 0;
  for (const shape of list) total += shape.size * shape.area();
  return total;
}
delete shapes[2].size;
for (let round = 0; round < 4; round++) {
  console.log(measure(shapes), shapes[2].label, Object.keys(shapes[2]).length, "size" in shapes[2]);
  if (round === 1) shapes[2].size = 4;
}
