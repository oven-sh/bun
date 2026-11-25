// Classes that grafts return extend a constructor function which they do not know. Their instances have the fields that the constructor stores, in its order, and those of the classes after them.
// COUNTER in every build: DynamicSubclassInstances >= 4
"use strict";
function Ribbon(words, options) { this.mark = 0; this.span = null; this.till = 0; this.from = 0; this.tint = "bare"; this.words = words; if (options) this.options = options; }
Ribbon.prototype.step = function () { this.from = this.mark; while (this.mark < this.words.length && this.words.charCodeAt(this.mark) !== 32) ++this.mark; this.till = this.mark; this.mark++; this.tint = "name"; this.span = this.till - this.from; return this.span; };
Ribbon.prototype.all = function () { let sum = 0; while (this.mark < this.words.length) sum += this.step(); return sum; };
Ribbon.prototype.finish = function () { return this.kind(); };
Ribbon.prototype.kind = function () { return "ribbon"; };
Object.defineProperty(Ribbon.prototype, "rest", { get() { return this.words.length - this.mark; }, set(value) { this.mark = this.words.length - value; }, configurable: true });
Ribbon.grown = function (...grafts) { let made = this; for (const graft of grafts) made = graft(made); return made; };
const state = Symbol("state");
const grafts = {
  symbol: P => class extends P { constructor(words) { super(words); this[state] = { strict: false }; } kind() { return "symbol " + super.kind(); } },
  named: P => class Named extends P { constructor(words, options) { super(words, options); this.extra = [1]; this.tint = "from"; } kind() { return "named " + super.kind(); } },
  fields: P => class Fields extends P { mark = 1; own = "own"; #hidden = 3; get hidden() { return this.#hidden; } static has(object) { return #hidden in object; } },
  plain: P => class extends P { },
  many: P => class Many extends P { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8; },
  renamed: P => class extends P { get tint() { return "fixed"; } set tint(value) { this.kept = value; } },
  strange: P => class extends P { constructor(words) { super(words); delete this.from; this.from = 9; Object.freeze(this); } step() { return 1; } all() { return this.words.length; } },
  other: P => class extends P { constructor(words) { super(words); Object.setPrototypeOf(this, { all() { return -1; }, finish() { return "other"; } }); } },
};
function show(object) {
  const names = Reflect.ownKeys(object).map(name => { const own = Object.getOwnPropertyDescriptor(object, name); return String(name) + (own.writable ? "w" : "") + (own.enumerable ? "e" : "") + "=" + JSON.stringify(object[name]); });
  return names.join() + (object instanceof Ribbon ? " P" : "") + (Object.isFrozen(object) ? " frozen" : "") + " " + Object.keys(object).length + " " + JSON.stringify(object);
}
const find = name => Reflect.get(grafts, name);
const words = "alpha beta gamma";
for (const list of [["symbol"], ["named"], ["fields"], ["plain"], ["many"], ["renamed"], ["strange"], ["other"], ["symbol", "named"], ["plain", "fields", "symbol"], ["many", "named"]]) {
  const Made = Ribbon.grown(...list.map(name => find(name)));
  for (let round = 0; round < 3; round++) {
    const made = round === 2 ? Reflect.construct(Ribbon, [words, { round }], Made) : new Made(words, round ? { round } : undefined);
    let answer;
    try { answer = [made.all(), made.finish(), made.rest, made.hidden].join(); } catch (error) { answer = error.name; }
    console.log(list.join("+"), round, answer, show(made), Made.has ? Made.has(made) : "", Object.getPrototypeOf(made) === Made.prototype);
  }
}
class Stranger { }
console.log(show(Reflect.construct(Ribbon, [words], Stranger)), show(Reflect.construct(Ribbon, [words], class extends Stranger { })), show(new Ribbon(words)));
const Late = grafts.plain(Ribbon);
Late.prototype.kind = () => "late";
const before = new Late(words);
Late.prototype.all = function () { return this.mark - 1; };
Ribbon.prototype.kind = function () { return "replaced"; };
console.log(before.finish(), before.all(), new Late(words).finish(), new Ribbon(words).finish(), new (grafts.symbol(Ribbon))(words).finish());
