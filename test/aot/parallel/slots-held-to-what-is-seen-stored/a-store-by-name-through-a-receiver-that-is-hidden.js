// A slot of an untyped constructor function is held to what is seen stored in it. The receiver has gone through a place that nobody follows.
// STATISTIC: FieldsHeldToWhatIsSeen >= 4
function Knot(n, s) { this.n = n; this.s = s; this.self = null; this.b = false; this.d = 0.5; this.length = 3; this.stack = 0; }
function sum(k) { var t = 0; for (var i = 0; i < 3; i++) { t += k.n; t += k.s.length; t += k.d; if (k.b) t += 1; if (k.self !== null) t += k.self.n; t += k.length; } return t; }
function bits(k) { return (k.n | 0) + (k.n & 7) + (k.length << 1); }
function say(v) { return typeof v === "object" ? (v === null ? "null" : v instanceof Knot ? "knot" : Array.isArray(v) ? "list" : "object") : typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v); }
function show(k) { var parts = [say(k.n), say(k.s), say(k.self), say(k.b), say(k.d), say(k.length), typeof k.stack]; try { parts.push(say(sum(k))); } catch (e) { parts.push(e.constructor.name); } try { parts.push(say(bits(k))); } catch (e) { parts.push(e.constructor.name); } return parts.join(" "); }
var slot = "h" + (Date.now() > 0 ? "idden" : "");
function hide(x) { globalThis[slot] = x; return globalThis[slot]; }
var names = hide(["n", "s", "self", "b", "d", "length"]);
var values = hide([1.5, -0, 2147483648, NaN, "text", "", true, null, undefined, {}, [], Math.max, Symbol.iterator, 10n, 7]);
var first = new Knot(1, "one"), other = new Knot(2, "two"); first.self = other;
console.log(show(first), "|", show(other));
for (var i = 0; i < names.length; i++) for (var j = 0; j < values.length; j++) { var k = new Knot(i, "k" + j); k.self = other; var name = names[i], value = values[j];
  var h = hide(k); if (name === "n") h.n = value; else if (name === "s") h.s = value; else if (name === "self") h.self = value; else if (name === "b") h.b = value; else if (name === "d") h.d = value; else h.length = value;
  console.log(name, j, show(k)); }

console.log(Object.keys(first).join(), "|", show(other));
