// New maps and sets that loops over lists fill: long and short lists, duplicates, holes, lists that change on the way, tables that are asked, emptied and left behind early.
const lines = [];
const list = (n, of) => Array.from({ length: n }, (_, i) => of(i));
function fill(values) {
  const map = new Map(), set = new Set();
  for (const value of values) {
    map.set(value, map.size);
    set.add(value);
  }
  let sum = 0;
  for (const [key, place] of map) sum = (sum + place * (typeof key === "string" ? key.length : 1)) | 0;
  return map.size + "/" + set.size + "/" + sum;
}
for (const n of [0, 1, 4, 5, 31, 32, 33, 64, 255, 256, 257, 300, 1000, 5000])
  lines.push(n + " " + fill(list(n, (i) => i)) + " " + fill(list(n, (i) => "key" + i)) + " " + fill(list(n, (i) => i % 10)) + " " + fill(list(n, (i) => (i % 3 ? i / 2 : "t" + i))));
lines.push(fill([1, , 3, , undefined]), fill(new Array(40)), fill("some text of letters"), fill(new Set(list(90, (i) => i & 31))), fill(new Map([["a", 1]])));
function grows(n) {
  const values = list(n, (i) => i), set = new Set();
  for (const value of values) {
    set.add(value);
    if (value < 100) values.push(value + 1000);
    if (set.size > 400) break;
  }
  return set.size;
}
function shrinks(n) {
  const values = list(n, (i) => "v" + i), map = new Map();
  for (const value of values) {
    map.set(value, 1);
    if (map.size === 7) values.length = 9;
  }
  return map.size;
}
function thrown(n) {
  const map = new Map();
  try {
    for (const value of list(n, (i) => i)) {
      map.set(value, value);
      if (value === 70) throw new Error("seventy");
    }
  } catch (error) {
    return error.message + map.size + map.get(70) + map.has(71);
  }
  return map.size;
}
function pairs(n) {
  const map = new Map(), back = new Map();
  for (const [key, value] of list(n, (i) => ["k" + i, i * 1.5])) {
    map.set(key, value);
    back.set(value, key);
  }
  return map.size + back.get(1.5) + map.get("k" + (n - 1));
}
for (const n of [10, 60, 300, 900]) lines.push(grows(n) + " " + shrinks(n) + " " + thrown(n) + " " + pairs(n));
function many(turns) {
  let total = 0;
  for (let turn = 0; turn < turns; turn++) {
    const seen = new Set();
    for (const value of [turn, 1, turn + 1, 1]) seen.add(value);
    total += seen.size;
  }
  return total;
}
lines.push(String(many(50)));
console.log(lines.join("\n"));
