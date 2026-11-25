// The line has no places, or lost them all before the loop.
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

const none = [];
console.log(settle(none, 2), show(none), Object.keys(none).join());
const emptied = usual(6, 5);
emptied.length = 0;
console.log(settle(emptied, 2), show(emptied), Object.keys(emptied).join());
const popped = usual(3, 2);
while (popped.length) popped.pop();
console.log(settle(popped, 1), show(popped), Object.keys(popped).join());
const whole = usual(8, 3);
console.log(settle(whole, 60), show(whole));
