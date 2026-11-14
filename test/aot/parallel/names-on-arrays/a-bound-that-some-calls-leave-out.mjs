// STATISTIC: CounterStartsNarrowed = 0
// Some calls leave out the argument: undefined is carried beside the numbers that come round.
function Plane(x, y, offset) {
  this.normal = [x, y];
  this.offset = offset;
}
Plane.prototype.intersect = function (origin, direction, near, far) {
  const divisor = this.normal[0] * direction[0] + this.normal[1] * direction[1];
  const distance = (this.offset - this.normal[0] * origin[0] - this.normal[1] * origin[1]) / divisor;
  if (distance < near || distance > far) return null;
  return distance;
};
function Scene(planes) {
  this.planes = planes;
}
Scene.prototype.nearest = function (origin, direction, near, far) {
  let closest = null;
  for (let i = 0; i < this.planes.length; i++) {
    const plane = this.planes[i];
    const distance = plane.intersect(origin, direction, near, far);
    if (distance == null || distance > far || distance < near) continue;
    far = distance;
    closest = plane;
  }
  return closest ? closest.offset + far : far;
};
const scene = new Scene([new Plane(0.5, 1.5, 4), new Plane(1, 0.25, 9.5), new Plane(0.125, 2, 3), new Plane(-1, 0.5, 2.5)]);
let total = 0;
for (let turn = 0; turn < 60; turn++) {
  const origin = [turn * 0.25, 1.5];
  const direction = [0.5, 1 + (turn % 4) * 0.5];
  total += scene.nearest(origin, direction);
  if (turn % 5 === 0) total += scene.nearest(origin, direction, 0.5, 3.5);
  if (turn % 7 === 0) total += scene.nearest(origin, direction, undefined, undefined) || 0;
}
console.log(total, new Scene([]).nearest([0, 0], [1, 1]), new Scene([]).nearest([0, 0], [1, 1], 0, 7), scene.nearest([NaN, 0], [1, 1]));
