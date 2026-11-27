// The first of a line says out of which place the next first comes, and those in front of that place move by one: all numbers are small and every place is filled.
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

for (const [count, step] of [[4, 1], [5, 3], [7, 2], [7, 5], [9, 4], [11, 7], [12, 5]]) {
  const line = usual(count, step);
  const turns = settle(line, 4000);
  console.log(count, step, turns, show(line));
}
let all = 0;
for (let round = 0; round < 60; round++) {
  const line = usual(7 + (round % 4) * 2, 3);
  line[round % 5] = (line[round % 5] + round) % line.length;
  all += settle(line, 300);
}
console.log(all);
