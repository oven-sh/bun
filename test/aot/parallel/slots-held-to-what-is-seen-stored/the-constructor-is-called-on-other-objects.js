// A slot of an untyped constructor function is held to what is seen stored in it. The constructor fills objects that it has not made, with what was never seen.
// STATISTIC: FieldsHeldToWhatIsSeen >= 2
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
for (var j = 0; j < values.length; j++) { var made = hide(Knot), k = new made(values[j], values[(j + 1) % values.length]); console.log(j, show(k));
  var plain = {}; made.call(plain, values[j], "p"); console.log(j, say(plain.n), say(plain.s), Object.keys(plain).join());
  var again = new Knot(1, "a"); made.call(again, values[j], values[j]); console.log(j, show(again));
  var byReflect = Reflect.construct(made, [values[j], values[j]]); console.log(j, show(byReflect)); }

console.log(Object.keys(first).join(), "|", show(other));
