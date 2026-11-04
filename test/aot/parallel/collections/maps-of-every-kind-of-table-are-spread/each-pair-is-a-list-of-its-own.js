const show = list => list.length + ": " + list.slice(0, 6).concat(list.slice(-3)).map(pair => "[" + pair.map(v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : typeof v === "symbol" ? v.toString() : typeof v + ":" + String(v)).join(" = ") + "]#" + pair.length).join(" ");
// A list that begins with a text holds any value from its birth: only such a list takes the pairs in a row. The list of `[...map]` gets the storage that its site has seen, and a site that runs once has seen nothing.
const listOf = map => { const list = ["head", ...map]; list.shift(); return list; };
const map = new Map([["a", 1], ["b", 2]]);
const first = listOf(map), second = listOf(map);
first[0].push("more", "and more", "and more"); first[1].length = 0; first[0][0] = "changed";
console.log(show(first.slice(0, 1)), first[1].length, show(second), first[0] === second[0], Array.isArray(second[0]), Object.getPrototypeOf(second[0]) === Array.prototype, Object.keys(second[0]).join());
