// The same loop is handed lines of int32s, of whole numbers that are kept as doubles, and of both.
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

function asDoubles(line) {
  line[line.length - 1] += 0.5;
  line[line.length - 1] -= 0.5;
  return line;
}
function boxed(line) {
  line.push("a word");
  line.length--;
  return line;
}
for (let round = 0; round < 12; round++) {
  let line = usual(6 + (round % 3), 5);
  if (round % 4 === 1) line = asDoubles(line);
  if (round % 4 === 2) line = boxed(line);
  if (round % 4 === 3) line = asDoubles(boxed(line));
  console.log(round, settle(line, 90), show(line));
}
