// Positions of a constructor function whose instances unseen code holds: steps fill some, others are copied from them. Null and undefined in fields that the constructor fills with objects.
// STATISTIC: FieldTypesEnforced >= 12
"use strict";
const Kind = function Kind(label, conf) {
  if (conf === void 0) conf = {};
  this.label = label;
  this.keyword = conf.keyword;
  this.beforeExpr = !!conf.beforeExpr;
  this.startsExpr = !!conf.startsExpr;
  this.isLoop = !!conf.isLoop;
  this.binop = conf.binop || null;
  this.prefix = !!conf.prefix;
  this.postfix = !!conf.postfix;
  this.updateContext = null;
};
const kinds = { num: new Kind("num", { startsExpr: true }), name: new Kind("name", { startsExpr: true }), open: new Kind("(", { beforeExpr: true }), close: new Kind(")"), eof: new Kind("eof"), plus: new Kind("+", { binop: 9, beforeExpr: true }) };
kinds.close.updateContext = function (last) { this.allowed = last !== kinds.open; };
const Position = function Position(line, column) { this.line = line; this.column = column; };
const Token = function Token(p) { this.type = p.type; this.value = p.value; this.start = p.start; this.end = p.end; if (p.options.ranges) this.range = [p.start, p.end]; };
const defaults = { ranges: false, locations: true, onToken: null, version: 6 };
function getOptions(given) {
  const options = {};
  for (const name in defaults) options[name] = given && Object.hasOwn(given, name) ? given[name] : defaults[name];
  return options;
}
const Parser = function Parser(options, input, startPos) {
  this.options = options = getOptions(options);
  this.keywords = /^(?:let|if)$/;
  this.input = String(input);
  this.escaped = false;
  if (startPos) {
    this.pos = startPos;
    this.lineStart = this.input.lastIndexOf("\n", startPos - 1) + 1;
    this.curLine = this.input.slice(0, this.lineStart).split("\n").length;
  } else {
    this.pos = this.lineStart = 0;
    this.curLine = 1;
  }
  this.type = kinds.eof;
  this.value = null;
  this.start = this.end = this.pos;
  this.startLoc = this.endLoc = this.curPosition();
  this.lastEnd = this.lastStart = this.pos;
  this.context = [];
  this.allowed = true;
  this.arrowAt = -1;
  this.labels = [];
};
const pp = Parser.prototype;
pp.curPosition = function () { if (this.options.locations) return new Position(this.curLine, this.pos - this.lineStart); };
pp.skipSpace = function () {
  while (this.pos < this.input.length) {
    const ch = this.input.charCodeAt(this.pos);
    if (ch === 32) ++this.pos;
    else if (ch === 10) {
      ++this.pos;
      ++this.curLine;
      this.lineStart = this.pos;
    } else if (ch === 47 && this.input.charCodeAt(this.pos + 1) === 47) this.skipComment(2);
    else break;
  }
};
pp.skipComment = function (size) {
  let ch = this.input.charCodeAt((this.pos += size));
  while (this.pos < this.input.length && ch !== 10) ch = this.input.charCodeAt(++this.pos);
};
pp.finish = function (type, value) {
  this.end = this.pos;
  if (this.options.locations) this.endLoc = this.curPosition();
  const last = this.type;
  this.type = type;
  this.value = value;
  if (type.updateContext) type.updateContext.call(this, last);
  else this.allowed = type.beforeExpr;
};
pp.finishOp = function (type, size) {
  const text = this.input.slice(this.pos, this.pos + size);
  this.pos += size;
  return this.finish(type, text);
};
pp.word = function () {
  const from = this.pos;
  this.escaped = false;
  while (this.pos < this.input.length) {
    const ch = this.input.charCodeAt(this.pos);
    if (ch < 97 || ch > 122) break;
    this.pos += ch <= 0xffff ? 1 : 2;
  }
  const text = this.input.slice(from, this.pos);
  return this.finish(kinds.name, this.keywords.test(text) ? text + "!" : text);
};
pp.next = function () {
  if (this.options.onToken) this.options.onToken(new Token(this));
  this.lastEnd = this.end;
  this.lastStart = this.start;
  this.skipSpace();
  this.start = this.pos;
  if (this.options.locations) this.startLoc = this.curPosition();
  if (this.pos >= this.input.length) return this.finish(kinds.eof);
  const ch = this.input.charCodeAt(this.pos);
  if (ch === 40) return this.finishOp(kinds.open, 1);
  if (ch === 41) return this.finishOp(kinds.close, 1);
  if (ch === 43) return this.finishOp(kinds.plus, 1);
  if (ch >= 48 && ch <= 57) {
    this.arrowAt = this.start;
    while (this.pos < this.input.length && this.input.charCodeAt(this.pos) >= 48) ++this.pos;
    return this.finish(kinds.num, this.input.slice(this.start, this.pos));
  }
  if (ch >= 97 && ch <= 122) return this.word();
  return this.finishOp(kinds.eof, 1);
};
pp.gap = function () { return this.input.slice(this.lastEnd, this.start).length + (this.lastEnd - this.lastStart); };
const unseen = (0, eval)(Buffer.from("KHsgc3RvcmUobywgbiwgdikgeyBvW25dID0gdiB9LCByZW1vdmUobywgbikgeyBkZWxldGUgb1tuXSB9LCBkZWZpbmUobywgbiwgZCkgeyBPYmplY3QuZGVmaW5lUHJvcGVydHkobywgbiwgZCkgfSB9KQ==", "base64").toString());
globalThis.kept = { Parser, Token, kinds, unseen };
const extend = Base => class extends Base {
  next(...rest) { this.count = (this.count || 0) + 1; return super.next(...rest); }
  finish(type, value) { const result = super.finish(type, value); if (value === "let!") this.arrowAt = this.start; return result; }
};
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? (v.label ?? (Array.isArray(v) ? `[${v.length}]` : "{}")) : String(v));
const names = ["pos", "lineStart", "curLine", "start", "end", "lastEnd", "lastStart", "arrowAt"];
const state = p => names.map(n => show(p[n])).join(" ") + ` ${show(p.type)} ${show(p.value)} ${show(p.startLoc && p.startLoc.line)}:${show(p.startLoc && p.startLoc.column)} ${show(p.allowed)}`;
const run = (p, limit) => {
  let out = "";
  for (let i = 0; i < limit; i++) {
    p.next();
    out += `${show(p.type)}/${show(p.value)}@${show(p.start)}-${show(p.end)}~${show(p.gap())} `;
    if (p.type === kinds.eof) break;
  }
  return out;
};
const tell = (what, f) => {
  let said;
  try { said = f(); } catch (e) { said = e.constructor.name; }
  console.log(what, said);
};
const text = "let a + 12 // note\nif (b + 3) (c)\n\n  last 77";
for (let i = 0; i < 40; i++) run(new Parser({ onToken() {} }, text), 100);
tell("plain", () => { const p = new Parser(null, text); return run(p, 100) + state(p); });
tell("from", () => { const p = new Parser({ ranges: true }, text, 20); return run(p, 100) + state(p); });
tell("heir", () => { const p = new (extend(Parser))({ locations: false }, text); return run(p, 100) + state(p) + p.count; });
tell("tokens", () => {
  const tokens = [];
  const p = new Parser({ ranges: true, onToken: t => tokens.push(t) }, text);
  run(p, 100);
  for (const t of tokens) t.type = t.type.label;
  return JSON.stringify(tokens).length + tokens.map(t => t.type + t.start + (t.range ? t.range[1] : "")).join();
});
const values = [2, 0.5, -0, NaN, 2147483647, 2147483648, -2147483648, 2 ** 53, "3", "x", true, null, undefined, {}, []];
for (const name of names)
  for (const value of values)
    tell(`${name} ${show(value)}`, () => {
      const p = new Parser(null, text);
      const first = run(p, 3);
      unseen.store(p, name, value);
      const middle = state(p) + run(p, 4) + state(p);
      unseen.store(p, name, 7);
      return first + middle + run(p, 2) + state(p) + Object.keys(p).length;
    });
