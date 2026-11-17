const show = list => list.length + ": " + list.slice(0, 6).concat(list.slice(-3)).map(pair => "[" + pair.map(v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : typeof v === "symbol" ? v.toString() : typeof v + ":" + String(v)).join(" = ") + "]#" + pair.length).join(" ");
// A list that begins with a text holds any value from its birth: only such a list takes the pairs in a row. The list of `[...map]` gets the storage that its site has seen, and a site that runs once has seen nothing.
const listOf = map => { const list = ["head", ...map]; list.shift(); return list; };
const map = new Map(); for (let i = 0; i < 40; i++) map.set("k" + i, i);
for (let i = 0; i < 5; i++) map.delete("k" + i);
console.log(show(listOf(map)));
for (let i = 10; i < 30; i += 2) map.delete("k" + i);
console.log(show(listOf(map)));
for (let i = 35; i < 40; i++) map.delete("k" + i);
console.log(show(listOf(map)));
map.set("k0", "again");
console.log(show(listOf(map)));
