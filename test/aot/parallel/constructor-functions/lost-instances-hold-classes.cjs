// STATISTIC: LostInstanceFieldsExpected >= 4
// A constructor function that unknown code has: its fields hold a literal, arrays and instances, until other code stores something else there.
const out = [];
const show = (v) => typeof v === "function" ? "fn" : typeof v === "object" && v ? JSON.stringify(v) : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
var defaults = { version: null, kind: "script", locations: false, limit: 3, onStep: null };
var Kind = function Kind(name, override) { this.name = name; this.update = null; this.override = override; };
var kinds = { a: new Kind("a"), b: new Kind("b"), c: new Kind("c"), d: new Kind("d"), e: new Kind("e"), f: new Kind("f"), g: new Kind("g"), h: new Kind("h"), i: new Kind("i"), j: new Kind("j", function (p) { return p.position(); }) };
kinds.a.update = function (old) { for (var i = 0; i < 2; i++) { this.marks += old.name; } };
kinds.b.update = function (old) { if (old === kinds.a) { this.record.depth += 1; } else { this.marks = "b" + this.marks; } this.enter(this.stack); };
kinds.c.update = function (old) { this.marks += "c"; this.enter(null); };
kinds.d.update = function (old) { this.place = new Place(this.place.line, this.place.column + 1); this.position(); };
kinds.e.update = function () { this.marks += this.top(); this.enter(this.stack); };
kinds.f.update = function () { this.context.push("f"); this.enter(this.stack); };
kinds.g.update = function () { this.context.length = 1; this.enter(this.stack); };
kinds.h.update = function () { this.record = { depth: 5, name: "h" }; this.enter(this.stack); };
kinds.i.update = function () { this.marks += this.position(); this.enter(this.stack); };
var kindNames = Object.keys(kinds);
function readOptions(given) { var options = {}; for (var name in defaults) options[name] = given && name in given ? given[name] : defaults[name]; if (options.version == null) options.version = 11; return options; }
var Place = function Place(line, column) { this.line = line; this.column = column; };
Place.prototype.next = function () { return new Place(this.line + 1, 0); };
var Step = function Step(scanner) { this.kind = scanner.kind; this.pos = scanner.pos; if (scanner.options.locations) { this.place = new Place(scanner.place.line, 0); } };
var Scanner = function Scanner(given, text) {
    this.options = given = readOptions(given);
    this.input = String(text);
    this.pos = this.start = 0;
    this.stack = [];
    this.context = this.firstContext();
    this.place = new Place(1, 0);
    this.record = { depth: 0, name: given.kind };
    this.value = null;
    this.kind = kinds.a;
    this.marks = "";
};
var proto = Scanner.prototype;
proto.firstContext = function () { return ["first"]; };
proto.top = function () { return this.context[this.context.length - 1]; };
proto.position = function () { if (this.options.locations) return this.place.line + ":" + (this.pos - this.place.column); return this.pos; };
proto.step = function () {
    this.start = this.pos;
    var old = this.kind, update, kind = this.kind = kinds[kindNames[this.pos % 10]];
    if (update = kind.update) { update.call(this, old); }
    if (kind.override) { kind.override(this); }
    if (this.options.onStep) { this.options.onStep(new Step(this)); }
    if (this.options.locations && this.input.charCodeAt(this.pos) === 10) { this.place = this.place.next(); this.place.column = this.pos; }
    var code = this.input.charCodeAt(this.pos++);
    if (code === 40) { this.stack.push(this.pos); this.context.push("paren"); this.record.depth++; }
    else if (code === 41) { this.value = this.stack.pop(); this.context.pop(); this.record.depth--; }
    else { this.value = code; }
    return this.position();
};
proto.run = function () { var last; for (var turn = 0; turn < 40 && this.pos < this.input.length; turn++) { last = this.step(); } return [last, this.top(), this.value, this.stack.length, this.record.depth, this.record.name, this.options.version, this.options.limit, this.marks, this.kind.name]; };
proto.enter = function (list) { this.stack = list || []; return this.stack.length; };
Scanner.extend = function () { var made = this; for (var i = 0; i < arguments.length; i++) made = arguments[i](made); return made; };
Scanner.scan = function (text, given) { return new this(given, text).run(); };
// The class is kept in a table beside many others: nothing is proven of its objects.
var classes = {};
function define(name, made) { classes[name] = made; }
define("A", function A() { this.a = 1; });
define("B", function B() { this.b = 2; });
define("C", function C() { this.c = 3; });
define("D", function D() { this.d = 4; });
define("E", function E() { this.e = 5; });
define("F", function F() { this.f = 6; });
define("G", function G() { this.g = 7; });
define("H", function H() { this.h = 8; });
define("I", function I() { this.i = 9; });
define("Scanner", Scanner);
define("Place", Place);
function create(name, first, second) { return new classes[name](first, second); }
tell(() => create("Scanner", { locations: true }, "(k)").run());
tell(() => Object.keys(classes).map((name) => Object.keys(create(name, {}, "")).join()).join(";"));
const texts = ["a(b)c", "((x)\n(y))\n", "(", ")", ""];
const given = [undefined, { locations: true }, { locations: 1, kind: "module" }, { limit: { deep: 1 }, onStep: function (step) { out.push(step.pos + step.kind.name + Object.keys(this).length); } }, Object.create({ locations: true })];
for (const text of texts) for (const g of given) tell(() => Scanner.scan(text, g));
const others = [() => null, () => undefined, () => 7, () => "text", () => [1, "two"], () => ({ length: 2, locations: true, line: 5, column: 1, depth: 9 }), () => new Place(4, 2), () => Object.freeze([]), () => Object.freeze({ locations: true, depth: 1 }), () => new Proxy([1], {}), () => new Proxy({ locations: true }, {}), () => new Map(),
    () => new Uint8Array([1, 2, 3]), () => Object.create(new Place(8, 8)), () => new (class extends Array {})(), () => Object.defineProperty({}, "locations", { get() { out.push("asked"); return true; } }), () => function named() {}, () => [, 1], () => new Scanner({}, "other")];
