// Heir.prototype = new Parent(), where unseen code passes the parent: the prototype is an object of a class. Its fields hide nothing from the heirs' stores; reads of what an heir lacks find them.
// COUNTER: ClassGuardBitsInvalidated >= 1
"use strict";
globalThis.pass = (value, to) => to(value);
const pass = globalThis.pass, out = [];
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
function Cursor(text) { this.text = text; this.pos = 0; this.kind = "eof"; this.last = null; }
Cursor.prototype.step = function () { const first = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.pos++; this.kind = "name"; this.last = this.pos; return this.pos - first; };
Cursor.prototype.all = function () { let n = 0; while (this.pos < this.text.length) n += this.step(); return n; };
Cursor.prototype.look = function () { return [this.text, this.pos, this.kind, this.last, this.late].join(); };
const make = (keeps) => (Base) => { function Heir(text) { Base.call(this, text); this.extra = 1; } Heir.prototype = new Base("proto"); if (keeps) Heir.prototype.constructor = Heir; Heir.prototype.more = function () { return this.extra + this.pos; }; return Heir; };
const bare = (Base) => { function Bare(t) { if (t) this.text = t; } Bare.prototype = new Base("fallback"); Bare.prototype.constructor = Bare; return Bare; };
const First = pass(Cursor, make(true)), Second = pass(Cursor, make(false)), Third = pass(First, make(true)), Bare = pass(Cursor, bare);
const classes = [First, Second, Third, Bare], text = "alpha beta gamma ";
let total = 0;
for (let i = 0; i < 200; i++) for (const C of [First, Second, Third]) { const o = new C(text + i); total += o.all() + o.more(); }
out.push(total);
const see = (C) => { const o = new C("a bc"); out.push(show(() => o.look()), show(() => o.all()), o.look(), show(() => o.more()), JSON.stringify(o), Object.keys(o).join(), o instanceof Cursor, o instanceof C, Object.getPrototypeOf(o) === C.prototype); delete o.kind; delete o.pos; out.push(o.look(), JSON.stringify(o)); o.pos = 2; out.push(o.look()); };
classes.forEach(see); { const b = new Bare(""); out.push(b.look(), JSON.stringify(b), show(() => b.all()), b.look()); }
// The prototypes' own fields change: values, read-only, accessors, deletions, frozen; new names; other parents.
First.prototype.kind = "changed"; First.prototype.late = "L"; Bare.prototype.pos = 3; classes.forEach(see);
Object.defineProperty(First.prototype, "last", { set(v) { out.push("set" + v); }, get() { return "got"; }, configurable: true }); see(First); see(Third); delete First.prototype.last; see(First);
Object.defineProperty(Second.prototype, "pos", { value: 9, writable: false, configurable: true, enumerable: true }); out.push(show(() => see(Second))); out.push(show(() => new Second("q").pos));
delete Second.prototype.pos; see(Second);
First.prototype.step = function () { this.pos += 5; return 1; }; see(First); see(Third); see(Second);
Object.freeze(Bare.prototype); out.push(show(() => new Bare("frozen"))); { const b = new Bare(""); out.push(b.look(), show(() => { b.kind = 1; })); }
Object.setPrototypeOf(Third.prototype, { all() { return "moved"; }, look() { return "far" + this.text; } }); see(Third);
Cursor.prototype.look = function () { return "parent" + this.pos; }; classes.forEach((C) => out.push(show(() => new C("z").look())));
for (const line of out) console.log(String(line));
