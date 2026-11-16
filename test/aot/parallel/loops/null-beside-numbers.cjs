// STATISTIC: MixedReturnsWalkedApart >= 1
// An inlined method returns null or a number: its caller asks which, and the ways part where they return.
function Wall(at, slope) {
  this.at = at;
  this.slope = slope;
}
Wall.prototype.hit = function (from, step, near, far) {
  const t = (this.at - from) / step;
  if (t < near || t > far) return null;
  if (t * this.slope < 0) return null;
  return t;
};
function nearest(walls, from, step, near, far) {
  let closest = null;
  for (let k = 0; k < walls.length; k++) {
    const wall = walls[k];
    const t = wall.hit(from, step, near, far);
    if (t == null || t > far || t < near) continue;
    far = t;
    closest = wall;
  }
  return closest === null ? 'none' : `${walls.indexOf(closest)} ${Object.is(far, -0) ? '-0' : far}`;
}
function count(walls, from, step) {
  let hits = 0, misses = 0;
  for (const wall of walls) {
    if (wall.hit(from, step, 0, 100) !== null) hits++;
    else misses++;
  }
  return `${hits}/${misses}`;
}
const walls = [];
for (let k = 0; k < 30; k++) walls.push(new Wall(k * 1.5 - 20, k % 3 ? 1 : -1));
walls.push(new Wall(NaN, 1), new Wall(Infinity, 0), new Wall(-0, 1));
const out = [];
for (let turn = 0; turn < 60; turn++) out.push(nearest(walls, turn - 30, turn % 2 ? 0.5 : -0.5, 0, 50), count(walls, turn - 30, turn % 2 ? 0.5 : -0.5));
out.push(nearest(walls, 0, 1), nearest(walls, 0, 0, 0, 1), nearest([], 0, 1, 0, 1), nearest(walls, NaN, 1, 0, 1), nearest([new Wall(-0, 1)], 0, 1, -1, 1));
try { nearest([walls[0], null], 0, 1, 0, 1); } catch (e) { out.push(e.constructor.name); }
console.log(out.join());
