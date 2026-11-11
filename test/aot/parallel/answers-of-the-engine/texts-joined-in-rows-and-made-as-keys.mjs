// A row of joins is one operation where each part is proven to have text by itself, and a text whose first reader takes it as a key is made as a key: AOTWalkTypedTexts.cpp. Each way in which that could show: numbers of every kind among the parts, -0 and whole doubles as parts of keys, undefined, null, booleans and BigInts, a row on the right, two rows, a sum in front of the text, objects whose conversions tell their order, a text with a second reader, keys of objects, of a Set and of a Map.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function typed(a, n) { if (typeof a !== "string" || typeof n !== "number") return "no"; return "<" + a + ":" + n + ">" + a + n; }
function onTheRight(text, a, n) { if (typeof text !== "string" || typeof a !== "string" || typeof n !== "number") return "no"; return text + (a + n + ","); }
function twoRows(a, b) { if (typeof a !== "string" || typeof b !== "string") return "no"; return (a + "-" + b) + (b + "+" + a); }
function primitive(a, x) { if (typeof a !== "string") return "no"; if (typeof x === "function" || typeof x === "symbol" || (typeof x === "object" && x !== null)) return "object"; return a + x + "|" + x + a; }
function sumFirst(n, m, a) { if (typeof n !== "number" || typeof m !== "number" || typeof a !== "string") return "no"; return n + m + a + n + m; }
function anything(a, x, y) { return a + x + y + a; }
function template(a, x, y) { return `${a}[${x}]${y}` + a + `${x}`; }
function kept(a, b) { if (typeof a !== "string" || typeof b !== "string") return "no"; const both = a + b; return both + a + both.length; }
function inLoop(a, count) { if (typeof a !== "string") return "no"; let text = ""; for (let i = 0; i < count; i++) text += a + i + ","; return text; }
function look(table, kind, id) { if (typeof kind !== "string" || typeof id !== "number") return "no"; const key = kind + ":" + id; let found = table[key]; if (found === undefined) { found = key; table[key] = found; } return found; }
function has(table, kind, id) { if (typeof kind !== "string" || typeof id !== "number") return "no"; return (kind + ":" + id) in table; }
function byTemplate(table, a, b) { return table[`${a}:${b}`]; }
function inSet(set, kind, id) { if (typeof kind !== "string" || typeof id !== "number") return "no"; const was = set.has(kind + id); set.add(kind + id); return was; }
function inMap(map, a, b) { const was = map.get(`${a}/${b}`); map.set(`${a}/${b}`, (was || 0) + 1); return was; }
const order = [];
function teller(name) { return { toString() { order.push("toString " + name); return name; }, valueOf() { order.push("valueOf " + name); return name + "!"; } }; }
report(typed("a", 1));
report(typed("", -0));
report(typed("€", 1.5));
report(typed("a", NaN));
report(typed("a", 1e21));
report(typed("a", -2147483648));
report(typed(1, 1));
report(onTheRight("text", "k", 7));
report(onTheRight("", "", 0));
report(twoRows("x", "y"));
report(primitive("a", undefined));
report(primitive("a", null));
report(primitive("a", true));
report(primitive("a", 12n));
report(primitive("a", 0.1));
report(primitive("a", "b"));
report(sumFirst(1, 2, "a"));
report(sumFirst(0.5, 0.25, ""));
report(anything("a", 1, 2));
report(anything(1, 2, "a"));
report(anything("a", teller("x"), teller("y")));
report(anything(teller("a"), teller("x"), 1));
report(template("a", teller("x"), teller("y")));
report(template(teller("a"), 1, undefined));
report(order.join());
report(kept("ab", "cd"));
report(inLoop("k", 12));
report(inLoop("k", 700).length);
const table = {};
report(look(table, "a", 1));
report(look(table, "a", 1));
report(look(table, "a", 1.0));
report(look(table, "a", -0));
report(look(table, "a", 0));
report(look(table, "a", 1.5));
report(look(table, "a:1", 5));
report(look(table, "", 2147483648));
report(look(table, "a", NaN));
report(Object.keys(table).join());
report(has(table, "a", 1));
report(has(table, "a", 2));
report(has(table, "a", -0));
report(byTemplate(table, "a", 1));
report(byTemplate(table, "a", -0));
report(byTemplate(table, "a", teller("1")));
report(byTemplate(table, "b", 1));
report(order.join());
const set = new Set();
report(inSet(set, "a", 1));
report(inSet(set, "a", 1));
report(inSet(set, "a1", -0));
report(inSet(set, "a", 10));
report(set.size);
const map = new Map();
report(inMap(map, "a", 1));
report(inMap(map, "a", 1));
report(inMap(map, "a", "1"));
report(inMap(map, teller("a"), 1));
report(map.size);
let sum = 0;
for (let i = 0; i < 3000; i++) sum += look(table, i & 1 ? "odd" : "even", i % 50).length + (has(table, "odd", i % 100) ? 1 : 0);
report(sum);
report("end");
