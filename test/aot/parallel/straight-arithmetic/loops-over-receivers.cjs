// STATISTIC: FullUnrollingsRejectedForSize >= 2
// A short loop that calls a method of each element of a list stays a loop: it copies the method with what that calls. Written out, the inner method would stay a call.
class Vector {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
}
class Plane {
  constructor(normal, constant) { this.normal = normal; this.constant = constant; }
  distanceTo(point) { return this.normal.dot(point) + this.constant; }
}
class Frustum {
  constructor(planes) { this.planes = planes; }
  intersects(sphere) {
    const planes = this.planes, center = sphere.center, least = -sphere.radius;
    for (let i = 0; i < 6; i++) {
      const distance = planes[i].distanceTo(center);
      if (distance < least) return false;
    }
    return true;
  }
  nearest(point) {
    let least = Infinity, place = -1;
    for (let i = 0; i < 4; i++) {
      const distance = this.planes[i].distanceTo(point);
      if (distance < least) { least = distance; place = i; }
    }
    return place + ":" + least;
  }
}
globalThis.KEPT = [Vector, Plane, Frustum];
globalThis.see = (frustum, sphere) => frustum.intersects(sphere);
globalThis.find = (frustum, point) => frustum.nearest(point);
const of = f => Array.from({ length: 6 }, (_, i) => f(i));
const frustums = [
  new Frustum(of(i => new Plane(new Vector(i - 2.5, 1 - i * 0.5, 0.25 * i), 3 + i))),
  new Frustum(of(i => new Plane(new Vector(i, -i, 1), 40 - i * 8))),
  new Frustum(of(i => i === 3 ? { distanceTo: p => p.x - 2 } : new Plane(new Vector(1, i, 0.5), 2))),
  new Frustum(of(i => new Plane(i === 2 ? { dot: () => "text" } : new Vector("2", i, 0.5), i === 4 ? 5n : 1))),
  new Frustum(of(i => new Plane(new Vector(1n, 2n, 3n), 4n))),
  new Frustum(of(i => i === 5 ? undefined : new Plane(new Vector(1, 1, 1), 9))),
  new Frustum([new Plane(new Vector(1, 1, 1), 0)]),
];
const spheres = [];
for (let i = 0; i < 40; i++) spheres.push({ center: new Vector(i * 0.5 - 8, 4 - i * 0.25, i % 7), radius: i % 5 });
spheres.push({ center: new Vector(1n, 2n, 3n), radius: 2n }, { center: new Vector({ valueOf() { return 3; } }, "4", null), radius: "1" }, { center: null, radius: 1 }, { center: new Vector(NaN, 1, 2), radius: undefined });
const lines = [];
function run(frustum) {
  let line = "";
  for (const sphere of spheres) {
    try { line += globalThis.see(frustum, sphere) ? 1 : 0; } catch (e) { line += e.name; }
    try { line += " " + globalThis.find(frustum, sphere.center) + ";"; } catch (e) { line += " " + e.name + ";"; }
  }
  return line;
}
for (let turn = 0; turn < 3; turn++) {
  for (const frustum of frustums) lines.push(run(frustum));
  if (turn === 0) Vector.prototype.dot = function (v) { return this.x + v.y; };
  if (turn === 1) frustums[0].planes[1].distanceTo = () => -100;
}
console.log(lines.join("\n"));
