// function Base() {} fills nothing and gives its object to nobody: new Base() is a prototype that the build follows.
// STATISTIC: OperationsSwept <= 1000
function Base() {}
Base.prototype.twice = function () {
  return this.dot(this) * 2;
};
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype = new Base();
Point.prototype.dot = function (other) {
  return this.x * other.x + this.y * other.y;
};
const kept = [];
function make(index) {
  return new Point(index, 2.5);
}
function run(count) {
  let total = 0;
  const first = new Point(0.5, 1.5);
  for (let index = 0; index < count; index++) {
    const made = make(index);
    kept[index & 1] = made;
    total += made.dot(first) + made.twice();
  }
  return total;
}
console.log(run(20));
const N = +(process.env.N || 0);
if (N) console.log(run(N));
