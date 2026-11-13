// A bundle holds two copies of one library. Their methods bear the same names and are handed instances of their own constructor functions, and other values too.
"use strict";
const out = [];
const modules = {
  first(module) {
    function Node(parser, pos, place) { this.type = ""; this.start = pos; this.end = 0; if (parser.options.places) this.place = new Span(place); if (parser.options.ranges) this.range = [pos, 0]; }
    function Place(line, column) { this.line = line; this.column = column; }
    Place.prototype.offset = function (n) { return new Place(this.line, this.column + n); };
    function Span(start) { this.start = start; this.end = null; }
    function Token(parser) { this.type = parser.type; this.value = parser.value; this.start = parser.start; this.end = parser.end; }
    var Parser = function Parser(options, text) { this.options = options; this.text = text; this.pos = 0; this.start = this.end = 0; this.type = "start"; this.value = null; this.context = this.firstContext(); this.startPlace = this.endPlace = this.currentPlace(); this.words = makeWords("if else"); };
    function makeWords(list) { return new RegExp("^(?:" + list.replace(/ /g, "|") + ")$"); }
    var pp = Parser.prototype;
    pp.firstContext = function () { return ["top"]; };
    pp.currentPlace = function () { if (this.options.places) return new Place(1, this.pos); };
    pp.startNode = function () { return new Node(this, this.start, this.startPlace); };
    function finishAt(node, type, pos, place) { node.type = type; node.end = pos; if (this.options.places) node.place.end = place; if (this.options.ranges) node.range[1] = pos; return node; }
    pp.finishNode = function (node, type) { return finishAt.call(this, node, type, this.end, this.endPlace); };
    pp.finishNodeAt = function (node, type, pos, place) { return finishAt.call(this, node, type, pos, place); };
    pp.next = function () { if (this.options.onToken) this.options.onToken(new Token(this)); this.start = this.pos; this.pos += 2; this.end = this.pos; this.value = this.text.slice(this.start, this.end); this.type = this.words.test(this.value) ? "word" : "name"; this.startPlace = this.endPlace; this.endPlace = this.currentPlace(); if (this.type === "word") this.context.push(this.value); return this.context[this.context.length - 1]; };
    pp.parseWord = function () { var node = this.startNode(); node.value = this.value; this.next(); return this.finishNode(node, "Word"); };
    pp.parseName = function (node) { node.name = this.value; this.next(); return this.finishNode(node, "Name"); };
    pp.parseAny = function () { if (this.type === "word") return this.parseWord(); return this.parseName(this.startNode()); };
    pp.parseAll = function () { var node = this.startNode(), body = []; this.next(); while (this.start < this.text.length) body.push(this.parseAny()); node.body = body; return this.finishNodeAt(node, "All", this.pos, this.endPlace); };
    module.exports = { Parser: Parser, Node: Node, Place: Place, Token: Token, Span: Span };
  },
  second(module) {
    class Node { constructor(parser) { this.type = null; this.begin = parser.pos; } }
    var Parser = function Parser(options, text) { this.options = options; this.text = text; this.pos = 0; this.context = this.firstContext(); };
    var pp = Parser.prototype;
    pp.firstContext = function () { return new Map([["top", 1]]); };
    pp.currentPlace = function () { return this.pos; };
    pp.startNode = function () { return new Node(this); };
    pp.finishNode = function (node, type) { node.type = type + "2"; node.finish = this.pos; return node; };
    pp.parseAny = function () { var node = this.startNode(); this.pos++; return this.finishNode(node, this.text[this.pos]); };
    pp.parseAll = function () { var all = []; while (this.pos < this.text.length) all.push(this.parseAny()); return all; };
    module.exports = { Parser: Parser, Node: Node };
  },
  plugin(module, load) {
    var Base = load("first").Parser;
    class Plugin extends Base { finishNode(...args) { const node = super.finishNode(...args); if (node && node.type === "Name") node.seen = true; return node; } parseWord() { const node = super.parseWord(); node.plugin = node.value; return node; } }
    module.exports = { Parser: Plugin };
  },
};
const loaded = {};
const load = (name) => { if (!loaded[name]) { const module = { exports: {} }; loaded[name] = module; modules[name](module, load); } return loaded[name].exports; };
const show = (value) => { const seen = []; return JSON.stringify(value, (key, held) => { if (held && typeof held === "object") { if (seen.includes(held)) return "cycle"; seen.push(held); if (held instanceof Map) return [...held]; } return typeof held === "function" ? "fn" : held; }); };
const run = (work) => { try { return String(work()); } catch (error) { return error.constructor.name; } };
const tokens = [];
for (const name of ["first", "second", "plugin"]) for (const options of [{}, { places: true }, { ranges: true, places: true, onToken(token) { tokens.push(token.type + token.start + token.value); } }])
  for (const text of ["", "ifab", "xxelseyy"]) out.push(name + run(() => show(new (load(name).Parser)(options, text).parseAll())));
out.push(tokens.join());
const { Parser, Node, Place, Token, Span } = load("first");
const strange = [(p) => p.startNode(), () => ({}), () => ({ type: 1, place: { end: 5 }, range: [0, 0, 0] }), () => null, () => undefined, () => 5, () => "node", () => [1], () => Object.freeze(new Node({ options: {} }, 1)), (p) => Object.create(new Node(p, 2)), (p) => new Proxy(new Node(p, 3, null), {}),
  (p) => { const n = new Node(p, 4); delete n.type; delete n.end; return n; }, (p) => Object.defineProperty(new Node(p, 5), "end", { get() { return 9; }, set(v) { out.push("end " + v); }, configurable: true }), () => new (load("second").Node)({ pos: 1 }), (p) => new Token(p), () => new Place(1, 2), (p) => new (class Heir extends Node {})(p, 6), () => new Map(), () => function node() {}];
for (const options of [{}, { places: true, ranges: true }]) for (let k = 0; k < strange.length; k++) for (const Class of [Parser, load("plugin").Parser]) {
  const parser = new Class(options, "ifxyelse");
  out.push(k + run(() => show(parser.finishNode(strange[k](parser), "T"))), k + run(() => show(parser.parseName(strange[k](parser)))), k + run(() => show(parser.finishNodeAt(strange[k](parser), "A", 3, "p"))), run(() => parser.next()));
  for (const field of ["context", "startPlace", "endPlace", "words", "options"]) { const other = new Class(options, "ifxyelse"); other.next(); other[field] = strange[k](other); out.push(k + field + run(() => other.next()) + run(() => show(other.parseAny())) + run(() => show(other[field]))); }
}
Place.prototype.line = "above"; out.push(run(() => { const p = new Parser({ places: true }, "ab"); delete p.startPlace.line; return p.startPlace.line + show(p.parseAll()); }));
for (const line of out) console.log(line.slice(0, 300));
