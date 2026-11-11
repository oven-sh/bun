class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
class Size {
  constructor(width) {
    this.width = width;
  }
}
class Name {
  constructor(text) {
    this.text = text;
  }
}
function describe(value) {
  let out = "" + value.x;
  if (typeof value !== "boolean") out += "," + value.x + "," + value.y;
  return out;
}
const point = new Point(3, 4);
console.log(describe(new Point(1, 2)));
console.log(describe(new Size(5)));
console.log(describe(new Name("n")));
console.log(describe(true));
console.log(describe(point), point.x);
