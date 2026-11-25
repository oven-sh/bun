// The first place holds nothing when the loop begins; on some lines an element of the prototype stands behind it.
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

function headless(count) {
  const line = new Array(count);
  for (let place = 1; place < count; place++) line[place] = (place * 3) % count;
  return line;
}
console.log(settle(headless(4), 3), settle(headless(7), 3));
const first = headless(6);
console.log(settle(first, 2), show(first));
const below = headless(5);
Object.setPrototypeOf(below, Object.assign(Object.create(Array.prototype), { 0: 2 }));
console.log(settle(below, 9), show(below));
const whole = usual(7, 4);
console.log(settle(whole, 50), show(whole));
