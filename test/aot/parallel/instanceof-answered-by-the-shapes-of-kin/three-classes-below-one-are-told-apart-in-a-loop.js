// A miss is an object of a sister class: its shape says no.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 3
// STATISTIC: InstanceOfTestsDecidedByHierarchy >= 2
const rows = JSON.parse("[" + Array.from({ length: 48 }, (_, i) => '{"x":' + i + ',"y":' + (i * 7 % 5) + "}").join() + "]");
class Shape {}
class Circle extends Shape { constructor(r) { super(); this.r = r; } }
class Rectangle extends Shape { constructor(w, h) { super(); this.w = w; this.h = h; } }
class Triangle extends Shape { constructor(b) { super(); this.b = b; } }
const shapes = rows.map((row, i) => i % 3 === 0 ? new Circle(row.x) : i % 3 === 1 ? new Rectangle(row.x, row.y) : new Triangle(row.y));
function total(turn) {
  let sum = turn & 1;
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i];
    if (shape instanceof Circle) sum += shape.r * 3;
    else if (shape instanceof Rectangle) sum += shape.w * shape.h;
    else if (shape instanceof Triangle) sum += shape.b;
    else sum -= 1000;
  }
  return sum;
}
let all = 0;
for (let turn = 0; turn < 40; turn++) all = (all + total(turn)) % 1000003;
console.log(all);
