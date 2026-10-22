// What built ins make: programs p map from pairs. It prints what plain Bun prints.
// @ts-nocheck
// Instructions an entry of new Map(pairs) | new Set(strings) | a loop of map.set | a loop of set.add, keys that are strings.
const what = process.argv[2];
const size = 500, rounds = 400;
const source = {};
for (let i = 0; i < size; i++) source["key" + i] = "value" + i;
const pairs = Object.entries(source);
const keys = Object.keys(source);
const cut = keys.map(key => (key + "-tail").slice(0, key.length));
let kept = 0;
for (let round = 0; round < rounds; round++) {
  if (what === "map") kept += new Map(pairs).size;
  else if (what === "set") kept += new Set(keys).size;
  else if (what === "cut") kept += new Set(keys.map(key => (key + "-tail").slice(0, key.length))).size;
  else if (what === "cut-none") kept += keys.map(key => (key + "-tail").slice(0, key.length)).length;
  else if (what === "map-set") { const map = new Map(); for (let i = 0; i < size; i++) map.set(keys[i], i); kept += map.size; }
  else if (what === "set-add") { const set = new Set(); for (let i = 0; i < size; i++) set.add(keys[i]); kept += set.size; }
  else kept += pairs.length;
}
console.log(kept);
