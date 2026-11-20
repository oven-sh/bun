// The rows of a literal of empty literals are filled under a counter that starts at their length.
"use strict";
function strips(count, by) {
  const all = [[], [], []];
  for (let y = 0; y < 3; y++) {
    for (let at = 0; at < count; at++) all[y][at] = at * by + y;
  }
  return all;
}
function two(count) {
  const all = [[], []];
  for (let at = 0; at < count; at++) {
    all[0][at] = at / 2;
    all[1][at] = at % 3 === 0 ? "s" + at : at;
  }
  return all;
}
function behind(count, from) {
  const all = [[7], [8]];
  for (let y = 0; y < 2; y++) for (let at = from; at < count; at++) all[y][at] = at;
  return all;
}
const text = rows => rows.map(row => Array.from(row, (one, at) => (at in row ? String(one) : "hole")).join(" ")).join(" / ");
for (let round = 0; round < 30; round++) {
  const line = text(strips(4 + (round % 3), round)) + " | " + text(two(round % 6)) + " | " + text(behind(4, 1));
  if (round % 11 === 0) console.log(line);
}
console.log(text(strips(0, 1)), text(strips(3, 0.5)), text(strips(3, "2")), text(strips(2, NaN)), text(behind(4, 2)), text(behind(3, 0)), text(behind(1, 5)));
const kept = strips(2, 1);
kept[0].push("more");
console.log(text(kept), text(strips(2, 1)), kept[1] === kept[2]);
console.log(text(strips(3, { valueOf: () => 4 })), text(strips(2, -0)), Object.is(strips(1, -0)[0][0], -0), strips(1, -0)[0][0]);
