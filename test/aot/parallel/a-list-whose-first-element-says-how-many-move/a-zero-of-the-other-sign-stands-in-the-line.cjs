// A negative zero stands in the line: it ends the loop where it comes first, and it stays negative where it moves.
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

for (const place of [0, 1, 2, 4]) {
  const line = usual(5, 3);
  for (let other = 0; other < line.length; other++) if (line[other] === 0) line[other] = 1;
  line[place] = -0;
  console.log(place, settle(line, 30), show(line), Object.is(line[0], -0), 1 / line[0]);
}
const plain = usual(7, 5);
console.log(settle(plain, 100), show(plain), Object.is(plain[0], -0));
