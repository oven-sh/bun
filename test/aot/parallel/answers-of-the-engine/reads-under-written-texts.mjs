// Reads under keys that are handed over: texts of the program, names of Object.prototype among them, on records, on objects of classes, on arrays and on what has another prototype.
const out = [];
const log = (...values) => out.push(values.join(" "));
const show = run => { try { const v = run(); return typeof v === "function" ? "function " + v.name : typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (error) { return error.constructor.name; } };
class Point {
  constructor(x, y) { this._x = x; this._y = y; }
  get x() { return this._x; }
  add(o) { return new Point(this._x + o._x, this._y + o._y); }
}
class Named extends Point { get name() { return "named " + this.x; } toString() { return "its text"; } }
const listeners = {};
function on(type, handle) { (listeners[type] || (listeners[type] = [])).push(handle); }
function emit(type, value) { const list = listeners[type]; if (list) for (let i = 0; i < list.length; i++) list[i](value); return list ? list.length : -1; }
let seen = 0;
on("move", p => { seen += p.x; });
on("move", p => { seen += p._y; });
on("stop", p => { seen -= p.x; });
let sum = new Point(0, 0);
for (let i = 0; i < 1000; i++) sum = sum.add(new Point(i, 1));
log(emit("move", sum), emit("stop", new Point(1, 2)), emit("none", sum), seen);
const table = { own: 1, get made() { return this.own + 1; }, toString: 5 };
const read = key => table[key];
log(read("own"), read("made"), read("none"), read("toString"), show(() => read("valueOf")), show(() => read("constructor")), read("__proto__") === Object.prototype);
const ofTable = key => listeners[key];
log(show(() => ofTable("move").length), show(() => ofTable("hasOwnProperty")), show(() => ofTable("constructor")));
const onlyWritten = key => named[key];
const named = new Named(3, 4);
log(onlyWritten("_x"), onlyWritten("x"), onlyWritten("name"), show(() => onlyWritten("add")), show(() => onlyWritten("none")));
const anyName = (o, key) => o[key];
log(anyName(named, "toString").call(named), show(() => anyName(named, "constructor")), anyName(named, "__proto__") === Named.prototype, anyName(sum, "x"), show(() => anyName(sum, "isPrototypeOf")));
const bare = Object.create(null), above = Object.create({ found: "above" });
const ofBare = key => bare[key], ofAbove = key => above[key];
log(ofBare("toString"), ofBare("none"), ofAbove("found"), ofAbove("none"), show(() => ofAbove("toString")));
const list = [7, 8];
const ofList = key => list[key];
log(ofList("0"), ofList("length"), ofList("none"), show(() => ofList("push")));
const late = {};
const ofLate = key => late[key];
log(ofLate("a"), ofLate("b"));
late.a = 1;
Object.setPrototypeOf(late, { b: "linked" });
log(ofLate("a"), ofLate("b"), ofLate("c"));
console.log(out.join("\n"));
