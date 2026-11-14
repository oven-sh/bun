// STATISTIC: FieldFactorsTakenForNumbers >= 1
// row[i] + this.factor * row[j]: the factor is read out of a field of numbers, so a hole in the row reads as NaN.
function Plane(axis, nu, nv) {
  this.axis = axis;
  this.nu = nu;
  this.nv = nv;
}
Plane.prototype.along = function (row) {
  const u = (this.axis + 1) % 3, v = (this.axis + 2) % 3;
  return row[this.axis] + this.nu * row[u] + this.nv * row[v];
};
function sum(planes, row) {
  let total = 0;
  for (let k = 0; k < planes.length; k++) {
    const d = planes[k].along(row);
    if (d < 1000) total += d;
    else total -= 0.5;
  }
  return total;
}
const planes = [];
for (let k = 0; k < 30; k++) planes.push(new Plane(k % 3, k * 0.25 - 1, 1 - k * 0.125));
const out = [];
for (let turn = 0; turn < 40; turn++) out.push(sum(planes, [turn * 0.5, 1 - turn, 0.25]), sum(planes, [turn, 2, 3]));
out.push(sum(planes, [1.5, , 2.5]), sum(planes, [0.5]), sum(planes, [0.5, undefined, 1]), sum(planes, [1, 2, 3, 4]), sum(planes, [NaN, -0, 1]));
// A field that is deleted, or that holds no number, adds strings.
function Scaled(by) {
  this.by = by;
}
Scaled.prototype.of = function (row, k) {
  return row[k] + this.by * 2;
};
Scaled.prototype.beside = function (row, k) {
  return row[k] + this.by;
};
function texts(scaled, row) {
  let all = '';
  for (let k = 0; k < row.length; k++) all += `${scaled.of(row, k)} ${scaled.beside(row, k)};`;
  return all;
}
const twice = new Scaled(1.5), text = new Scaled('3'), none = new Scaled(undefined);
for (let turn = 0; turn < 20; turn++) out.push(texts(twice, [turn, 0.5, 2]));
out.push(texts(twice, [1, , 2.5]), texts(text, [1, , 2.5]), texts(none, [1, , 2]), texts(twice, ['x', 1.5]), texts(twice, [1.5, 'x']));
delete twice.by;
Scaled.prototype.by = 'p';
out.push(texts(twice, [1, , 2.5]));
console.log(out.join());
