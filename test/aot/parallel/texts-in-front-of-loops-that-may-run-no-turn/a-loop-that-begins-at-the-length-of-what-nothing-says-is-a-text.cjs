"use strict";
function joined(seed, times) {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
function scan(given, from) {
  const text = String(given);
  let sum = 0;
  for (let i = from; i < text.length; i++) sum += text.charCodeAt(i);
  return sum;
}
const idle = joined(JSON.parse('"ab"'), 10), read = joined(JSON.parse('"cd"'), 10);
console.log(scan(idle, idle.length), scan(read, JSON.parse("2040")), scan(read, JSON.parse('"2046"')));
