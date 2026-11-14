// STATISTIC: OptionalOperandsHoisted >= 1
// t < near, near a number or undefined that the loop does not change: it is compared as it is.
function Wall(at) {
  this.at = at;
}
Wall.prototype.hit = function (from, step, near, far) {
  const t = (this.at - from) / step;
  if (t < near || t > far) return null;
  return t;
};
function nearest(walls, from, step, near, far) {
  let closest = null;
  for (let k = 0; k < walls.length; k++) {
    const t = walls[k].hit(from, step, near, far);
    if (t == null || t > far || t < near) continue;
    far = t;
    closest = walls[k];
  }
  return closest === null ? 'none' : `${closest.at} ${far}`;
}
function countAbove(values, limit) {
  let above = 0, below = 0;
  for (let k = 0; k < values.length; k++) {
    if (values[k] * 0.5 > limit) above++;
    if (limit >= values[k] * 0.5) below++;
  }
  return `${above}/${below}`;
}
// The same beside null, strings, objects and big integers.
function countAboveAnything(values, limit) {
  let above = 0, below = 0;
  for (let k = 0; k < values.length; k++) {
    if (values[k] * 0.5 > limit) above++;
    if (limit >= values[k] * 0.5) below++;
  }
  return `${above}/${below}`;
}
const walls = [], values = [], out = [];
for (let k = 0; k < 40; k++) walls.push(new Wall((k * 7) % 31 - 10.5));
for (let k = 0; k < 40; k++) values.push(k % 5 ? k - 20.5 : k);
for (let turn = 0; turn < 40; turn++) {
  out.push(nearest(walls, turn - 20, 1), nearest(walls, turn - 20, 0.5, 0.0001, 1000), nearest(walls, turn, -1, undefined, 40));
  out.push(countAbove(values, turn % 2 ? turn / 4 : undefined), countAbove(values, turn), countAbove(values, NaN), countAbove(values, -0));
}
out.push(nearest(walls, NaN, 1), nearest(walls, 0, 0, 0, 1), nearest([], 0, 1, 0, 1), countAbove([], 1));
for (const limit of [1, undefined, null, '3', NaN, { valueOf: () => 1 }, 3n, 2.5]) out.push(countAboveAnything(values, limit), countAboveAnything([1, 'x', undefined, null, 4.5], limit));
console.log(out.join());
