// Three classes without `extends` meet in one list. For 150 turns the shapes answer; then the turn that asks has a function that the build does not see lay one class's prototype below another's.
// STATISTIC: InstanceOfMissesDecidedByHierarchy >= 2
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ type: ["Circle", "Rectangle", "Triangle"][i % 3], r: (i % 5) + 1, w: (i % 4) + 1, h: (i % 6) + 2 }))));
class Circle { constructor(row) { this.r = row.r; } }
class Rectangle { constructor(row) { this.w = row.w; this.h = row.h; } }
class Triangle { constructor(row) { this.w = row.w; this.h = row.h; } }
const types = new Map([["Circle", Circle], ["Rectangle", Rectangle], ["Triangle", Triangle]]);
const all = rows.map(row => new (types.get(row.type))(row));
const deeds = { quiet() {}, lay(below, above) { Object.setPrototypeOf(below, above); } };
const deed = deeds[JSON.parse('["lay"]')[0]];
let armed = false;
function measure(shape) {
  if (armed && shape === all[4]) { armed = false; deed(Rectangle.prototype, Circle.prototype); }
  return shape instanceof Circle ? (shape.r, 1) : shape instanceof Rectangle ? (shape.w, 100) : shape instanceof Triangle ? (shape.h, 10000) : 0;
}
function total(turn) {
  let sum = turn & 1;
  for (const shape of all) sum += measure(shape);
  return sum;
}
const said = [];
for (let turn = 0; turn < 300; turn++) {
  if (turn === 150) { armed = true; }
  const answer = total(turn) - (turn & 1);
  if (said[said.length - 1] !== answer) said.push(turn, answer);
}
for (const word of said) console.log(word);
console.log("count " + said.length);
