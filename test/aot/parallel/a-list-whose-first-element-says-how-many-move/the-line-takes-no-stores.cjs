// The line is frozen, sealed, or has one place that cannot be written: the store that fails says so, and what was moved before it stays moved.
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

function tried(line) {
  let word;
  try {
    word = settle(line, 20);
  } catch (error) {
    word = error.constructor.name;
  }
  return word + " " + show(line);
}
console.log(tried(Object.freeze(usual(6, 5))));
console.log(tried(Object.seal(usual(6, 5))));
console.log(tried(Object.preventExtensions([4, 1, 0])));
const oneKept = usual(7, 3);
Object.defineProperty(oneKept, 1, { value: 5, writable: false });
console.log(tried(oneKept));
console.log(tried(Object.freeze([0, 1, 2])));
console.log(tried(usual(7, 5)));
