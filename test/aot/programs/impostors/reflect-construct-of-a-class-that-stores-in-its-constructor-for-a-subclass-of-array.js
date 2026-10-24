class Point {
  constructor() {
    this.x = 1;
    this.y = 2;
  }
}
function OldPoint() {
  this.x = 1;
  this.y = 2;
}
class List extends Array {}

const p = Reflect.construct(Point, [], List);
console.log("a class: keys", Object.keys(p).join(), "x", p.x, "y", p.y, "sum", p.x + p.y);
const q = Reflect.construct(OldPoint, [], List);
console.log("a constructor function: keys", Object.keys(q).join(), "x", q.x, "y", q.y, "sum", q.x + q.y);
