// Comments of a package name types that nothing declares. Methods of a prototype that is written as a literal, and of other literals, are handed instances by their names, and other values too.
"use strict";
const out = [];
function Token(parser) { this.type = parser.type; this.value = parser.value; this.start = parser.start; this.end = parser.end; if (parser.ranges) this.range = [parser.start, parser.end]; }
function Parser(options) { this.options = options; this.type = "start"; this.value = null; this.start = this.end = 0; this.ranges = !!options.ranges; }
Parser.prototype.next = function () { this.start = this.end; this.end += 2; this.value = this.start % 3 ? "name" + this.start : "static"; this.type = this.start % 5 ? types.name : types.number; if (this.options.onToken) this.options.onToken(new Token(this)); return this.start < 60; };
const types = { name: { label: "name" }, number: { label: "number", keyword: "number" }, text: { label: "text" } };
function Translator(table) { this.table = table; this.kept = null; this.words = []; }
Translator.prototype = {
  constructor: Translator,
  /**
   * @param {ForeignToken} token The token to translate.
   * @param {Object} extra The state.
   * @returns {OtherToken} The translated token.
   */
  translate(token, extra) {
    const type = token.type, table = this.table;
    if (type === table.name) { token.type = "Identifier"; if (token.value === "static") token.type = "Keyword"; }
    else if (type === table.number) { token.type = "Numeric"; token.value = extra.text.slice(token.start, token.end); }
    else if (type.keyword) token.type = type.keyword;
    else token.type = String(type && type.label);
    return token;
  },
  /** @param {ForeignToken} token The token.
   *  @param {State} state */
  onToken(token, state) {
    const { tokens } = state;
    if (token.type === this.table.text) { this.kept = token; return; }
    if (this.kept) { tokens.push(this.translate(this.kept, state)); this.kept = null; }
    tokens.push(this.translate(token, state));
  },
};
const other = { onToken(token) { out.push("other " + token.type); }, translate(token) { return token + 1; } };
/** @param {Foo.Bar<Baz>} text @returns {import("nowhere").Thing} */
function parse(text, options) {
  /** @type {Translator} */
  const translator = new Translator(types);
  /** @type {Missing} */
  const state = { text, tokens: [], last: null };
  const parser = new Parser({ ranges: options.ranges, onToken(token) { translator.onToken(token, state); if (token.type !== types.text) state.last = token; } });
  while (parser.next());
  return { state, translator, parser };
}
const show = (value) => { const seen = []; return JSON.stringify(value, (key, held) => { if (held && typeof held === "object") { if (seen.includes(held)) return "cycle"; seen.push(held); if (held instanceof Map) return [...held]; } return typeof held === "function" ? "fn" : typeof held === "symbol" || typeof held === "bigint" ? String(held) : held; }); };
const run = (work) => { try { return String(work()); } catch (error) { return error.constructor.name + " " + error.message.slice(0, 40); } };
const text = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/";
for (let round = 0; round < 4; round++) for (const options of [{}, { ranges: true }]) { const { state, translator } = parse(text, options); out.push(show(state.tokens.slice(0, 6)) + state.tokens.length + show(state.last) + show(translator.words)); }
class Heir extends Token {}
const strange = [(p) => new Token(p), () => ({}), () => ({ type: types.name, value: "static" }), () => null, () => undefined, () => 5, () => "token", () => [types.name], (p) => Object.freeze(new Token(p)), (p) => Object.create(new Token(p)), (p) => new Proxy(new Token(p), {}),
  (p) => { const t = new Token(p); delete t.type; delete t.value; return t; }, (p) => Object.defineProperty(new Token(p), "type", { get() { out.push("get"); return types.number; }, set(v) { out.push("set " + v); }, configurable: true }), (p) => new Heir(p), (p) => { const t = new Token(p); t.extra = t.type; t.type = types.text; return t; },
  () => new Map([["type", 1]]), () => function token() {}, () => Symbol("token"), () => 10n, (p) => p, (p) => { const t = new Token(p); t.type = 7; return t; }, (p) => { const t = new Token(p); t.type = null; return t; }, (p) => Object.setPrototypeOf(new Token(p), { value: "above" }), (p) => { const t = new Token(p); Object.defineProperty(t, "value", { value: "static", writable: false }); return t; }];
for (let k = 0; k < strange.length; k++) for (const options of [{}, { ranges: true }]) {
  const { state, translator, parser } = parse(text, options);
  out.push(k + run(() => show(translator.translate(strange[k](parser), state))), k + run(() => show(translator.onToken(strange[k](parser), state))) + show(state.tokens.slice(-2)) + show(translator.kept));
  out.push(k + run(() => parser.options.onToken(strange[k](parser))) + show(state.last), k + run(() => other.onToken(strange[k](parser))), k + run(() => other.translate(strange[k](parser))));
  translator.kept = strange[k](parser); out.push(k + run(() => translator.onToken(new Token(parser), state)) + show(state.tokens.slice(-2)));
  for (const place of [null, undefined, 1, "x", {}, Object.freeze({ tokens: [], text })]) out.push(run(() => show(translator.translate(new Token(parser), place))) + run(() => translator.onToken(strange[k](parser), place)));
}
Translator.prototype.translate = function (token) { return "replaced " + typeof token; };
out.push(show(parse(text, {}).state.tokens.slice(0, 3)));
Object.defineProperty(Translator.prototype, "onToken", { get() { return (token, state) => state.tokens.push(token.start); }, configurable: true });
out.push(show(parse(text, {}).state.tokens.slice(0, 3)));
for (const line of out) console.log(line.slice(0, 300));
