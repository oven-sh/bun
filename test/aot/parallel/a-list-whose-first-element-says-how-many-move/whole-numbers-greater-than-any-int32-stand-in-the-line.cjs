// Whole numbers beyond int32 stand in the line and move as they are; where one is first it names no place.
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

for (const [place, great] of [[1, 2147483648], [2, 4294967296], [3, 9007199254740991], [2, -2147483649], [4, 4294967295]]) {
  const line = usual(6, 5);
  line[place] = great;
  line[0] = 3;
  const turns = great > 0 ? settle(line, 1) : settle(line, 2);
  console.log(place, great, turns, line.length, show(line.slice(0, 6)));
}
const line = usual(8, 5);
console.log(settle(line, 60), show(line));
