const show = list => list.length + ": " + list.slice(0, 6).concat(list.slice(-3)).map(pair => "[" + pair.map(v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : typeof v === "symbol" ? v.toString() : typeof v + ":" + String(v)).join(" = ") + "]#" + pair.length).join(" ");
// A list that begins with a text holds any value from its birth: only such a list takes the pairs in a row. The list of `[...map]` gets the storage that its site has seen, and a site that runs once has seen nothing.
const listOf = map => { const list = ["head", ...map]; list.shift(); return list; };
const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
const walk = map.entries(); console.log(JSON.stringify(walk.next()));
console.log(show(listOf(map)));
map.clear(); map.set("d", 4);
console.log(JSON.stringify(walk.next()), JSON.stringify(walk.next()));
console.log(show(listOf(map)));
