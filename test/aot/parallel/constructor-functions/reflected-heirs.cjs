// Heirs that a function lays below its parent: Reflect.construct() makes their objects, as objects of the heir's class.
// COUNTER: operationAOTFillSiteAnswers <= 20
"use strict";
function Cursor(words) { this.mark = 0; this.span = null; this.till = 0; this.from = 0; this.tint = "bare"; this.words = words; }
Cursor.prototype.step = function () { this.from = this.mark; while (this.mark < this.words.length && this.words.charCodeAt(this.mark) !== 32) ++this.mark; this.till = this.mark; this.mark++; this.tint = "name"; this.span = this.till - this.from; return this.span; };
Cursor.prototype.all = function () { var n = 0; while (this.mark < this.words.length) n += this.step(); return n; };
function mixin(Base) {
  const reflects = typeof Reflect === "object" && typeof Reflect.construct === "function";
  function born(self, kind, given) {
    const parent = Object.getPrototypeOf(kind);
    const answer = reflects ? Reflect.construct(parent, given, self.constructor) : parent.apply(self, given);
    return answer !== null && typeof answer === "object" ? answer : self;
  }
  function below(kind, parent, methods) {
    if (typeof parent !== "function") throw new TypeError("nothing to stand below");
    kind.prototype = Object.create(parent.prototype);
    Object.defineProperty(kind.prototype, "constructor", { writable: true, configurable: true, value: kind });
    Object.setPrototypeOf(kind, parent);
    for (const name of Object.keys(methods)) Object.defineProperty(kind.prototype, name, { writable: true, configurable: true, value: methods[name] });
    return Object.defineProperty(kind, "prototype", { writable: false });
  }
  function Heir(words) {
    if (this === undefined) throw new TypeError("made without new");
    const self = born(this, Heir, [words]);
    self.extra = 1;
    return self;
  }
  return below(Heir, Base, { more: function () { return this.extra + this.mark; } });
}
var Heir = mixin(Cursor);
const out = [], words = "alpha beta gamma delta ".repeat(4);
let total = 0;
for (let i = 0; i < 200; i++) { const h = new Heir(words); total += h.all() + h.more(); }
const h = new Heir("a bc");
out.push(total, JSON.stringify(h), h.all(), h.more(), Object.keys(h).join(), h instanceof Cursor, h instanceof Heir, h.constructor === Heir, Object.getPrototypeOf(h) === Heir.prototype);
h.words = 1; h.mark = "p"; delete h.tint; h.late = [1]; h.span = { a: 1 };
const keys = []; for (const key in h) keys.push(key);
out.push(keys.join(), JSON.stringify(h), "tint" in h, h.more());
function Plain(a) { this.a = a; } Plain.prototype = Object.create(Heir.prototype); Plain.prototype.constructor = Plain;
const p = Reflect.construct(Cursor, ["q r"], Plain); out.push(JSON.stringify(p), p instanceof Plain, p instanceof Heir, p.all(), Object.keys(p).join());
const o = Reflect.construct(Cursor, ["r"], Object); out.push(JSON.stringify(o), Object.getPrototypeOf(o) === Object.prototype);
const e = Reflect.construct(Cursor, ["s t"], Heir); out.push(JSON.stringify(e), e instanceof Heir, e.all(), e.more());
class Below extends Heir { own = 1; all() { return super.all() + this.own; } } const b = new Below("u v w"); out.push(JSON.stringify(b), b.all(), b instanceof Cursor);
Heir.prototype.all = function () { return -1; }; out.push(new Heir("t").all(), h.all(), e.all(), b.all());
Object.setPrototypeOf(Object.getPrototypeOf(h), { kind() { return "other"; } }); const last = new Heir("u"); out.push(JSON.stringify(last), last instanceof Cursor, Reflect.construct(Cursor, ["v"], Heir).words);
const same = h.constructor; Object.setPrototypeOf(same || Heir, Array); let name = ""; try { const a = new Heir(3); name = Array.isArray(a) + String(a.length); } catch (error) { name = error.constructor.name; } out.push(name);
for (const line of out) console.log(String(line));
