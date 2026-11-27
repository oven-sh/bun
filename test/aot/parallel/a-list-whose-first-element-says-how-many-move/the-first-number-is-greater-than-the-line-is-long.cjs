// The first number of some lines is much greater than their length: places behind the end are read and filled.
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

for (const great of [6, 9, 40, 300]) {
  const line = usual(5, 2);
  line[0] = great;
  const turns = settle(line, 3);
  console.log(great, turns, line.length, show(line.slice(0, 6)), line[great], great in line);
}
const line = usual(9, 4);
console.log(settle(line, 70), show(line));
