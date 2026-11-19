"use strict";
function joined(seed, times) {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(given, turns) {
  const text = String(given);
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) sum += text.charCodeAt(turn);
  return sum;
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
let asked = 0;
console.log(scan(idle, JSON.parse("0")), scan(idle, JSON.parse('"0"')), scan(idle, JSON.parse("null")), scan(read, JSON.parse('"3"')), scan(read, JSON.parse("4")), scan(read, { valueOf() { asked++; return 2; } }), asked);
