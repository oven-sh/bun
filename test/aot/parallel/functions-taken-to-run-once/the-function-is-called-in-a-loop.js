function make(k) {
  function Point(x) { this.x = x; }
  Point.prototype.scaled = function () { return this.x * 10; };
  Point.prototype.kind = "point";
  return Point;
}
const made = [];
for (let i = 0; i < 3; i++) made.push(make(i));
made[1].prototype.kind = "other";
console.log(made[0] === made[1], made.map(P => new P(2).kind).join(), new made[2](4).scaled(), new made[0](1) instanceof made[2]);
