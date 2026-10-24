// The environment of the process, one probe of many. It prints what plain Bun prints.
const held = { n: 21 };
const map = new Map([["a", held], ["b", { n: 22 }]]);
const set = new Set(["x", "y"]);
for (const key of map.keys()) console.log(key);
for (const value of map.values()) console.log(value.n);
for (const [key, value] of map.entries()) console.log(key, value.n);
for (const value of set.values()) console.log(value);
const kept = map.keys();
for (const key of kept) console.log(key);
console.log([...map.keys()].join(), [...set.values()].join(), [...map.entries()].length);
