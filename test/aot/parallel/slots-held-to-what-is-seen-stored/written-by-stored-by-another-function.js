// A slot of which nothing is written is held to what is seen stored in it. How the fields are written here: stored by another function.
// STATISTIC: FieldTypesEnforced >= 7
var slot = "h" + (Date.now() > 0 ? "idden" : "");
function hide(x) { globalThis[slot] = x; return globalThis[slot]; }
function Other(w) { this.w = w; }
function answer() { return 42; }
function K() { this.i = 0; this.f = 0.5; this.b = false; this.t = ""; this.s = null; this.o = new Other(0); this.l = [0]; this.c = answer; this.m = new Map(); this.g = 0n; }
function fill(k, n) { k.i = n; k.f = n + 0.5; k.b = n > 1; k.t = "t" + n; k.s = null; k.o = new Other(n); k.l = [n, n + 1]; k.c = answer; k.m = new Map([[n, n]]); k.g = 10n; }
function make(n) { var k = new K(); fill(k, n); return k; }
function say(v) { return typeof v === "object" ? (v === null ? "null" : Array.isArray(v) ? "list" + v.length : v instanceof Map ? "map" + v.size : v instanceof Other ? "other" + v.w : "i" in v ? "itself" : "object") : typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v); }
function readI(k) { return (k.i | 0) + k.i; }
function readF(k) { return k.f * 2; }
function readB(k) { return k.b ? 1 : 2; }
function readT(k) { return k.t.length + k.t; }
function readS(k) { return k.s === null ? 0 : k.s.i; }
function readO(k) { return k.o.w + 1; }
function readL(k) { return k.l.length + k.l[0]; }
function readC(k) { return k.c(); }
function readM(k) { return k.m.size; }
function readG(k) { return k.g + 1n; }
var readers = [readI, readF, readB, readT, readS, readO, readL, readC, readM, readG];
function read(k) { var out = [say(k.i), say(k.f), say(k.b), say(k.t), say(k.s), say(k.o), say(k.l), say(k.c), say(k.m), say(k.g), "|"]; for (var r = 0; r < readers.length; r++) { try { out.push(say(readers[r](k))); } catch (e) { out.push(e.constructor.name); } } return out.join(" "); }
function byName(h, name, value) { if (name === "i") h.i = value; else if (name === "f") h.f = value; else if (name === "b") h.b = value; else if (name === "t") h.t = value; else if (name === "s") h.s = value; else if (name === "o") h.o = value; else if (name === "l") h.l = value; else if (name === "c") h.c = value; else if (name === "m") h.m = value; else h.g = value; }
var names = hide(["i", "f", "b", "t", "s", "o", "l", "c", "m", "g"]);
var values = hide([1.5, -0, 2147483648, NaN, "text", "", true, null, undefined, {}, [], Math.max, Symbol.iterator, 10n, 7, new Set([1]), new Other(9)]);
var first = make(1), second = make(2); first.s = second;
console.log(read(first)); console.log(read(second));
for (var road = 0; road < 3; road++) for (var i = 0; i < names.length; i++) for (var j = 0; j < values.length; j++) {
  var k = make(3), h = hide(k);
  if (road === 0) byName(h, names[i], values[j]); else if (road === 1) h[names[i]] = values[j]; else Reflect.set(h, names[i], values[j]);
  console.log(road, names[i], j, read(k));
}
console.log(read(first)); console.log(Object.keys(second).join());
