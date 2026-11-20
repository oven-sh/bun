// Constructor functions whose parent is what a variable or a property holds that the build does not follow: their objects may have the layout of the parent's objects.
// COUNTER: DynamicSubclassInstances >= 5
"use strict";
const out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function Cursor(words) { this.words = words; this.mark = 0; this.mood = "new"; this.past = null; }
Cursor.prototype.all = function () { let n = 0; while (this.mark < this.words.length) n += this.words.charCodeAt(this.mark++); this.mood = "end"; return n; };
Cursor.prototype.kind = function () { return "cursor"; };
const registry = new Map([["cursor", Cursor]]), lib = { tools: {} };
const found = registry.get("cursor"); lib.tools.Cursor = registry.get("cursor");
let chosen = null; if (process.argv.length > 0) chosen = [found][0];
const util = require("util");
function under(child, parent) { const own = { configurable: true, value: child, writable: true }; child.prototype = Object.create(parent.prototype, { constructor: own }); child.above = parent; }

function First(words) { found.call(this, words); this.one = 1; }
First.prototype = Object.create(found.prototype); First.prototype.constructor = First;
function Second(words) { lib.tools.Cursor.apply(this, arguments); this.two = [2]; }
util.inherits(Second, lib.tools.Cursor);
function Third(words) { this.three = 3; chosen.call(this, words); }
under(Third, chosen); Third.prototype.kind = function () { return "third " + chosen.prototype.kind.call(this); };
function Fourth(words) { const self = found.call(this, words) || this; self.four = 4; return self; }
Object.setPrototypeOf(Fourth.prototype, found.prototype); Object.setPrototypeOf(Fourth, found);
function Fifth(words) { found.call(this, words); this.five = 5; this.mark = 1; }
Fifth.prototype = new found(""); Fifth.prototype.constructor = Fifth;
// Nothing above these is a constructor function of the program, or nothing at all.
const { EventEmitter } = require("events"), streams = require("stream");
function Emits() { EventEmitter.call(this); this.n = 0; } util.inherits(Emits, EventEmitter);
function Writes() { streams.Writable.call(this); this.chunks = []; } under(Writes, streams.Writable); Writes.prototype._write = function (chunk, encoding, done) { this.chunks.push(String(chunk)); done(); };
function Bare(a) { this.a = a; } Bare.prototype = Object.create(null); Bare.prototype.get = function () { return this.a; };
function Root(a) { this.a = a; this.b = 1; } Root.prototype = Object.create(Object.prototype); Root.prototype.sum = function () { return this.a + this.b; };
const literal = { prototype: { where() { return "literal" + this.a; } } };
function OnLiteral(a) { this.a = a; } OnLiteral.prototype = Object.create(literal.prototype);

const classes = [First, Second, Third, Fourth, Fifth];
let total = 0;
for (let i = 0; i < 60; i++) for (const C of classes) { const o = new C("ab" + i); total += o.all() + o.kind().length; }
out.push(total);
for (const C of classes) {
  const o = new C("xyz");
  out.push(C.name, JSON.stringify(o), o.all(), o.kind(), Object.keys(o).join(), o instanceof Cursor, o instanceof C, Object.getPrototypeOf(o) === C.prototype, o.constructor === C);
  o.words = 5; o.mark = 1.5; o.mood = { t: 1 }; delete o.past; o.late = 1;
  const keys = []; for (const key in o) keys.push(key);
  out.push(keys.join(), JSON.stringify(o), "past" in o, JSON.stringify({ ...o }), show(() => Object.freeze(o).all()));
}
const e = new Emits(); e.on("x", function (v) { this.n += v; }); e.emit("x", 3); e.emit("x", 4); out.push(e.n, e instanceof EventEmitter, Object.keys(e).includes("n"));
const w = new Writes(); w.write("p"); w.write("q"); out.push(w.chunks.join(), w instanceof streams.Writable);
for (let i = 0; i < 20; i++) total += new Bare(i).get() + new Root(i).sum() + new OnLiteral(i).where().length;
out.push(total, new Bare(7).get(), new Bare(7) instanceof Object, JSON.stringify(new Root(3)), new Root(3).sum(), new OnLiteral(2).where());
out.push(show(() => First("a")), JSON.stringify(Reflect.construct(First, ["r"], Third)), Reflect.construct(First, ["r"], Third) instanceof Third);
class Below extends First { own = 1; all() { return super.all() + this.own; } } const b = new Below("mn"); out.push(b.all(), JSON.stringify(b), b.kind());
Cursor.prototype.kind = function () { return "changed"; }; out.push(...classes.map((C) => new C("k").kind()));
Object.setPrototypeOf(Second.prototype, { kind() { return "moved"; } }); out.push(new Second("a").kind(), show(() => new Second("a").all()), JSON.stringify(new Second("b")));
for (const line of out) console.log(String(line));
