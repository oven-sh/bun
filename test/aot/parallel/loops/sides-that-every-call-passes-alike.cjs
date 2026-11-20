// Every call in sight passes one number, so the body may use that number; some callers are not in sight, and some functions are handed on as values.
// STATISTIC: ParametersReplacedByConstants >= 1
"use strict";
function turned(cells, row, side) {
  let sum = 0;
  for (let column = 0; column < side; column++) sum += cells[((row + column) % side) * side + column];
  return sum;
}
function stirred(cells, row, side) {
  const out = [];
  for (let column = 0; column < side; column++) {
    let sum = cells[((row + column) % side) * side + column];
    for (let at = 0; at < side; at++) sum = (sum * 3 + cells[at * side + column]) % 1009;
    out.push(sum);
  }
  for (let column = 0; column < side; column++) cells[row * side + column] = out[column];
  return out.length + cells[side];
}
function scaled(cells, side, by) {
  for (let at = 0; at < side * side; at++) cells[at] = (cells[at] * by + at) % 1009;
  return cells;
}
function corner(cells, side) {
  return cells[0] * 2 + cells[side - 1] + cells[side * side - 1];
}
function square(side) {
  const cells = [];
  for (let at = 0; at < side * side; at++) cells.push(at * 3 + 1);
  return cells;
}
const cells = square(6);
let all = 0;
for (let round = 0; round < 60; round++) {
  all = (all + turned(cells, round % 6, 6) + turned(cells, (round + 2) % 6, 6)) % 100003;
  scaled(cells, 6, round & 3);
  all += corner(cells, 6);
  all += stirred(cells, round % 6, 6);
  all += stirred(cells, (round + 1) % 6, 6);
}
console.log(all, cells.join());
console.log(stirred(square(6), 5, 6), stirred(square(7), 1, 6));
const handed = [corner, scaled];
console.log(handed[0](square(4), 4), handed[0](square(3), "3"), handed[0]([7], 1), handed[0](square(2), undefined), handed[0](square(2)));
console.log(handed[1](square(2), 2, 5).join(), handed[1](square(2), 1.5, 5).join(), handed[1]([1, 2, 3], -2, 9).join());
const named = { corner, also: (...rest) => scaled(...rest).length };
for (const name of Object.keys(named)) console.log(name, named[name](square(5), 5, 2));
console.log([square(4), square(3)].map(corner).map(String).join(), Reflect.apply(corner, null, [square(8), 8]), corner.call(null, square(2), 2));
