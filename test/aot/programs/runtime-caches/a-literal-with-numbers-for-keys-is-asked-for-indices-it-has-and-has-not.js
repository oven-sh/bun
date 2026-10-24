// Objects that keep elements beside their fields are asked, through a function that knows nothing of them, for indices that they have, that they lack, that something above them has, and for keys that only look like indices.
function ask(table, key) { return table[key]; }
function show(label, table, keys) { console.log(label, keys.map(key => String(ask(table, key))).join(" ")); }
const keys = JSON.parse('[204, 205, 200, 0, 1, 303, 304, 305, 1000000, -1, 2147483647, 204.0, 204.5, "204", "200", "-1", 4294967295, 4294967294, -0]');
keys.push(NaN, undefined, null, true);
show("booleans", { 204: true, 205: true, 304: true }, keys);
show("integers", { 0: 1, 1: 2, 3: 4 }, keys);
show("doubles", { 0: 1.5, 1: 2.5, 3: 4.5 }, keys);
show("names too", { 1: "one", "-1": "minus one", name: "named" }, keys);

const above = { 200: "inherited 200", 1: "inherited 1" };
const below = { 204: "own 204", 3: "own 3" };
show("as written", below, keys);
Object.setPrototypeOf(below, above);
show("below another table", below, keys);
above[0] = "inherited 0, stored later";
show("which gets one more", below, keys);
Object.setPrototypeOf(below, null);
show("below nothing", below, keys);
Object.setPrototypeOf(below, Object.prototype);
show("as written again", below, keys);

const created = Object.create({ 7: "seven above" });
created[1] = "one";
created[2] = "two";
show("created below a table", created, [1, 2, 7, 8]);
class Table { constructor() { this[1] = "one"; this[3] = "three"; } }
Table.prototype[2] = "two above";
show("instance of a class", new Table(), [0, 1, 2, 3, 4]);
const withGetter = { 1: "one", 2: "two" };
Object.defineProperty(withGetter, 5, { get() { return "got 5"; } });
show("with a getter", withGetter, [1, 2, 3, 5, 6]);
const holes = { 0: "a", 1: "b", 2: "c" };
delete holes[1];
show("with a hole", holes, [0, 1, 2, 3]);
const trapped = { 1: "one" };
Object.setPrototypeOf(trapped, new Proxy({}, { get(_, key) { return "trapped " + String(key); } }));
show("below a proxy", trapped, [1, 2, 3]);
