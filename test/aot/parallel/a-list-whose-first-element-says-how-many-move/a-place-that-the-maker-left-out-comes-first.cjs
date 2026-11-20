// The maker leaves one place of the line out; after some turns that place is the first.
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

function gapped(count, gap) {
  const line = new Array(count);
  for (let place = 0; place < count; place++) if (place !== gap) line[place] = count - 1 - place;
  return line;
}
for (const [count, gap] of [[5, 1], [6, 3], [6, 5], [8, 2], [8, 7]]) {
  const line = gapped(count, gap);
  console.log(count, gap, settle(line, 12), show(line), line[undefined]);
}
console.log(settle(usual(8, 3), 500), settle(usual(5, 2), 500));
