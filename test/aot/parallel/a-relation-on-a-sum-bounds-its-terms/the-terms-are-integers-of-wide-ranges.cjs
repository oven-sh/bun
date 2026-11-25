function wide(a, b, n) {
  const from = -((a >>> 0) * 1048576);
  const limit = (n >>> 0) * 1048575;
  let count = (b >>> 0) * 1024;
  let turns = 0;
  while (from + count < limit && turns < 6) { count += 4398046511104; turns++; }
  return [from, limit, count, turns, from + count, count + 1, count * 2].join();
}
function tooWide(a, b, n) {
  const from = -((a >>> 0) * 2097152);
  const limit = (n >>> 0) * 2097151;
  let count = (b >>> 0) * 2048;
  let turns = 0;
  while (from + count <= limit && turns < 6) { count += 8796093022208; turns++; }
  return [from, limit, count, turns, from + count, count + 1].join();
}
function ofWords(a, b, n) {
  const from = a | 0;
  const limit = n >>> 0;
  let count = b >>> 0;
  let turns = 0;
  while (from + count < limit && turns < 4) { count += 1073741824; turns++; }
  return [from, limit, count, turns, from + count, count | 0, count >>> 0, count + 2147483648].join();
}
function both(a, n) {
  let left = a | 0, right = 0, turns = 0;
  const limit = n >>> 0;
  while (left + right < limit && turns < 5) { left += 536870912; right += 1073741824; turns++; }
  return [left, right, turns, left + right, left * 4, right * 4].join();
}
globalThis.kept = [wide, tooWide, ofWords, both];
const words = [0, 1, 2147483647, 2147483648, 4294967295, -1, -2147483648, 1024];
const said = [];
for (const a of words) for (const n of words) said.push(wide(a, n, n), wide(a, a, n), tooWide(a, n, n), tooWide(n, a, a), ofWords(a, n, n), ofWords(a, a, n), both(a, n));
console.log(said.join("\n"));
