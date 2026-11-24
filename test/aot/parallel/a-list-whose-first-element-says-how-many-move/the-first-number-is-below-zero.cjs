// The first number is below zero: nothing moves, and the number is laid under a name that is no place.
// Under: --aot-harden=proof-checks: what the head of a turn has asked is held against the list at every access
"use strict";
function settle(line, most) {
  let turns = 0;
  while (line[0] !== 0 && turns < most) {
    const from = line[0];
    const fetched = line[from];
    for (let place = from; place > 0; place--) line[place] = line[place - 1];
    line[0] = fetched;
    turns++;
  }
  return turns;
}
function show(line) {
  let text = String(line.length) + ":";
  for (let place = 0; place < line.length; place++) text += " " + (place in line ? (Object.is(line[place], -0) ? "-0" : String(line[place])) : "hole");
  return text;
}
function usual(count, step) {
  const line = [];
  for (let place = 0; place < count; place++) line.push((place * step + 2) % count);
  return line;
}

for (const below of [-1, -2, -7, -2147483648]) {
  const line = usual(6, 5);
  line[0] = below;
  console.log(below, settle(line, 4), show(line), line[below], Object.keys(line).length);
}
const line = usual(8, 5);
console.log(settle(line, 70), show(line));
