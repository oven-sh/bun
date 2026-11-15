// A parser whose instance stood as a prototype once (toFastProperties) stores into its own fields. Nobody depends on those names of it, so the stores are cached like any other. Names that others read through it are reported as before.
// COUNTER: operationAOTPutById <= 300
// COUNTER: operationAOTPutByIdSloppy <= 300
"use strict";
function toFastProperties(o) { function Fake() {} Fake.prototype = o; const below = new Fake(); function look() { return typeof below.bar; } look(); look(); return o; }
const mixin = {
  start() { this.position = -1; this.tokens = []; this.length = 0; this.stack = []; this.depth = -1; this.rule = null; this.failures = []; this.note = "n"; },
  consume() { this.position += 1; }, look(n) { const at = this.position + n; return at < 0 || this.length <= at ? 0 : this.tokens[at]; },
  enter(name) { this.stack[++this.depth] = name; this.rule = name; }, leave() { this.depth--; this.rule = this.depth >= 0 ? this.stack[this.depth] : null; },
  reset(tokens) { this.position = -1; this.tokens = tokens; this.length = tokens.length; this.failures = []; this.depth = -1; },
};
class Parser { constructor() { this.start(); } define(name, rule) { this[name] = function () { this.enter(name); try { return rule.call(this); } finally { this.leave(); } }; } }
for (const name of Object.keys(mixin)) Parser.prototype[name] = mixin[name];
class Sums extends Parser { constructor() { super(); this.define("sum", function () { let v = this.term(); while (this.look(1) === 1) { this.consume(); v += this.term(); } return v; }); this.define("term", function () { const t = this.look(1); this.consume(); return t; }); toFastProperties(this); } }
const parser = new Sums(); let total = 0;
for (let turn = 0; turn < 400; turn++) { parser.reset([5, 1, 6, 1, turn & 7, 1, 9]); total = (total * 31 + parser.sum() + parser.failures.length) | 0; }
console.log(total, Object.keys(parser).join());

function readNote(o) { return o.note; } function callTerm(o) { return o.term(); } function has(o) { return "note" in o; }
const twin = new Sums(), below = [Object.create(parser), Object.create(twin), Object.setPrototypeOf({ own: 1 }, parser)];
function Maker() { this.made = 1; } Maker.prototype = parser; below.push(new Maker()); Maker.prototype.extra = "extra";
const said = [];
function say() { for (const o of below) said.push(String(readNote(o)), has(o), o.depth, o.extra, o instanceof Sums); try { said.push(below.map(callTerm).join("/")); } catch (error) { said.push(error.name); } }
for (let turn = 0; turn < 9; turn++) {
  say();
  if (turn === 0) { parser.note = "replaced"; twin.note = 5; }
  if (turn === 1) { parser.note = { toString() { return "object"; } }; parser.term = function () { return "new term"; }; }
  if (turn === 2) { parser.term = () => "arrow"; twin.term = undefined; }
  if (turn === 3) { Object.defineProperty(parser, "note", { get() { return "getter"; }, set(v) { said.push("set " + v); }, configurable: true, enumerable: true }); parser.note = 1; below[0].note = 2; twin.term = () => 3; }
  if (turn === 4) { delete parser.note; delete twin.depth; parser.note = "again"; }
  if (turn === 5) { Object.freeze(twin); try { twin.note = "refused"; } catch (error) { said.push(error.name); } try { below[1].note = "refused"; } catch (error) { said.push(error.name); } }
  if (turn === 6) { Object.setPrototypeOf(parser, { note: "far", term() { return "far"; } }); delete parser.term; delete parser.note; }
  if (turn === 7) { parser.note = "own"; parser.term = () => "own"; for (let i = 0; i < 50; i++) { parser.note = i; said.push(readNote(below[0]) === i); } }
}
console.log(said.join(" "));
