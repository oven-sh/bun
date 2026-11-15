// A constructor fills a field, and a method of a subclass assigns it again: reads expect it filled, whatever took it away.
// STATISTIC: FieldsRequiredByParents >= 4
"use strict";
const out = [];
const show = (f) => { try { const r = f(); return r && typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
function inherits(heir, parent) { heir.prototype = Object.create(parent.prototype); heir.prototype.constructor = heir; heir.__proto__ = parent; }
const Root = (function () { function Root() {} Root.prototype.has = function has(name) { return this.options && name in this.options; }; return Root; })();
const Tokens = (function (Parent) {
  inherits(Tokens, Parent);
  function Tokens(options, input) { let self = Parent.call(this) || this; self.state = { pos: 0, end: 0, type: "start", value: null, input }; self.isAhead = false; return self; }
  Tokens.prototype.finish = function finish(type, value) { this.state.end = this.state.pos; const before = this.state.type; this.state.type = type; this.state.value = value; this.update(before); return this.state.value; };
  Tokens.prototype.match = function match(type) { return this.state.type === type; };
  Tokens.prototype.eat = function eat(type) { if (this.match(type)) { this.next(); return true; } return false; };
  Tokens.prototype.next = function next() {
    while (this.state.pos < this.state.input.length && this.state.input.charCodeAt(this.state.pos) === 32) this.state.pos++;
    if (this.state.pos >= this.state.input.length) return this.finish("end", null);
    const start = this.state.pos;
    while (this.state.pos < this.state.input.length && this.state.input.charCodeAt(this.state.pos) !== 32) ++this.state.pos;
    return this.finish("word", this.state.input.slice(start, this.state.pos));
  };
  return Tokens;
})(Root);
const Nodes = (function (Parent) { inherits(Nodes, Parent); function Nodes() { return Parent.apply(this, arguments) || this; } Nodes.prototype.update = function update(before) { this.seen = (this.seen || "") + before[0]; }; return Nodes; })(Tokens);
const Statements = (function (Parent) {
  inherits(Statements, Parent);
  function Statements() { return Parent.apply(this, arguments) || this; }
  Statements.prototype.ahead = function ahead() { const old = this.state; this.state = Object.assign({}, old); this.isAhead = true; this.next(); this.isAhead = false; const seen = this.state; this.state = old; return seen; };
  Statements.prototype.all = function all() { const words = []; this.next(); while (!this.match("end")) { words.push(this.state.value + (this.ahead().value || "")); if (!this.eat("word")) break; } return words.join(); };
  return Statements;
})(Nodes);
const Parser = (function (Parent) { inherits(Parser, Parent); function Parser(options, input) { let self = Parent.call(this, options, input) || this; self.options = options; self.input = input; return self; } Parser.prototype.parse = function parse() { return this.all() + "|" + this.seen + "|" + this.has("a") + this.has("b"); }; return Parser; })(Statements);
for (let round = 0; round < 3; round++) out.push(new Parser({ a: round }, " one two  three four " + "five ".repeat(round)).parse());
// What happens to the object or to what stands above it.
class Base { constructor(n) { this.held = { n }; this.count = n; } read() { let sum = 0; for (let i = 0; i < 3; i++) { sum += this.held.n + this.count; this.held.n += 1; } return sum; } once() { return this.held.n + this.count; } }
class Middle extends Base { swap(held) { const old = this.held; this.held = held; return old; } bump() { this.count++; return this.count; } }
class Leaf extends Middle { constructor(n) { super(n); this.own = n; } both() { return this.once() + this.own + this.swap({ n: 50 }).n + this.once(); } }
const fates = {
  nothing() {}, deleted(o) { delete o.held; }, deletedCount(o) { delete o.count; }, frozen(o) { Object.freeze(o); Object.freeze(o.held); }, sealed(o) { Object.seal(o); },
  accessor(o) { Object.defineProperty(o, "held", { get() { return { n: 7 }; }, set(v) { out.push("set " + JSON.stringify(v)); }, configurable: true }); },
  locked(o) { Object.defineProperty(o, "count", { writable: false }); }, undefinedHeld(o) { o.held = undefined; }, text(o) { o.count = "t"; o.held = "text"; },
  below(o) { Object.setPrototypeOf(o, Base.prototype); }, gone(o) { const read = o.read, once = o.once; Object.setPrototypeOf(o, null); o.read = read; o.once = once; },
};
for (const [name, fate] of Object.entries(fates)) {
  for (const make of [() => new Base(1), () => new Middle(2), () => new Leaf(3), () => Reflect.construct(Base, [4], Leaf), () => Object.create(Leaf.prototype)]) {
    const o = make();
    out.push([name, show(() => o.read()), show(() => o.once()), show(() => o.bump()), show(() => o.swap({ n: 9 })), show(() => o.both())].join());
    fate(o);
    out.push([show(() => o.read()), show(() => o.once()), show(() => o.bump()), show(() => o.swap({ n: 9 })), show(() => o.both()), Object.getOwnPropertyNames(o).join(":")].join());
  }
}
Middle.prototype.held = { n: 1000 };
{ const o = new Leaf(5); delete o.held; out.push(show(() => o.once()) + show(() => o.read()) + show(() => o.both())); }
delete Middle.prototype.held;
Object.defineProperty(Base.prototype, "count", { get() { return 500; }, set(v) { out.push("count " + v); }, configurable: true });
{ const o = new Leaf(6); out.push(show(() => o.once()) + show(() => o.bump()) + show(() => o.both())); delete o.count; out.push(show(() => o.once()) + show(() => o.read()) + show(() => o.bump())); }
for (const line of out) console.log(line);