for (const field of ["options", "stack", "context", "place", "record", "input", "pos", "value"]) {
    for (const other of others) {
        tell(() => { const s = new Scanner({ locations: true }, "(a\n)(b)"); s.step(); s[field] = other(); return [s.step(), s.step(), s.top(), s.position()]; });
        tell(() => { const s = new Scanner({}, "((("); s.step(); s[field] = other(); return s.run(); });
    }
    tell(() => { const s = new Scanner({}, "(a)"); delete s[field]; return s.run(); });
    tell(() => { const s = new Scanner({}, "(a)"); let n = 0; const old = s[field]; Object.defineProperty(s, field, { get() { n++; return old; }, set() { n += 100; } }); return [s.run(), n]; });
    tell(() => { const s = Object.freeze(new Scanner({ locations: true }, "(a)")); return s.run(); });
    tell(() => { const s = new Scanner({ locations: true }, "(a)"); Scanner.prototype[field] = "above"; delete s[field]; try { return s.step(); } finally { delete Scanner.prototype[field]; } });
}
tell(() => Scanner.extend((Base) => class extends Base { firstContext() { return new Set(["set"]); } position() { return "sub" + super.position(); } }, (Base) => class extends Base { enter() { return super.enter(new Uint8Array(4)); } }).scan("(a)", { locations: true }));
tell(() => { const S = Scanner.extend((Base) => class extends Base { constructor(g, t) { super(g, t); this.stack = "stack"; this.options = null; } }); return S.scan("a", {}); });
tell(() => { const s = new Scanner({}, "(("); return [s.enter(), s.enter([1, 2]), s.enter("text"), s.enter({ length: 3 })]; });
tell(() => Scanner.prototype.run.call({ options: { locations: true }, input: "ab", pos: 0, place: { line: 1, column: 0, next() { return this; } }, context: [1], stack: [], record: {}, position: Scanner.prototype.position, step: Scanner.prototype.step, top: Scanner.prototype.top }));
Scanner.prototype.firstContext = () => ({ length: 1, 0: "late", push() {}, pop() {} });
for (const text of texts) tell(() => Scanner.scan(text, { locations: true }));
let sum = 0; for (let i = 0; i < 300; i++) { const s = new Scanner({ locations: i & 1 }, "a(b)\n"); s.run(); sum += s.pos + s.stack.length + s.place.line; }
out.push(String(sum));
for (const line of out) console.log(line);
