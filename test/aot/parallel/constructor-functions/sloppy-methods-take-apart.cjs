// In a sloppy function an object is its own this value: an object that such methods only take apart is never allocated.
// STATISTIC: CallsInlined >= 25
function Vector(x, y, z) {
  this.x = x;
  this.y = y;
  this.z = z;
}
Vector.prototype.dot = function (other) {
  return this.x * other.x + this.y * other.y + this.z * other.z;
};
Vector.prototype.minus = function (other) {
  if (!other) throw new Error("no vector to take from [" + this.x + "," + this.y + "," + this.z + "]");
  return new Vector(this.x - other.x, this.y - other.y, this.z - other.z);
};
Vector.prototype.times = function (scale) {
  return new Vector(this.x * scale, this.y * scale, this.z * scale);
};
Vector.prototype.cross = function (other) {
  return new Vector(this.y * other.z - this.z * other.y, this.z * other.x - this.x * other.z, this.x * other.y - this.y * other.x);
};
function Ball(center, radius) {
  this.center = center;
  this.radius = radius;
}
Ball.prototype.hit = function (from, along) {
  const apart = from.minus(this.center);
  const near = apart.dot(along);
  const rest = near * near - apart.dot(apart) + this.radius * this.radius;
  if (rest < 0) return 0;
  const at = from.minus(along.times(near + Math.sqrt(rest)));
  const normal = at.minus(this.center).times(0.5);
  return normal.cross(along).dot(normal.cross(apart)) + at.dot(normal);
};
const balls = [new Ball(new Vector(1.5, 0.5, 2.5), 1.25), new Ball(new Vector(0.5, 1.5, 0.5), 0.75)];
function run(count) {
  let total = 0;
  for (let index = 0; index < count; index++) {
    const from = new Vector(index * 0.125, 0.5, 0.25);
    const along = new Vector(0.5, index * 0.0625, 0.75);
    for (let place = 0; place < balls.length; place++) total += balls[place].hit(from, along);
  }
  return total;
}
console.log(run(20).toFixed(6));
const N = +(process.env.N || 0);
if (N) console.log(run(N));
