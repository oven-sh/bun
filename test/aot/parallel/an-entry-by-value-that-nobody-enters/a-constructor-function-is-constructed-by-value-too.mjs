// A constructor function is constructed directly, by Reflect.construct, out of a list, and called as a function.
function Point(x) {
  this.x = x;
}
Point.prototype.twice = function () {
  return this.x * 2;
};
let sum = 0;
for (let i = 0; i < 4; i++) sum += new Point(i).twice();
const made = Reflect.construct(Point, [5]);
const list = [Point];
const bare = {};
console.log(sum, made.x, new list[sum % 1](6).x, Point.call(bare, 1), bare.x, made.twice());
function Only(x) {
  this.x = x + 1;
}
let other = 0;
for (let i = 0; i < 4; i++) other += new Only(i).x;
console.log(other, new [Only][other % 1](1).x);
