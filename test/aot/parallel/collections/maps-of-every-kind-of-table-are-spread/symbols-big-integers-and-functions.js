const show = list => list.length + ": " + list.slice(0, 6).concat(list.slice(-3)).map(pair => "[" + pair.map(v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : typeof v === "symbol" ? v.toString() : typeof v + ":" + String(v)).join(" = ") + "]#" + pair.length).join(" ");
// A list that begins with a text holds any value from its birth: only such a list takes the pairs in a row. The list of `[...map]` gets the storage that its site has seen, and a site that runs once has seen nothing.
const listOf = map => { const list = ["head", ...map]; list.shift(); return list; };
const f = function named() {};
const map = new Map([[Symbol("s"), 10n], [10n, Symbol.iterator], [f, f], [true, false], ["", ""]]);
console.log(show(listOf(map).map(([k, v]) => [typeof k === "function" ? k.name : k, typeof v === "function" ? v.name : v])));
console.log(listOf(map)[2][0] === f);
