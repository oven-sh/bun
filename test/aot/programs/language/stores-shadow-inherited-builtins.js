// A store on an object that inherits a property from a built-in. The lock makes every property of a built-in read-only, and an inheritor may still override what was writable before: `error.name = ..`, `object.toString = ..`. What the language itself makes read-only (a function's length and name, Math.PI, Number.MAX_VALUE, Symbol.iterator) refuses the store, as in plain JavaScript.
function row(what, f) { try { console.log(what + ":", JSON.stringify(f())); } catch (e) { console.log(what + ":", "THROWS", e.name); } }
function named() { return 1; }
row("delete length, then store", () => { const d = delete named.length; named.length = 5; return [d, named.length, Object.hasOwn(named, "length")]; });
function named2(a, b) { return 1; }
row("delete name, then store", () => { const d = delete named2.name; named2.name = "other"; return [d, named2.name, Object.hasOwn(named2, "name")]; });
const arrow = (a) => a;
row("an arrow: delete length, then store", () => { delete arrow.length; arrow.length = 7; return [arrow.length, Object.hasOwn(arrow, "length")]; });
function named3(a) { return 1; }
row("store without deleting", () => { named3.length = 9; return named3.length; });
function named5(a) { return 1; }
row("deleted: what is read", () => { delete named5.length; delete named5.name; return [named5.length, named5.name, "length" in named5, Object.hasOwn(named5, "length")]; });
class K { static m() {} }
row("a class: delete name, then store", () => { delete K.name; K.name = "L"; return [K.name, Object.hasOwn(K, "name")]; });
row("a method: delete length, then store", () => { delete K.m.length; K.m.length = 3; return [K.m.length]; });
const bound = named3.bind(null);
row("a bound function", () => { delete bound.length; bound.length = 4; return [bound.length]; });
row("by Reflect.set", () => { function g(a) {} delete g.length; return [Reflect.set(g, "length", 5), g.length]; });
row("by a computed key", () => { function g(a) {} const k = ["len", "gth"].join(""); delete g[k]; g[k] = 5; return [g.length]; });
for (const [what, parent, key] of [["Function.prototype", Function.prototype, "length"], ["Function.prototype", Function.prototype, "name"], ["Math", Math, "PI"], ["Math", Math, "SQRT2"], ["Number", Number, "MAX_VALUE"], ["Number", Number, "EPSILON"], ["Number", Number, "NaN"], ["Symbol", Symbol, "iterator"], ["String.prototype", String.prototype, "length"], ["Uint8Array", Uint8Array, "BYTES_PER_ELEMENT"], ["Array", Array, "prototype"], ["Symbol.prototype", Symbol.prototype, Symbol.toStringTag], ["a built-in function", Array.prototype.push, "length"], ["a built-in function", Array.prototype.push, "name"]]) {
  row("read-only in the language: " + what + " " + String(key), () => { const o = Object.create(parent); o[key] = 3; return ["stored", Object.hasOwn(o, key)]; });
  row("read-only in the language, by Reflect.set: " + what + " " + String(key), () => { const o = Object.create(parent); return [Reflect.set(o, key, 3), Object.hasOwn(o, key)]; });
}
for (const [what, parent, key] of [["Object.prototype", Object.prototype, "toString"], ["Object.prototype", Object.prototype, "constructor"], ["Error.prototype", Error.prototype, "name"], ["Error.prototype", Error.prototype, "message"], ["TypeError.prototype", TypeError.prototype, "name"], ["Array.prototype", Array.prototype, "length"], ["Array.prototype", Array.prototype, "push"], ["Array.prototype", Array.prototype, Symbol.iterator], ["Math", Math, "max"], ["Number", Number, "parseFloat"], ["Error", Error, "stackTraceLimit"], ["Function.prototype", Function.prototype, "call"], ["Promise.prototype", Promise.prototype, "then"], ["Map.prototype", Map.prototype, "get"]]) {
  row("writable in the language: " + what + " " + String(key), () => { const o = Object.create(parent); o[key] = 3; return [o[key], Object.hasOwn(o, key)]; });
  row("writable in the language, by Reflect.set: " + what + " " + String(key), () => { const o = Object.create(parent); return [Reflect.set(o, key, 3), o[key]]; });
}
class Failure extends Error { constructor(m) { super(m); this.name = "Failure"; this.message = m + "!"; } }
row("the usual subclass of Error", () => { const f = new Failure("m"); return [f.name, f.message, String(f)]; });
class Limited extends Error {}
row("a static member of a subclass", () => { Limited.stackTraceLimit = 5; return [Limited.stackTraceLimit, Object.hasOwn(Limited, "stackTraceLimit")]; });
row("a frozen prototype of the program's own", () => { const p = Object.create(Object.freeze({ x: 1 })); p.x = 5; return p.x; });
row("hot", () => { let thrown = 0; for (let i = 0; i < 3000; i++) { const o = Object.create(Math); try { o.PI = i; } catch { thrown++; } o.max = i; } return thrown; });
