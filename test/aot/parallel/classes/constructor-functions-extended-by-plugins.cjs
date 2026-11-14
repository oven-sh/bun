// Classes that plugins return extend a constructor function which they do not know. Their instances have the fields that the constructor stores, in its order, and those of the classes after them.
// COUNTER in every build: DynamicSubclassInstances >= 4
"use strict";
function Parser(text, options) { this.text = text; this.pos = 0; this.type = "eof"; this.start = 0; this.end = 0; this.value = null; if (options) this.options = options; }
Parser.prototype.step = function () { this.start = this.pos; while (this.pos < this.text.length && this.text.charCodeAt(this.pos) !== 32) ++this.pos; this.end = this.pos; this.pos++; this.type = "name"; this.value = this.end - this.start; return this.value; };
Parser.prototype.all = function () { let sum = 0; while (this.pos < this.text.length) sum += this.step(); return sum; };
Parser.prototype.finish = function () { return this.kind(); };
Parser.prototype.kind = function () { return "parser"; };
Object.defineProperty(Parser.prototype, "rest", { get() { return this.text.length - this.pos; }, set(value) { this.pos = this.text.length - value; }, configurable: true });
Parser.extend = function (...plugins) { let made = this; for (const plugin of plugins) made = plugin(made); return made; };
const state = Symbol("state");
const plugins = {
  symbol: P => class extends P { constructor(text) { super(text); this[state] = { strict: false }; } kind() { return "symbol " + super.kind(); } },
  named: P => class Named extends P { constructor(text, options) { super(text, options); this.extra = [1]; this.type = "start"; } kind() { return "named " + super.kind(); } },
  fields: P => class Fields extends P { pos = 1; own = "own"; #hidden = 3; get hidden() { return this.#hidden; } static has(object) { return #hidden in object; } },
  plain: P => class extends P { },
  many: P => class Many extends P { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8; },
  renamed: P => class extends P { get type() { return "fixed"; } set type(value) { this.kept = value; } },
  strange: P => class extends P { constructor(text) { super(text); delete this.start; this.start = 9; Object.freeze(this); } step() { return 1; } all() { return this.text.length; } },
  other: P => class extends P { constructor(text) { super(text); Object.setPrototypeOf(this, { all() { return -1; }, finish() { return "other"; } }); } },
};
function show(object) {
  const names = Reflect.ownKeys(object).map(name => { const own = Object.getOwnPropertyDescriptor(object, name); return String(name) + (own.writable ? "w" : "") + (own.enumerable ? "e" : "") + "=" + JSON.stringify(object[name]); });
  return names.join() + (object instanceof Parser ? " P" : "") + (Object.isFrozen(object) ? " frozen" : "") + " " + Object.keys(object).length + " " + JSON.stringify(object);
}
const text = "alpha beta gamma";
for (const list of [["symbol"], ["named"], ["fields"], ["plain"], ["many"], ["renamed"], ["strange"], ["other"], ["symbol", "named"], ["plain", "fields", "symbol"], ["many", "named"]]) {
  const Made = Parser.extend(...list.map(name => plugins[name]));
  for (let round = 0; round < 3; round++) {
    const made = round === 2 ? Reflect.construct(Parser, [text, { round }], Made) : new Made(text, round ? { round } : undefined);
    let answer;
    try { answer = [made.all(), made.finish(), made.rest, made.hidden].join(); } catch (error) { answer = error.name; }
    console.log(list.join("+"), round, answer, show(made), Made.has ? Made.has(made) : "", Object.getPrototypeOf(made) === Made.prototype);
  }
}
class Stranger { }
console.log(show(Reflect.construct(Parser, [text], Stranger)), show(Reflect.construct(Parser, [text], class extends Stranger { })), show(new Parser(text)));
const Late = plugins.plain(Parser);
Late.prototype.kind = () => "late";
const before = new Late(text);
Late.prototype.all = function () { return this.pos - 1; };
Parser.prototype.kind = function () { return "replaced"; };
console.log(before.finish(), before.all(), new Late(text).finish(), new Parser(text).finish(), new (plugins.symbol(Parser))(text).finish());
