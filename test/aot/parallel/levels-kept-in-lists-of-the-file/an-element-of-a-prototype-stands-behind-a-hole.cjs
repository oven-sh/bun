// A table is kept in lists that are constants of the file; a prototype that holds an element is laid between, and it shows where the list has a hole.
"use strict";
const levels = [];
const marks = [];
function settle(count, rounds, change) {
  for (let at = 0; at < count; at++) {
    marks[at] = (at * 7) % 5;
    levels[at] = at;
  }
  let last = 0;
  for (let round = 0; round < rounds; round++) {
    if (change !== null) change(round);
    let fall = round;
    for (let at = 0; at < count; at++) {
      const here = levels[at];
      fall = marks[at] === round ? here + 1 : fall - here > 2 ? here : fall;
      levels[at] = fall;
    }
    last = fall;
  }
  return last;
}
function show(list) {
  let text = list.length + ":";
  for (let at = 0; at < list.length; at++) text += " " + (Object.hasOwn(list, at) ? String(list[at]) : "hole");
  return text;
}
for (let turn = 0; turn < 30; turn++) {
  const last = settle(9 + (turn % 4), 6, null);
  if (turn % 13 === 0) console.log(last, show(levels));
}

const between = Object.create(Array.prototype, { 4: { value: 40, writable: true }, 6: { get: () => 60, set() {} } });
console.log(settle(8, 6, round => {
  if (round !== 3) return;
  Object.setPrototypeOf(levels, between);
  delete levels[4];
  delete levels[6];
}), show(levels), levels[6]);
console.log(settle(8, 6, null), show(levels), levels[6]);
Object.setPrototypeOf(levels, Array.prototype);
console.log(settle(8, 6, null), show(levels));
