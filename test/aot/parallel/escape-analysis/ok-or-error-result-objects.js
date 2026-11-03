// A function returns `{ ok: true, value }` or `{ ok: false, error }` and the caller reads one field by `ok`. Neither object is allocated.
// COUNT: branches >= 1
// COUNT: cells <= 1000
"use strict";
function parse(text) {
  if (text.length & 1) return { ok: false, error: "odd" };
  return { ok: true, value: text.length * 2 };
}
function parseTwice(text) {
  const first = parse(text);
  if (!first.ok) return first;
  return { ok: true, value: first.value + 1 };
}
function kept(text) {
  const result = parse(text);
  if (text.length === 4) all.push(result);
  return result.ok ? result.value : result.error.length;
}
const all = [];
const texts = ["a", "bb", "ccc", "dddd", "eeeee", "ffffff", "ggggggg"];
let sum = 0;
for (let i = 0; i < 70000; i++) {
  const r = parse(texts[i % 7]);
  sum += r.ok ? r.value : r.error.length;
}
for (let i = 0; i < 70000; i++) {
  const r = parseTwice(texts[i % 7]);
  sum += r.ok ? r.value : r.error.length;
}
for (let i = 0; i < 14; i++) sum += kept(texts[i % 7]);
console.log(sum, JSON.stringify(all), JSON.stringify(texts.map(parseTwice)));
