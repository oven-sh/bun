// Three classes that are written without `extends` meet in one list, and the links of their prototypes and of one object change between the turns.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 2
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ type: ["Circle", "Rectangle", "Triangle"][i % 3], r: (i % 5) + 1, w: (i % 4) + 1, h: (i % 6) + 2 }))));
class Circle { constructor(row) { this.r = row.r; } }
class Rectangle { constructor(row) { this.w = row.w; this.h = row.h; } }
class Triangle { constructor(row) { this.w = row.w; this.h = row.h; } }
const types = new Map([["Circle", Circle], ["Rectangle", Rectangle], ["Triangle", Triangle]]);
const all = rows.map(row => new (types.get(row.type))(row));
function measure(shape) {
  return shape instanceof Circle ? shape.r : shape instanceof Rectangle ? shape.w : shape instanceof Triangle ? shape.h : 0;
}
function total(turn) {
  let sum = turn & 1;
  for (const shape of all) sum += measure(shape);
  return sum;
}
const said = [];
for (let turn = 0; turn < 44; turn++) {
  if (turn === 20) Object.setPrototypeOf(Rectangle.prototype, Circle.prototype);
  if (turn === 21) for (const shape of all) if (shape instanceof Rectangle) shape.r = 100;
  if (turn === 32) Object.setPrototypeOf(Rectangle.prototype, Object.prototype);
  if (turn === 38) Object.setPrototypeOf(all[2], Circle.prototype);
  said.push(total(turn));
}
console.log(said.join());
