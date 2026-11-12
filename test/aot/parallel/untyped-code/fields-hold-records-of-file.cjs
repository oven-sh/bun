// A constructor fills a field with a record that a function of the file makes, or with a literal. Other code stores anything else there.
"use strict";
const out = [];
const defaults = { version: 5, kind: "script", locations: false, ranges: false, onToken: null, onEnd: null, depth: 1 };
function readOptions(given) {
  var options = {};
  for (var name in defaults) options[name] = given && Object.hasOwn(given, name) ? given[name] : defaults[name];
  if (options.version === "latest") options.version = 100;
  else if (options.version >= 2015) options.version -= 2009;
  if (Array.isArray(options.onToken)) { var tokens = options.onToken; options.onToken = (token) => { tokens.push(token); }; }
  return options;
}
function createState(text) { return { text: text, line: 1, column: 0, marks: [] }; }
function createEither(wide) { return wide ? { a: 1, b: 2, c: 3 } : { c: 30, a: 10 }; }
var Reader = function Reader(options, text) {
  this.options = options = readOptions(options);
  this.text = String(text);
  this.pos = 0;
  this.state = createState(text);
  this.either = createEither(options.depth > 1);
  this.literal = { x: 1, y: options.version };
};
var methods = Reader.prototype;
methods.next = function () {
  if (this.options.onToken) this.options.onToken("t" + this.pos);
  this.pos++;
  return this.options.locations ? this.state.line + ":" + this.state.column : this.options.ranges;
};
methods.all = function () {
  var found = [];
  while (this.pos < this.text.length) {
    if (this.options.version >= 6 && this.text.charCodeAt(this.pos) === 10) { this.state.line++; this.state.column = 0; } else this.state.column += this.options.depth;
    found.push(this.next());
  }
  if (this.options.onEnd) this.options.onEnd(found.length, this);
  return found.join() + "|" + this.options.kind + this.options.version + this.literal.x + this.literal.y + this.either.a + this.either.b + this.either.c;
};
methods.once = function () { var depth = this.options.depth; this.options.depth = depth + 1; this.literal.x += depth; return [this.options.depth, this.literal.x, this.either.c, this.state.text, this.options.missing].join(); };
methods.set = function (name, value) { this[name] = value; return this; };
class Heir extends Reader { next() { return "h" + super.next(); } get extra() { return this.options.extra; } }
class Box { constructor(size) { this.config = { size, name: "box" }; this.other = createState(size); } area() { return this.config.size * this.config.size + this.config.name + this.other.line; } grow() { this.config.size++; return this; } }
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
const tokens = [];
const inputs = [undefined, null, {}, { locations: true }, { version: 2020, ranges: true }, { version: "latest", onToken: tokens, depth: 2 }, { onEnd(n, reader) { out.push("end " + n + reader.options.kind); }, kind: "module" }, 7, "text"];
for (const input of inputs) for (const Class of [Reader, Heir]) {
  out.push(show(() => new Class(input, "a\nbc").all()), show(() => { const r = new Class(input, "xy"); return r.once() + r.once() + r.all() + r.once(); }));
}
out.push(tokens.join());
const others = [() => defaults, () => ({ ...defaults, depth: 9 }), () => ({ version: 6, locations: 1, depth: 3 }), () => null, () => undefined, () => 5, () => "options", () => [1, 2], () => Object.freeze(readOptions()), () => new Proxy(readOptions({ locations: true }), { get(target, name) { out.push("read " + String(name)); return target[name]; } }),
  () => Object.create(readOptions({ ranges: true })), () => { const o = readOptions(); delete o.version; delete o.depth; return o; }, () => Object.defineProperty(readOptions(), "locations", { get() { out.push("locations"); return true; }, configurable: true }), () => Object.setPrototypeOf(readOptions({ kind: "k" }), { missing: "found above" }),
  () => Object.assign(readOptions(), { missing: "own", extra: "e" }), () => new Map([["version", 1]]), () => new Reader(), () => function depth() {}, () => createState("as options"), () => Object.preventExtensions(readOptions()), () => JSON.parse(JSON.stringify(readOptions({ locations: true })))];
for (const other of others) for (const name of ["options", "state", "either", "literal"]) {
  const reader = new Heir({ depth: 2 }, "abc");
  out.push(show(() => reader.once()), show(() => reader.set(name, other()).all()), show(() => reader.once()), show(() => reader.extra), show(() => reader.next()));
}
for (const other of others) { const box = new Box(3); out.push(show(() => box.grow().area()), show(() => { box.config = other(); return box.area(); }), show(() => box.grow().area()), show(() => { box.other = other(); return box.area(); })); }
out.push(show(() => { const r = new Reader({ locations: true }, "q\nr"); delete r.options; return r.all(); }), show(() => { const r = new Reader({}, "q"); Object.defineProperty(r, "options", { get() { return { locations: 1, version: 6, depth: 1, kind: "got" }; } }); return r.all(); }));
for (const line of out) console.log(line);
