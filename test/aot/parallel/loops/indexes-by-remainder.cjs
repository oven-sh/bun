// STATISTIC: RemaindersByShortProduct >= 1
// vector[(axis + 1) % 3]: the remainder of a dividend of 32 bits, and reads under it in a loop.
function Plane(axis, offset) {
  this.axis = axis;
  this.offset = offset;
}
Plane.prototype.side = function (direction) {
  const u = (this.axis + 1) % 3, v = (this.axis + 2) % 3;
  return direction[this.axis] * this.offset + direction[u] * 0.5 - direction[v];
};
function nearest(planes, direction) {
  let least = Infinity;
  for (let i = 0; i < planes.length; i++) {
    const side = planes[i].side(direction);
    if (side < least) least = side;
  }
  return least;
}
const planes = [];
for (let k = 0; k < 30; k++) planes.push(new Plane(k % 3, k * 0.25));
let total = 0;
for (let turn = 0; turn < 50; turn++) total += nearest(planes, [turn * 0.5, 1.5 - turn, 2.25]);
console.log(total, nearest(planes, [1, 2]), nearest(planes, []), nearest([new Plane(5, 1), new Plane(1, 2)], [1, 2, 3]), nearest([new Plane(2147483647, 1)], [1, 2, 3]));

// Dividends up to 2^32, divisors of every size.
function rests(list) {
  let text = "";
  for (let i = 0; i < list.length; i++) {
    const x = list[i] >>> 0;
    text += `${x % 3} ${x % 7} ${x % 10} ${x % 641} ${x % 65537} ${x % 2147483647} ${(x + 1) % 3};`;
  }
  return text;
}
console.log(rests([0, 1, 2, 3, 6, 7, 9, 10, 640, 641, 65536, 65537, 715827882, 1431655765, 1431655766, 2147483646, 2147483647, 2147483648, 4294967289, 4294967294, 4294967295]));
