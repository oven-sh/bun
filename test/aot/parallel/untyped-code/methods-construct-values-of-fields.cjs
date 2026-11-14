// this.end = this.position(): a small method constructs what its caller stores in a field, in functions that loops and recursion reach.
"use strict";
const out = [];
const run = (work) => { try { return String(work()); } catch (error) { return error.constructor.name; } };
const show = (value) => { const seen = []; return JSON.stringify(value, (key, held) => { if (held && typeof held === "object") { if (seen.includes(held)) return "cycle"; seen.push(held); } return typeof held === "function" ? "fn" : typeof held === "symbol" || typeof held === "bigint" ? String(held) : held; }); };
var Place = function Place(line, column) { this.line = line; this.column = column; };
Place.prototype.offset = function (n) { return new Place(this.line, this.column + n); };
class Span { constructor(start, end) { this.start = start; if (end !== undefined) this.end = end; } get size() { return this.end - this.start; } }
function Odd(kind) { this.kind = kind; if (kind === 3) return { other: kind }; if (kind === 4) return 4; if (kind === 5) throw new RangeError("five"); if (kind === 6) return new Place(6, 6); }
var Reader = function Reader(options, text) { this.options = options; this.text = text; this.at = 0; this.line = 1; this.lineStart = 0; this.type = "start"; this.value = null; this.begin = this.end = this.position(); this.span = null; this.odd = null; this.list = []; };
var rp = Reader.prototype;
rp.position = function () { if (this.options.places) return new Place(this.line, this.at - this.lineStart); };
rp.spanHere = function () { return new Span(this.at, this.at + 1); };
rp.oddHere = function () { return new Odd(this.at % 8); };
rp.finish = function (type, value) { this.last = this.at; if (this.options.places) this.end = this.position(); var before = this.type; this.type = type; this.value = value; this.update(before); };
rp.update = function (before) { if (before !== this.type) this.list.push(before); };
rp.space = function () { while (this.at < this.text.length) { var c = this.text.charCodeAt(this.at); if (c === 32) ++this.at; else if (c === 10) { ++this.at; ++this.line; this.lineStart = this.at; } else break; } };
rp.next = function () { this.space(); if (this.options.places) this.begin = this.position(); if (this.at >= this.text.length) return this.finish("end", null); if (this.options.spans) this.span = this.spanHere(); if (this.options.odd) this.odd = this.oddHere(); var from = this.at; while (this.at < this.text.length && this.text.charCodeAt(this.at) > 32) ++this.at; return this.finish("word", this.text.slice(from, this.at)); };
rp.parse = function (depth) { this.next(); if (this.type === "end") return []; var node = { value: this.value, begin: this.begin, end: this.end, span: this.span, odd: this.odd && this.odd.kind }; var rest = depth ? this.parse(depth - 1) : []; rest.push(node); return rest; };
const text = "ab cd\n efg  h\n\ni jk lmnop\nq ".repeat(6);
const each = (Class, options) => { const reader = new Class(options, text); let all = []; do { try { all = all.concat(reader.parse(3)); } catch (error) { all.push(error.message); reader.at++; } } while (reader.type !== "end" && all.length < 200); return show(all.slice(0, 5)) + all.length + show(reader.end) + show(reader.begin) + (reader.end instanceof Place) + reader.list.length; };
const options = [{}, { places: true }, { places: true, spans: true }, { places: 1, odd: true }, { places: "yes", spans: 1, odd: "x" }, { places: 0 }, { get places() { return this.n = !this.n; } }];
for (let round = 0; round < 4; round++) for (const chosen of options) out.push(run(() => each(Reader, chosen)));
class Heir extends Reader { position() { const place = super.position(); if (place) place.heir = true; return place; } }
class Other extends Reader { position() { return [this.at]; } spanHere() { return "span" + this.at; } }
for (const Class of [Heir, Other]) for (const chosen of options) out.push(run(() => each(Class, chosen)));
// The reader itself: frozen, sealed, fields with accessors, fields that are gone, numbers that are none, a proxy, another receiver.
for (const change of [(r) => Object.freeze(r), (r) => Object.seal(r), (r) => Object.defineProperty(r, "end", { get() { return 1; }, set(v) { out.push("set " + show(v)); }, configurable: true }), (r) => { delete r.end; delete r.begin; }, (r) => { r.at = "3"; }, (r) => { r.lineStart = 1.5; }, (r) => { r.lineStart = 2n; }, (r) => { r.line = {}; r.lineStart = { valueOf() { out.push("valueOf"); return 1; } }; }, (r) => { r.lineStart = NaN; }, (r) => { r.position = () => "own"; }, (r) => { r.options = null; }, (r) => new Proxy(r, { set(target, name, value) { if (name === "end") out.push("trap " + show(value)); target[name] = value; return true; } }), (r) => Object.create(r), (r) => Object.setPrototypeOf(r, null), (r) => { r.end = 5; r.begin = Symbol.iterator; }])
  for (const chosen of options.slice(0, 5)) { const reader = new Reader(chosen, text); reader.next(); const given = run(() => { const changed = change(reader); return changed && typeof changed === "object" ? (rp.next.call(changed), rp.finish.call(changed, "t", 1), show(changed.end)) : (reader.next(), reader.finish("t", 2), show(reader.end)); }); out.push(given, run(() => show(reader.begin)), run(() => typeof reader.end)); }
// The constructors: their prototypes change, the variable gets another value, a method is replaced.
Place.prototype.line2 = 1; out.push(run(() => each(Reader, { places: true })));
Object.defineProperty(Place.prototype, "column", { set(v) { out.length < 4000 && out.push("column " + v); }, get() { return "above"; }, configurable: true }); out.push(run(() => each(Reader, { places: true }).length)); delete Place.prototype.column;
const kept = Place.prototype; Place.prototype = { moved: true }; out.push(run(() => each(Reader, { places: true, spans: true }))); Place.prototype = kept;
const First = Place; Place = function Second(a) { this.a = a; }; out.push(run(() => each(Reader, { places: true }))); Place = null; out.push(run(() => each(Reader, { places: true }))); Place = class { constructor(...all) { this.all = all.length; } }; out.push(run(() => each(Reader, { places: true }))); Place = First;
Object.freeze(Place.prototype); out.push(run(() => each(Reader, { places: true })));
rp.position = function () { return this.at; }; out.push(run(() => each(Reader, { places: true })));
for (const line of out) console.log(line.slice(0, 400));
