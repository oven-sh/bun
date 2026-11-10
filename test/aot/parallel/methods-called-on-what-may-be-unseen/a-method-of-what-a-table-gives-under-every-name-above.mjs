class Node { constructor(v) { this.v = v; this.calls = 0; } get(n) { this.calls++; return this.v + n; } toString() { return "N" + this.v; } hasOwnProperty() { return "mine"; } }
const table = { a: new Node(1), b: new Node(2.5) };
function at(key) { try { const found = table[key]; return found ? found.get(1) + ":" + found.v : "none"; } catch (e) { return e.constructor.name; } }
function said(key) { try { return table[key].toString().length; } catch (e) { return e.constructor.name; } }
function owns(key) { try { return String(table[key].hasOwnProperty("v")); } catch (e) { return e.constructor.name; } }
function bound(key) { try { return typeof table[key].bind(null); } catch (e) { return e.constructor.name; } }
const keys = ["a", "b", "c", "constructor", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", ""];
for (let r = 0; r < 2; r++) console.log(keys.map(at).join(" "), "|", keys.map(said).join(" "), "|", keys.map(owns).join(" "), "|", keys.map(bound).join(" "));
console.log(table.a.v, table.a.calls, table.b.v, table.b.calls, Object.keys(table).join());
