// A large table of one file holds instances of its classes; it is copied, merged, stored into, frozen, deleted from, and compared with.
"use strict";
const out = [];
const run = (work) => { try { return String(work()); } catch (error) { return error.constructor.name; } };
const first = (function () {
  var TokenType = function TokenType(label, conf) { if (conf === void 0) conf = {}; this.label = label; this.keyword = conf.keyword; this.binop = conf.binop || null; this.update = null; };
  function binop(name, prec) { return new TokenType(name, { binop: prec }); }
  var keywords = {};
  function kw(name, options) { if (options === void 0) options = {}; options.keyword = name; return keywords[name] = new TokenType(name, options); }
  var types = { num: new TokenType("num"), text: new TokenType("text"), name: new TokenType("name"), eof: new TokenType("eof"), comma: new TokenType(","), semi: new TokenType(";"), open: new TokenType("("), close: new TokenType(")"), plus: binop("+", 9), times: binop("*", 10), _if: kw("if"), _else: kw("else"), _while: kw("while") };
  types.open.update = types.close.update = function () { this.depth = (this.depth | 0) + 1; };
  var Parser = function Parser(text) { this.text = text; this.pos = 0; this.type = types.eof; this.value = null; this.start = this.end = 0; this.depth = 0; this.all = []; };
  Parser.prototype.finish = function (type, value) { this.end = this.pos; var before = this.type; this.type = type; this.value = value; if (type.update) type.update.call(this, before); };
  Parser.prototype.next = function () { while (this.text.charCodeAt(this.pos) === 32) this.pos++; this.start = this.pos; if (this.pos >= this.text.length) return this.finish(types.eof); var c = this.text[this.pos++]; switch (c) { case ",": return this.finish(types.comma); case ";": return this.finish(types.semi); case "(": return this.finish(types.open); case ")": return this.finish(types.close); case "+": return this.finish(types.plus, c); case "*": return this.finish(types.times, c); } while (/[a-z0-9]/.test(this.text[this.pos] || "")) this.pos++; var word = this.text.slice(this.start, this.pos); this.finish(keywords.hasOwnProperty(word) ? keywords[word] : /^[0-9]/.test(word) ? types.num : types.name, word); };
  Parser.prototype.kind = function () { var type = this.type; switch (type) { case types._if: return "if"; case types._else: return "else"; case types._while: return "while"; case types.num: return "num" + this.value; case types.plus: case types.times: return "op" + type.binop; } if (type === types.comma || type === types.semi || type === types.open || type === types.close) return "punctuation"; return type === types.name ? "name" : type === types.eof ? "eof" : "other"; };
  Parser.prototype.parse = function () { do { this.next(); this.all.push(this.kind()); } while (this.type !== types.eof && this.all.length < 60); return this.all.join(" ") + this.depth; };
  return { types: types, TokenType: TokenType, Parser: Parser, keywords: keywords };
})();
class Mark { constructor(n) { this.n = n; } }
class Other { constructor(n) { this.n = n; this.other = 1; } }
const marks = { a: new Mark(1), b: new Mark(2), c: new Mark(3), d: new Mark(4), e: new Mark(5), f: new Mark(6), g: new Mark(7), h: new Mark(8), i: new Other(9) };
const sum = (table) => { let n = 0; for (let k = 0; k < 10; k++) n += table.a.n + table.h.n + (table.i === marks.i ? 1 : 0) + (table.b === marks.b ? 10 : 0); return n; };
const which = (table, value) => value === table.a ? "a" : value === table.b ? "b" : value === table.c ? "c" : value === table.i ? "i" : value == table.d ? "d" : "none";
const text = "if (a + 12) b; else while (c * 7, d) e;";
for (let round = 0; round < 4; round++) out.push(new first.Parser(text).parse());
out.push(sum(marks), which(marks, marks.c), which(marks, null), which(marks, NaN), which(marks, undefined));
const values = [marks.a, marks.b, marks.i, new Mark(1), null, undefined, NaN, 0, -0, "a", "", 1n, Symbol.iterator, true, {}, [], () => 1, Object.freeze(new Mark(2)), new Proxy(marks.a, {}), Object.create(marks.b)];
for (const value of values) { out.push(which(marks, value)); const parser = new first.Parser(text); parser.next(); parser.type = value; out.push(run(() => parser.kind()), run(() => parser.parse())); }
for (const change of [(t) => Object.assign({}, t), (t) => Object.assign(t, { extra: new Mark(0) }), (t) => ({ ...t }), (t) => ({ ...t, a: 5, i: undefined }), (t) => { t.a = new Mark(11); }, (t) => { t.a = new Other(12); }, (t) => { t.b = null; }, (t) => { t.c = "text"; }, (t) => { t.d = NaN; }, (t) => { delete t.b; }, (t) => { t.b = marks.b; }, (t) => Object.defineProperty(t, "h", { get() { return { n: 100 }; }, configurable: true }), (t) => Object.defineProperty(t, "a", { value: 3, writable: false }), (t) => Object.freeze(t), (t) => Object.create(t), (t) => new Proxy(t, {}), (t) => Object.setPrototypeOf(t, { n: 1 }), (t) => JSON.parse(JSON.stringify(t)), (t) => { for (const name in t) t[name] = new Other(name.charCodeAt(0)); }, (t) => Object.fromEntries(Object.entries(t).reverse())]) {
  const copy = { a: new Mark(1), b: marks.b, c: new Mark(3), d: new Mark(4), e: new Mark(5), f: new Mark(6), g: new Mark(7), h: new Mark(8), i: marks.i };
  const changed = run(() => { const made = change(copy); const table = made && typeof made === "object" ? made : copy; return [run(() => sum(table)), ...values.map((value) => run(() => which(table, value))), Object.keys(table).join(), run(() => JSON.stringify(table))].join("|"); });
  out.push(changed, run(() => sum(copy)), run(() => which(copy, copy.a)));
}
// The parser's own table changes while it reads.
const { types, Parser, TokenType } = first;
const kept = types.comma;
for (const value of [new TokenType("new"), null, undefined, "comma", 5, {}, NaN, kept]) { types.comma = value; out.push(run(() => new Parser("a, b").parse()), String(types.comma === value || value !== value)); }
types.comma = kept; delete types.num; out.push(run(() => new Parser(text).parse())); types.num = new TokenType("num2"); out.push(run(() => new Parser(text).parse()));
Object.freeze(types); out.push(run(() => { types.eof = 1; }), run(() => new Parser(text).parse()));
for (const line of out) console.log(line);
