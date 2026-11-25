// The length of the line is set to more than it holds: what is fetched comes out of places that hold nothing.
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

for (const more of [1, 3, 9]) {
  const line = usual(5, 2);
  line.length += more;
  line[1] = 4 + more;
  console.log(more, settle(line, 9), show(line));
}
const whole = usual(9, 2);
console.log(settle(whole, 400), show(whole));
