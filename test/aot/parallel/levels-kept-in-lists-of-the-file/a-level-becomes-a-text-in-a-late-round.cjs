// A table is kept in lists that are constants of the file; in a late round a text goes into the list of numbers.
// STATISTIC: ModuleConstantReadsHoisted >= 1
// STATISTIC: AbsentArrayElementWideningsAvoided >= 1
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

console.log(settle(8, 6, round => round === 4 && (levels[3] = "7")), show(levels));
console.log(settle(8, 6, round => round === 5 && (levels[0] = "low")), show(levels));
console.log(settle(8, 6, round => round === 3 && (marks[6] = "3")), show(levels));
console.log(settle(8, 6, round => round === 2 && (levels[2] = 0.5)), show(levels));
