class Node { constructor(v) { this.v = v; this.calls = 0; } get(n) { this.calls++; return this.v + n; } take(c) { return c.y; } valueOf() { return this.v * 100; } }
class Carried { constructor(y) { this.y = y; } }
const table = { a: new Node(1), b: new Node(2.5) }, carried = new Carried(5);
function at(key) { try { const found = table[key]; return found ? found.get(1) + ":" + found.v : "none"; } catch (e) { return e.constructor.name; } }
function call(key, name) { try { return String(table[key][name](carried)); } catch (e) { return e.constructor.name; } }
const keys = ["a", "b", "c", "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__", "__lookupGetter__", ""];
console.log(keys.map(at).join(" "));
console.log(keys.map(k => call(k, "take")).join(" "));
console.log(keys.map(k => call(k, "call")).join(" | "));
console.log(keys.map(k => call(k, "toString")).join(" | ").length, keys.map(k => call(k, "valueOf")).map(s => s.length).join(" "));
console.log(keys.map(k => call(k, "bind")).map(s => s.slice(0, 12)).join(" | "));
console.log(table.a.v, table.a.calls, table.b.v, table.b.calls, carried.y, Object.keys(table).join(), Object.keys(carried).join());
