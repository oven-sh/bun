"use strict";
const hide = v => [v][JSON.parse("0")];
const out = [];
function read(o, keys) { const row = []; for (let k = 0; k < keys.length; k++) { let v; try { v = o[keys[k]]; } catch (e) { v = "throws " + e.constructor.name; } row.push(typeof v === "function" ? "function" : String(v)); } return row.join(); }
function sweep(name, o) { const keys = hide([0, 1, 2, 7, 300, -1, 2147483647, 4294967294, 4294967295, 1.5, -0]); for (let r = 0; r < 3; r++) out.push(name + ":" + read(hide(o), keys)); }
class Row { constructor() { this.a = 1; } }
class Wide extends Row { constructor() { super(); this.b = 2; } m() { return 1; } }
class Numbered { 0() { return "m0"; } get 1() { return "g1 " + (this instanceof Numbered); } static 2() { return "s2"; } }
class BelowNumbered extends Numbered { constructor() { super(); this.c = 3; } }
class Laid { constructor() { this.a = 1; } }
class LaidLate { constructor() { this.a = 1; } }
class Bag extends Map {}
class List extends Array {}
class View extends Uint8Array {}
function Made() { this.x = 1; }
function MadeBelow() { this.y = 2; } MadeBelow.prototype = { 2: "two on the prototype", z: 1 };
const withElements = { 0: "zero", 2: "two", 7: "seven" };
const withGetter = { get 1() { return "got " + typeof this; } };
sweep("an instance", new Row());
sweep("an heir", new Wide());
sweep("a literal", { a: 1 });
sweep("an empty literal", {});
sweep("a literal with indexes", { 0: "a", 2: "c", x: 1 });
sweep("a literal with a getter under an index", { get 0() { return "g0"; }, x: 1 });
sweep("a literal with a computed index", { [hide(7)]: "seven", x: 1 });
sweep("a literal with names like numbers", { "-1": "minus one", "1.5": "a fraction", "4294967295": "past the indexes" });
sweep("numbered members", new Numbered());
sweep("below numbered members", new BelowNumbered());
sweep("the class with a numbered static", Numbered);
sweep("the prototype with numbered members", Numbered.prototype);
sweep("made by a function", new Made());
sweep("made below a literal with an index", new MadeBelow());
sweep("an heir of map", new Bag());
sweep("an heir of array", List.from(["p", , "r"]));
sweep("an heir of a view", new View([9, 8]));
sweep("below an instance", Object.create(new Row()));
sweep("below a literal with indexes", Object.create(withElements));
sweep("an instance below a literal with indexes", Object.setPrototypeOf(new Row(), withElements));
sweep("an instance below a getter", Object.setPrototypeOf(new Row(), withGetter));
sweep("an instance below null", Object.setPrototypeOf(new Row(), null));
sweep("an instance below a proxy", Object.setPrototypeOf(new Row(), new Proxy({}, { get(t, k) { return typeof k === "string" ? "trap " + k : undefined; } })));
sweep("an instance below a list", Object.setPrototypeOf(new Row(), ["a", , "c"]));
sweep("an instance below a text object", Object.setPrototypeOf(new Row(), new String("xyz")));
const a = new Laid(); sweep("before", a);
Laid.prototype[2] = "laid on the prototype of the class"; sweep("an index laid on the prototype of the class", a); sweep("a new one below it", new Laid());
Object.defineProperty(Laid.prototype, "7", { get() { return "a getter on the prototype of the class"; }, configurable: true }); sweep("a getter laid there", a);
delete Laid.prototype[2]; delete Laid.prototype[7]; sweep("both deleted", a);
const b = new LaidLate(); sweep("its own before", b);
b[1] = "its own"; sweep("its own laid", b);
b[300] = "far"; sweep("a far one laid", b);
delete b[1]; delete b[300]; sweep("its own deleted", b);
b.later = 5; sweep("a name laid", b);
Object.defineProperty(b, "0", { get() { return "its own getter"; }, configurable: true }); sweep("its own getter", b);
const c = new Wide(); Row.prototype[0] = "on the class above"; sweep("an index on the class above", c); delete Row.prototype[0]; sweep("deleted there", c);
const d = { a: 1 }, above = { b: 2 }; Object.setPrototypeOf(d, above); sweep("a literal below a literal", d);
above[2] = "laid above"; sweep("an element laid above", d); delete above[2]; sweep("deleted above", d);
sweep("frozen", Object.freeze(new Row())); sweep("sealed with an index", Object.seal(Object.assign(new Row(), { 1: "one" })));
const many = []; for (let i = 0; i < 40; i++) { const o = i & 1 ? new Row() : { a: i }; if (i % 5 === 0) o[i % 3] = "own " + i; many.push(o); }
for (let i = 0; i < 40; i += 7) sweep("one of many " + i, many[i]);
let h = 7; for (const line of out) for (let i = 0; i < line.length; i++) h = (h * 31 + line.charCodeAt(i)) % 1000003;
console.log(out.length, h); console.log(out.filter((l, i) => i % 3 === 0).join("\n"));
