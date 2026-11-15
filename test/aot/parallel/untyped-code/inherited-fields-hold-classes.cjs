// Methods of subclasses store values of unknown types into fields that the constructor of the base class fills with instances.
"use strict";
const out = [];
function inheritsLoose(heir, base) { heir.prototype = Object.create(base.prototype); heir.prototype.constructor = heir; heir.__proto__ = base; }
function Place(line, column) { this.line = line; this.column = column; }
class Mark { constructor(type, start) { this.type = type; this.start = start; this.end = -1; this.value = "mark"; } }
var State = function () {
  function State() {}
  var proto = State.prototype;
  proto.init = function (text) { this.input = text; this.start = this.end = 0; this.type = "none"; this.value = null; this.place = new Place(1, 0); this.list = []; };
  proto.copy = function () { var state = new State(); Object.keys(this).forEach((key) => { state[key] = this[key]; }); return state; };
  return State;
}();
var Reader = function () {
  function Reader(text) { var _this; _this = this; _this.state = new State(); _this.state.init(text); _this.marks = [new Mark("first", 0)]; _this.last = new Mark("none", 0); return _this; }
  var proto = Reader.prototype;
  proto.match = function (type) { return this.state.type === type; };
  proto.step = function (type, value) { this.state.start = this.state.end; this.state.end += 1; this.state.type = type; this.state.value = value; return this.state.place.line + this.state.list.length; };
  return Reader;
}();
var Middle = function (base) {
  inheritsLoose(Middle, base);
  function Middle() { return base.apply(this, arguments) || this; }
  Middle.prototype.look = function () { var old = this.state; this.state = old.copy(); this.step("look", 1); var seen = this.state; this.state = old; return seen.type + seen.end; };
  return Middle;
}(Reader);
var Parser = function (base) {
  inheritsLoose(Parser, base);
  function Parser(text) { var _this; _this = base.call(this, text) || this; _this.words = 0; return _this; }
  var proto = Parser.prototype;
  proto.restore = function (state) { this.state = state; };
  proto.keep = function (marks) { this.marks = marks; };
  proto.point = function (mark) { this.last = mark; };
  proto.read = function (turns) {
    var sum = "";
    for (var i = 0; i < turns; i++) { sum += this.state.type + "," + this.state.end + "," + this.last.type + this.marks.length + ";"; this.state.value = this.last.value; this.last.end = i; }
    return sum + this.state.value;
  };
  proto.once = function () { var t = this.state.type; this.state.type = "once"; this.state.value = this.state.start; return t + this.match("once") + this.last.end; };
  return Parser;
}(Middle);
class Base { constructor(n) { this.state = new State(); this.state.init("b" + n); this.last = new Mark("base", n); this.marks = []; } end() { return this.state.end + this.last.start; } }
class Heir extends Base { restore(state) { this.state = state; } keep(marks) { this.marks = marks; } point(mark) { this.last = mark; } read(turns) { let s = ""; for (let i = 0; i < turns; i++) { s += this.state.type + this.last.value + this.marks.length; this.state.end = this.last.start; } return s; } once() { this.state.type = this.last.type; return this.state.type + this.end(); } }
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const made = () => { const s = new State(); s.init("made"); return s; };
const states = [made, () => made().copy(), () => new Mark("as state", 5), () => ({ type: "literal", end: 3, start: 4, value: "v", match: 1 }), () => null, () => undefined, () => 7, () => "text", () => [1, 2], () => Object.freeze(made()), () => new Proxy(made(), {}), () => Object.create(made()),
  () => Object.defineProperty(made(), "type", { get() { out.push("getter"); return "accessor"; }, set(v) { out.push("setter " + v); }, configurable: true }), () => { const s = made(); delete s.end; return s; }, () => new (class Sub extends State { get extra() { return 1; } })(), () => new Place(1, 2), () => function type() {}, () => new Date(0)];
const marks = [() => new Mark("plain", 1), () => null, () => made(), () => ({ type: 1, length: "no", value: {} }), () => new Place(3, 4), () => "word", () => [new Mark("in array", 2)], () => new Map([[1, 2]]), () => undefined];
for (const create of [() => new Parser("text"), () => new Heir(1)]) {
  for (const state of states) {
    const p = create();
    out.push(show(() => p.read(2)), show(() => p.once()));
    if (p.look) out.push(show(() => p.look()));
    out.push(show(() => p.restore(state())), show(() => p.read(3)), show(() => p.once()), show(() => p.step && p.step("a", "b")), show(() => Object.keys(p).join()));
  }
  for (const mark of marks) {
    const p = create();
    p.point(mark()); p.keep(mark());
    out.push(show(() => p.read(2)), show(() => p.once()), show(() => p.end && p.end()));
  }
}
Object.defineProperty(Reader.prototype, "late", { get() { return this.state; }, configurable: true });
out.push(show(() => new Parser("late").late.type));
State.prototype.type = "above";
out.push(show(() => { const p = new Parser("above"); delete p.state.type; return p.read(1) + p.once(); }));
for (const line of out) console.log(line);
