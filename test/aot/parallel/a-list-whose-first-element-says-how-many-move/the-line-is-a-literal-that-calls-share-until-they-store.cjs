// The line is a literal: each call makes its own of the numbers that the text holds, and stores into that alone.
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

function literal(which) {
  if (which === 0) return [3, 1, 4, 0, 2];
  if (which === 1) return [2, 2, 0, 1];
  return [5, 4, 3, 2, 1, 0];
}
for (let round = 0; round < 9; round++) {
  const line = literal(round % 3);
  const turns = settle(line, 40);
  console.log(round % 3, turns, show(line), show(literal(round % 3)));
}
