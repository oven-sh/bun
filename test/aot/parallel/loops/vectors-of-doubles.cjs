// STATISTIC: LoopsUnswitched >= 1
// A loop reads several elements off the same lists of numbers: one version knows them to hold doubles.
function Plane(axis, nu, nv, nd) {
  this.axis = axis;
  this.nu = nu;
  this.nv = nv;
  this.nd = nd;
}
Plane.prototype.distance = function (origin, direction) {
  const u = (this.axis + 1) % 3, v = (this.axis + 2) % 3;
  const d = direction[this.axis] + this.nu * direction[u] + this.nv * direction[v];
  return (this.nd - origin[this.axis] - this.nu * origin[u] - this.nv * origin[v]) / d;
};
function nearest(planes, origin, direction, far) {
  let which = -1;
  for (let k = 0; k < planes.length; k++) {
    const t = planes[k].distance(origin, direction);
    if (t < 0 || t > far) continue;
    far = t;
    which = k;
  }
  return `${which} ${far}`;
}
function dots(list, a) {
  let total = 0;
  for (let k = 0; k < list.length; k++) {
    total += list[k] * a[0] - list[k] * a[1] + a[2];
    if (total > 1000) total -= a[0] + a[1] + a[2];
  }
  return total;
}
const planes = [];
for (let k = 0; k < 24; k++) planes.push(new Plane(k % 3, k * 0.25 - 2, 1.5 - k * 0.125, k - 7.5));
const out = [];
for (let turn = 0; turn < 40; turn++) {
  const doubles = [turn * 0.5 + 0.25, 1.5, -turn - 0.125], whole = [turn, 2, 3];
  out.push(nearest(planes, doubles, [0.5, 0.25, turn + 0.5], 1000), nearest(planes, whole, [1, 2, turn], 1000), nearest(planes, whole, doubles, 1000), nearest(planes, doubles, whole, 1000), nearest(planes, doubles, doubles, 1000));
  out.push(dots(doubles, doubles), dots(whole, doubles), dots(doubles, whole), dots(whole, whole));
}
out.push(nearest(planes, [1.5, , 2.5], [1, 2, 3], 1000), nearest(planes, [0.5], [0.5, 1, 2], 1000), nearest(planes, [NaN, -0, 1], [undefined, 1, 2], 1000), dots([1.5, , 2], [0.5, , 1]), dots([1, 2], [1]), nearest(planes, [0.5, 1, 2], [], undefined));
console.log(out.join());
