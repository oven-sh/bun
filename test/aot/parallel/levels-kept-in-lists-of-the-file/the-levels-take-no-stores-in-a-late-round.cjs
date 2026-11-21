// A table is kept in lists that are constants of the file; in a late round the list takes no stores, and the store throws.
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

function tried(change) {
  try {
    return String(settle(8, 6, change));
  } catch (error) {
    return error.constructor.name;
  }
}
console.log(tried(round => round === 3 && Object.defineProperty(levels, 5, { writable: false })), show(levels));
console.log(tried(null), show(levels));
Object.defineProperty(levels, 5, { writable: true });
console.log(tried(round => round === 4 && Object.preventExtensions(levels)), show(levels));
console.log(tried(round => round === 2 && Object.freeze(levels)), show(levels));
console.log(tried(null), show(levels));
