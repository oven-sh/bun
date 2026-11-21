// Helpers tell values apart by typeof, by whether they equal themselves and by (x | 0) == x. Calls in loops hand them one kind, several kinds, and kinds that change.
"use strict";
function size(value) {
  if (typeof value === "string") {
    let sum = 0;
    for (let at = 0; at < value.length; at++) sum = (sum * 3 + value.charCodeAt(at)) | 0;
    return sum;
  }
  if (typeof value === "number") {
    if (value !== value) return -1;
    if ((value | 0) == value) return value & 1023;
    return Math.floor(value * 16) % 1024;
  }
  if (typeof value === "boolean") return value ? 2 : 3;
  if (value == null) return 4;
  if (typeof value === "function") return 5 + value.length;
  if (typeof value === "bigint") return Number(value & 7n);
  if (typeof value === "symbol") return 6;
  return value.size === undefined ? 7 : value.size;
}
function alike(one, two) {
  if (one === two) return one !== 0 || 1 / one === 1 / two;
  if (one !== one) return two !== two;
  if (typeof one !== typeof two) return false;
  if (typeof one === "object" && one !== null && two !== null) return one.size === two.size && one.size !== undefined;
  return false;
}
function all(values) {
  let sum = 0;
  for (const value of values) sum = (sum * 5 + size(value)) | 0;
  return sum;
}
function pairs(values) {
  let same = "";
  for (let at = 1; at < values.length; at++) same += alike(values[at - 1], values[at]) ? "=" : ".";
  return same;
}
function ofNumbers(count) {
  let sum = 0;
  for (let at = 0; at < count; at++) sum += size(at) + size(at / 4) + (alike(at, at | 0) ? 1 : 0);
  return sum;
}
function ofTexts(words) {
  let sum = 0;
  for (let at = 0; at < words.length; at++) sum ^= size(words[at]) + (alike(words[at], words[0]) ? 1 : 0);
  return sum;
}
for (let round = 0; round < 30; round++) {
  const line = [ofNumbers(50 + round), ofTexts(["one", "two", "one", "" + round]), all([round, round / 2, round * 3]), all(["a" + round, "b"])];
  if (round % 9 === 0) console.log(line.join());
}
const kinds = [0, -0, 1, 1.5, NaN, NaN, "1", "", true, false, null, undefined, undefined, () => 1, Math.max, 5n, 5n, Symbol.iterator, Symbol.iterator, {}, [], { size: 3 }, new Map([[1, 2]]), new Set([4]), 2147483648, -2147483649, Infinity, 4294967296];
console.log(all(kinds), pairs(kinds), kinds.map(size).join());
let value = 1;
let trail = "";
for (let at = 0; at < 24; at++) {
  trail += size(value) + " ";
  value = at % 6 === 0 ? String(value) : at % 6 === 2 ? { size: at } : at % 6 === 4 ? at / 8 : at % 6 === 5 ? null : at;
}
console.log(trail, alike({ size: 1 }, { size: 1 }), alike({}, {}), alike(0, -0), alike(new Map(), new Set()));
