// The first says where the next first is fetched: some of those places hold nothing.
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

function thinned(count, every) {
  const line = usual(count, 3);
  for (let place = every; place < count; place += every) delete line[place];
  return line;
}
for (const [count, every] of [[7, 4], [8, 3], [10, 5], [11, 6]]) {
  const line = thinned(count, every);
  console.log(count, every, settle(line, 10), show(line));
}
const whole = usual(7, 3);
console.log(settle(whole, 200), show(whole));
