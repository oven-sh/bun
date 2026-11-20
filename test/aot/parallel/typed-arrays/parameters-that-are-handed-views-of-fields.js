// Parameters that loops read by position are handed the views that fields hold, and other values at other calls.
"use strict";
class Panel {
  constructor(count) {
    this.dots = new Uint8Array(count);
    this.sums = new Int32Array(count);
    this.reals = new Float64Array(count);
    for (let at = 0; at < count; at++) {
      this.dots[at] = at * 7;
      this.sums[at] = 1 << (at % 31);
      this.reals[at] = at / 4;
    }
  }
  moveDots(from, count) {
    move(this.dots, from, this.sums, 1, count);
  }
  moveSums(count) {
    move(this.sums, 0, this.reals, 0, count);
  }
  lit() {
    return count(this.dots, 100) + count(this.sums, 4) + count(this.reals, 1);
  }
}
function move(source, from, target, to, amount) {
  for (let at = 0; at < amount; at++) target[to + at] = source[from + at];
}
function count(values, least) {
  let found = 0;
  for (let at = 0; at < values.length; at++) if (values[at] >= least) found++;
  return found;
}
function widest(values) {
  let best = -Infinity;
  for (let at = 0, size = values.length; at < size; at++) best = Math.max(best, values[at]);
  return best;
}
const panel = new Panel(24);
for (let round = 0; round < 50; round++) {
  panel.moveDots(round % 9, 12);
  panel.moveSums(20);
  const lit = panel.lit();
  if (round % 16 === 0) console.log(round, lit, widest(panel.dots), widest(panel.reals), panel.sums.join());
}
panel.moveDots(20, 9);
panel.moveSums(40);
console.log(panel.sums.join(), panel.reals.join());
const list = [];
move(panel.dots, 3, list, 2, 4);
console.log(list.map(String).join(), list.length, 0 in list);
move([1, "2", null, undefined, {}], 0, panel.sums, 0, 5);
move("98765", 1, panel.dots, 0, 6);
console.log(panel.sums.slice(0, 6).join(), panel.dots.slice(0, 6).join());
console.log(count("3140", 3), count([0.5, "7", [9]], 1), count({ length: 3, 1: 5 }, 2), count(new Set([1]), 0), widest([]), widest("12"), widest(new Float32Array([NaN, 1])));
for (const values of [null, undefined]) {
  try {
    count(values, 1);
  } catch (error) {
    console.log(error.constructor.name);
  }
}
const words = new BigUint64Array([5n, 9n]);
console.log(count(words, 6));
try {
  move(words, 0, panel.dots, 0, 1);
} catch (error) {
  console.log(error.constructor.name, panel.dots[0]);
}
panel.dots = [300, 4, 100];
console.log(panel.lit());
panel.sums = panel.dots;
panel.moveDots(0, 3);
console.log(panel.dots.join(), panel.lit());
