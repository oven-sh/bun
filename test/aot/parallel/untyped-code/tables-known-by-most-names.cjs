// A function reads many names off a table. One record of the file has most of them; others may arrive, and names that it lacks.
"use strict";
const out = [];
class Kind { constructor(label, word) { this.label = label; this.word = word; } }
const kinds = { num: new Kind("num"), name: new Kind("name"), semi: new Kind(";"), comma: new Kind(","), dot: new Kind("."), parenL: new Kind("("), parenR: new Kind(")"), braceL: new Kind("{"), braceR: new Kind("}"), colon: new Kind(":"), question: new Kind("?"), eof: new Kind("eof") };
const others = { alpha: 1, beta: 2, name: "other" };
class Translator {
  constructor(table) { this.table = table; this.seen = 0; }
  translate(token) {
    const type = token.type, tt = this.table;
    if (type === tt.name) token.text = "Identifier";
    else if (type === tt.semi || type === tt.comma || type === tt.dot || type === tt.parenL || type === tt.parenR || type === tt.braceL || type === tt.braceR || type === tt.colon || type === tt.question) token.text = "Punctuator";
    else if (type === tt.tagStart || type === tt.tagEnd) token.text = "Tag";
    else if (type === tt.num) { token.text = "Number"; this.seen++; }
    return token.text;
  }
  count(tokens) { let n = 0; for (const token of tokens) { const tt = this.table; if (token.type === tt.eof) n += 100; if (token.type === tt.name || token.type === tt.num || token.type === tt.semi || token.type === tt.comma || token.type === tt.dot || token.type === tt.colon || token.type === tt.question) n++; } return n; }
  change() { const tt = this.table; tt.name = tt.semi; tt.extra = tt.num; tt.semi = "text"; delete tt.comma; return [tt.name === tt.semi, tt.extra === tt.num, tt.comma, tt.dot && tt.dot.label, tt.parenL && tt.parenL.label, tt.parenR && 1, tt.braceL && 2, tt.braceR && 3].join(); }
}
const show = (work) => { try { return String(work()); } catch (error) { return error.constructor.name; } };
const tables = [() => kinds, () => Object.assign({}, kinds), () => ({ ...kinds }), () => Object.assign({}, kinds, { tagStart: kinds.eof, tagEnd: new Kind("end") }), () => Object.assign({ first: 1 }, kinds), () => others, () => ({}), () => null, () => undefined, () => 3, () => "name", () => Object.freeze(Object.assign({}, kinds)), () => Object.create(kinds), () => new Proxy(kinds, { get(target, name) { out.push("read " + String(name)); return target[name]; } }),
  () => { const t = Object.assign({}, kinds); delete t.semi; delete t.num; return t; }, () => Object.defineProperty(Object.assign({}, kinds), "dot", { get() { out.push("dot"); return kinds.comma; }, configurable: true }), () => { const t = Object.assign({}, kinds); Object.setPrototypeOf(t, { tagStart: kinds.eof }); return t; }, () => new Map(Object.entries(kinds)), () => Object.entries(kinds), () => new (class Table { constructor() { Object.assign(this, kinds); } })(), () => JSON.parse(JSON.stringify(kinds)), () => Object.fromEntries(Object.entries(kinds).reverse())];
for (const create of tables) {
  const all = [...Object.values(kinds), undefined, null, "name", 3];
  out.push(show(() => { const t = new Translator(create()); return all.map((type) => t.translate({ type, text: "-" })).join() + t.seen; }));
  out.push(show(() => { const t = new Translator(create()); return t.count(all.map((type) => ({ type }))); }));
  if (create() !== kinds && create() !== others) out.push(show(() => { const t = new Translator(create()); return t.change() + t.translate({ type: kinds.num, text: "-" }) + Object.keys(t.table).join(); }));
}
kinds.tagStart = kinds.eof; kinds.name = kinds.dot;
out.push(show(() => { const t = new Translator(kinds); return Object.values(kinds).map((type) => t.translate({ type, text: "-" })).join(); }));
for (const line of out) console.log(line);
