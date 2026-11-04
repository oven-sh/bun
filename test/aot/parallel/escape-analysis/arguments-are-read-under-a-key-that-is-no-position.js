// `arguments[key]` in a function that does nothing else with the object: the key is a position, then a name, a text that is a position, a symbol, and an object whose toString counts its calls
let conversions = 0;
let key = JSON.parse("1");
function pick() { return arguments[key]; }
function deed() { try { return String(typeof pick("a", "b", "c") === "function" ? "function" : pick("a", "b", "c")) + " " + String(pick()); } catch (e) { return e.name; } }
console.log(deed());
let last = "";
for (let turn = 0; turn < 300; turn++) { key = turn & 3; last = deed(); }
console.log(last);
const keys = [5, -1, 0.5, -0, 2 ** 31, "2", "02", "length", "callee", Symbol.iterator, null, undefined, NaN, { toString() { conversions++; return "0"; } }];
for (let i = 0; i < keys.length; i++) { key = keys[i]; console.log(i, deed(), conversions); }
key = 0;
console.log(deed());
