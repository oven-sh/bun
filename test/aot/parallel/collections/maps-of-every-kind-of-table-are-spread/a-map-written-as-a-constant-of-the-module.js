const show = list => list.length + ": " + list.slice(0, 6).concat(list.slice(-3)).map(pair => "[" + pair.map(v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : typeof v === "symbol" ? v.toString() : typeof v + ":" + String(v)).join(" = ") + "]#" + pair.length).join(" ");
// A list that begins with a text holds any value from its birth: only such a list takes the pairs in a row. The list of `[...map]` gets the storage that its site has seen, and a site that runs once has seen nothing.
const listOf = map => { const list = ["head", ...map]; list.shift(); return list; };
const table = new Map([["one", 1], ["two", 2], ["three", 3], ["four", 4]]);
const numbers = new Map([[1, "one"], [2, "two"]]);
console.log(show(listOf(table)), show(listOf(numbers)));
console.log(show(listOf(table)));
table.set("five", 5); numbers.delete(1);
console.log(show(listOf(table)), show(listOf(numbers)));
