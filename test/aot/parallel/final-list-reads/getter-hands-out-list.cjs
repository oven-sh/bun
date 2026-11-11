"use strict";
const names = JSON.parse('["seen", "length", "0", "push", "other"]');
const kept = [];
Object.defineProperty(Array.prototype, names[0], { get() { kept.push(this); return this; }, configurable: true });
function fill(n, key) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i * 2);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += list[i];
  if (sum < 0) return -1;
  return list[key];
}
function rows(n, key) {
  const grid = [];
  for (let i = 0; i < n; i++) grid.push([i, i + 1]);
  const first = grid[0];
  let sum = 0;
  for (let i = 0; i < n; i++) sum += grid[i][1];
  if (sum < 0) return first;
  return grid[key];
}
function rolling(a, b, key) {
  let previous = [];
  for (let j = 0; j <= b; j++) previous.push(j);
  for (let i = 1; i <= a; i++) {
    const current = [i];
    for (let j = 1; j <= b; j++) current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (i === j ? 0 : 1)));
    previous = current;
  }
  return previous[key];
}
function usedBehind(n, key) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i + 0.5);
  const got = list[key];
  if (Array.isArray(got)) got.push("text", { a: 1 });
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return [String(sum), list.length, got === list];
}
function usedInLoop(n, key) {
  let out = "";
  const list = [1, 2, 3];
  for (let i = 0; i < n; i++) {
    const got = list[key];
    if (Array.isArray(got)) got[0] = "changed" + i;
    out += list[0] + ";";
  }
  return out;
}
function twoReads(n, key) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i);
  return list[key] === undefined ? "none" : [list[key], typeof list[0]];
}
function capture(n, key) {
  const list = [1.5, 2.5];
  const later = () => list[0] + list[1];
  const got = list[key];
  if (Array.isArray(got)) got[1] = "text";
  return later();
}
function inTry(n, key) {
  const list = [4, 5, 6];
  try {
    return list[key];
  } finally {
    list.push(7);
    kept.push(list.length, list[3]);
  }
}
for (const key of [0, 2, -1, 1.5, "1", "length", names[0], names[4], Symbol.iterator, undefined, null, { toString: () => "2" }, { toString: () => names[0] }]) {
  const shown = value => Array.isArray(value) ? "[" + value.map(shown).join() + "]" : typeof value === "function" ? value.name : String(value);
  const said = [];
  for (const f of [fill, rows, usedBehind, usedInLoop, twoReads, capture, inTry]) {
    let got = f(4, key);
    if (f === fill && Array.isArray(got)) {
      got.push("after", { b: 2 });
      got[0] = "text";
      got.length = 3;
    }
    if (f === rows && Array.isArray(got) && Array.isArray(got[0])) got[0][1] = "row text";
    said.push(shown(got));
  }
  let last = rolling(3, 4, key);
  if (Array.isArray(last)) {
    last[1] = "rolled";
    last.push(null);
  }
  said.push(shown(last));
  console.log(String(typeof key === "symbol" ? "symbol" : typeof key), said.join(" | "));
}
for (const one of kept) if (Array.isArray(one)) {
  one.push("kept");
  one[0] = { c: 3 };
}
console.log(kept.length, kept.map(one => Array.isArray(one) ? one.length + typeof one[0] : one).join(" "));
console.log(String(fill(3, 1)), String(rolling(2, 2, 2)), String(rows(2, 1)), usedBehind(2, 1).join());
