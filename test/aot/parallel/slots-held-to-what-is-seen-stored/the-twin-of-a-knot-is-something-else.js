// A slot of an untyped constructor function is held to what is seen stored in it. null | itself was seen; another object, a list, a function and a primitive come.
// STATISTIC: FieldTypesEnforced >= 2
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
function up(k) { var steps = 0; for (var at = k; at !== null && at !== undefined && steps < 5; at = at.self) steps += typeof at.n === "number" ? at.n : 100; return steps; }
for (var j = 0; j < values.length; j++) { var k = new Knot(1, "k"); k.self = new Knot(2, "l"); hide(k.self).self = values[j]; var r; try { r = up(k); } catch (e) { r = e.constructor.name; } console.log(j, say(r), show(k.self)); }
var fake = hide({ n: 50, self: null }); var k = new Knot(1, "k"); hide(k).self = fake; console.log(up(k), show(k));

console.log(Object.keys(first).join(), "|", show(other));
