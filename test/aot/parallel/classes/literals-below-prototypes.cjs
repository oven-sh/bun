// STATISTIC: ClosedPrototypeObjects >= 10
// `{ __proto__: proto, x: 1 }` and Object.setPrototypeOf({ x: 1 }, proto), where the literal that proto holds is nobody else's.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name + ": " + e.message; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
tell("before", () => [Object.keys(early(1)), early(1).sum, earlySet.name]);
tell("before set", () => earlySet(1));
tell("before const", () => makeConst(1));
var earlyProto = { sum() { return this.a; } };
function early(a) { return { __proto__: earlyProto, a }; }
var setProto = { sum() { return this.a; } };
function earlySet(a) { return Object.setPrototypeOf({ a }, setProto); }
const constProto = { sum() { return this.a + 1; } };
function makeConst(a) { return { __proto__: constProto, a }; }
tell("behind", () => [early(1).sum(), earlySet(2).sum(), makeConst(3).sum()]);
const proto = { sum: function () { return this.a + this.b; }, step: function (k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; }, kind: "shared", get twice() { return this.a * 2; }, set both(v) { this.a = v; this.b = v; } };
function make(a, b) { return { __proto__: proto, a: a, b: b, next: null }; }
function makeSet(a, b) { return Object.setPrototypeOf({ a: a, b: b, next: null }, proto); }
function hot(make, n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const c = make(i, i + 1); c.next = i ? list[i - 1] : null; list.push(c); } for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; } return total; }
tell("hot", () => [hot(make, 3000), hot(makeSet, 3000)]);
tell("names", () => { const c = make(1, 2); const listed = []; for (const k in c) listed.push(k); return [Object.keys(c), listed, JSON.stringify(c), c.kind, c.twice, "sum" in c, Object.hasOwn(c, "sum"), Object.getOwnPropertyDescriptor(c, "a")]; });
tell("above", () => { const c = make(1, 2), d = makeSet(3, 4); return [Object.getPrototypeOf(c) === proto, Object.getPrototypeOf(d) === proto, proto.isPrototypeOf(c), c.__proto__ === proto, c.constructor === Object]; });
tell("setter", () => { const c = make(1, 2); c.both = 9; return [c.a, c.b, Object.keys(c)]; });
// The literal defines what stands above as an accessor, or may not be written.
const guarded = { get a() { return "above"; }, set a(v) { throw new Error("never"); }, f() { return this.a; } };
function makeGuarded(a) { return { __proto__: guarded, a }; }
tell("guarded", () => [makeGuarded(1).f(), makeGuarded(2).a, Object.keys(makeGuarded(3)), guarded.f()]);
const locked = { a: 1, f() { return this.a; } };
function makeLocked(a) { return Object.setPrototypeOf({ a }, locked); }
tell("locked", () => { const before = makeLocked(5).f(); Object.freeze(locked); return [before, makeLocked(6).f(), makeLocked(7).a]; });
const late = { f() { return this.a; } };
function makeLate(a) { return { a, __proto__: late, b: a + 1 }; }
tell("late", () => { const before = makeLate(1).f(); Object.defineProperty(late, "b", { set() { throw new Error("never"); }, get() { return -1; }, configurable: true }); const c = makeLate(2); return [before, c.f(), c.b, Object.keys(c)]; });
tell("order", () => { const seen = []; const note = (n) => { seen.push(n); return n; }; const c = { a: note(1), __proto__: late, b: note(2), c: note(3) }; return [seen, Object.keys(c), c.f()]; });
tell("functions", () => { const c = { __proto__: late, g: function () { return 1; }, h: () => 2, a: 5 }; return [c.g(), c.h(), c.f(), c.g.name, c.h.name]; });
tell("moved", () => { const c = makeLate(3); Object.setPrototypeOf(c, { f() { return "moved"; } }); return [c.f(), makeLate(4).f()]; });
// An object below another one, which stands above others.
const base = { name() { return "base " + this.a; } };
const heir = { __proto__: base, own() { return "own"; }, a: 2 };
function makeHeir(a) { return { __proto__: heir, a }; }
tell("heirs", () => [heir.name(), makeHeir(3).name(), makeHeir(4).own(), base.isPrototypeOf(makeHeir(1)), Object.keys(heir)]);
let assigned = { run() { return 1; } };
function makeOfAssigned() { return { __proto__: assigned, k: 1 }; }
tell("assigned", () => { const before = makeOfAssigned().run(); assigned = { run() { return 2; } }; return [before, makeOfAssigned().run(), makeOfAssigned().k]; });
tell("null", () => { const c = { __proto__: null, a: 1 }; return [typeof c.toString, c.a]; });
tell("strings", () => { const c = { "__proto__": late, "a": 4 }; const d = { ["__proto__"]: late, a: 5 }; return [c.f(), Object.keys(c), Object.hasOwn(d, "__proto__"), typeof d.f]; });
tell("held", () => { globalThis.heldAbove = late; const c = makeLate(6); heldAbove.f = () => "held"; return [c.f(), (0, eval)("heldAbove.f = () => 'eval'; 1"), c.f()]; });

// The literal is held under two names.
function Box(a) { this.a = a; }
Box.fn = Box.prototype = { constructor: Box, get: function () { return this.a; }, set: function (v) { this.a = v; return this; } };
Box.fn.more = function () { return this.a + 1; };
tell("box", () => { const b = new Box(3); let total = 0; for (let k = 0; k < 300; k++) total += b.set(k).get(); return [total, b.more(), Box.fn === Box.prototype, b.constructor === Box]; });
tell("box changed", () => { Box.fn.get = function () { return -1; }; const b = new Box(1), changed = b.get(); Box.fn = { get() { return 7; } }; return [changed, b.get(), Box.prototype.get.call({}), new Box(2).get()]; });
function Twice(a) { this.a = a; }
const holder = { kept: null };
holder.kept = Twice.prototype = { sum: function () { return this.a * 2; } };
tell("twice", () => { const before = new Twice(2).sum(); holder.kept.sum = function () { return "kept"; }; return [before, new Twice(2).sum()]; });
// Somebody else has the literal, too.
function swap(o) { o.sum = function () { return "swapped " + this.a; }; return o; }
function Shown(a) { this.a = a; }
swap(Shown.prototype = { sum: function () { return this.a; } });
tell("shown", () => { const list = []; for (let k = 0; k < 3; k++) list.push(new Shown(k).sum()); return list; });
function Named(a) { this.a = a; }
const list = [Named.prototype = { sum: function () { return this.a; } }];
tell("listed", () => { const before = new Named(1).sum(); list[0].sum = () => "listed"; return [before, new Named(2).sum()]; });
console.log(out.join("\n"));
