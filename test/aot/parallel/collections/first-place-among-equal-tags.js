// The first of several places in a group of a table, the first digit of a number, the first character that differs.
const map = new Map();
let seed = 11;
const random = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const keys = [];
for (let i = 0; i < 600; i++) keys.push(i % 3 ? "k" + random(4000) : random(4000) * 0.5);
let sum = 0;
for (let round = 0; round < 3; round++) {
  for (const key of keys) map.set(key, (map.get(key) | 0) + round + 1);
  for (let i = round; i < keys.length; i += 5) map.delete(keys[i]);
  for (const key of keys) if (map.has(key)) sum = (sum * 31 + map.get(key)) | 0;
}
let text = "";
for (const number of [0, 7, 10, 99, 100, 1234, 9999, 10000, 70007, 12345678, 90000001]) text += number + ".";
let order = 0;
for (const left of keys.slice(0, 60)) for (const right of keys.slice(40, 90)) order = (order * 3 + ("" + left).localeCompare("" + right)) | 0;
console.log(map.size, sum, text, order);