for (const name of ["options", "keywords", "input", "type", "context", "labels"])
  for (const value of [null, undefined, 1, "let x", { onToken: null, locations: true, test: () => true, length: 3 }, kinds.num])
    tell(`${name} ${show(value)}`, () => {
      const p = new Parser(null, text);
      const first = run(p, 2);
      unseen.store(p, name, value);
      let middle;
      try { middle = run(p, 3); } catch (e) { middle = e.constructor.name; }
      const kept = `${!!p.options} ${!!p.input} ${!p.type} ${p.labels ? "labels" : "none"} ${show(p[name])}`;
      p.options = defaults; p.keywords = /^if$/; p.input = text; p.type = kinds.eof;
      return first + middle + kept + run(p, 2) + state(p);
    });
tell("accessor", () => { const p = new Parser(null, text); run(p, 2); let at = p.pos; unseen.define(p, "pos", { get() { return at; }, set(v) { at = v; }, configurable: true }); return run(p, 3) + state(p) + at; });
tell("read-only", () => { const p = new Parser(null, text); run(p, 2); unseen.define(p, "end", { value: 5, writable: false }); return run(p, 3) + state(p); });
tell("frozen", () => { const p = new Parser(null, text); run(p, 2); Object.freeze(p); return run(p, 2) + state(p); });
tell("removed", () => { const p = new Parser(null, text); run(p, 2); unseen.remove(p, "start"); const out = state(p) + show(p.gap()); p.next(); return out + state(p) + Object.keys(p).length; });
tell("above", () => { const p = new Parser(null, text); unseen.remove(p, "lineStart"); pp.lineStart = 0.25; const out = run(p, 3) + state(p); delete pp.lineStart; return out; });
tell("assigned", () => { const p = new Parser(null, text); run(p, 4); const q = Object.assign(Object.create(pp), p); return run(q, 2) + state(q) + state(Object.assign(new Parser(null, "z"), p)); });
tell("wide", () => { const p = new Parser(null, text); unseen.store(p, "curLine", 2147483646); run(p, 100); for (let i = 0; i < 4; i++) ++p.curLine; return state(p) + (p.curLine > 2147483647); });
