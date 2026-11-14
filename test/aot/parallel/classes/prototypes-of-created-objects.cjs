// STATISTIC: ClosedPrototypeObjects >= 10
// `const proto = { step() { .. } }; function make() { const made = Object.create(proto); made.x = 1; return made; }`: a class whose prototype is the literal.
const out = [];
const tell = (label, f) => { let v; try { v = f(); } catch (e) { v = e.constructor.name + ": " + e.message; } out.push(label + " " + (typeof v === "string" ? v : JSON.stringify(v))); };
tell("before", () => early(1));
tell("before assign", () => earlyAssign(1));
tell("before const", () => makeConst(1));
var earlyProto = { sum() { return this.a; } };
function early(a) { const made = Object.create(earlyProto); made.a = a; return made; }
function earlyAssign(a) { return Object.assign(Object.create(earlyProto), { a }); }
const constProto = { sum() { return this.a + 1; } };
function makeConst(a) { const made = Object.create(constProto); made.a = a; return made; }
tell("behind", () => [early(1).sum(), earlyAssign(2).sum(), makeConst(3).sum()]);

const proto = { sum: function () { return this.a + this.b; }, step: function (k) { this.a = (this.a + k) & 1023; if (this.next) this.b = this.next.b; return this; }, kind: "shared", get twice() { return this.a * 2; }, set both(v) { this.a = v; this.b = v; } };
function make(a, b) { const made = Object.create(proto); made.a = a; made.b = b; made.next = null; return made; }
function makeAssigned(a, b) { return Object.assign(Object.create(proto), { a: a, b: b, next: null }); }
function hot(make, n) { const list = []; let total = 0; for (let i = 0; i < 8; i++) { const c = make(i, i + 1); c.next = i ? list[i - 1] : null; list.push(c); } for (let k = 0; k < n; k++) { const c = list[k & 7]; total = (total + c.step(k).sum()) | 0; } return total; }
tell("hot", () => [hot(make, 3000), hot(makeAssigned, 3000)]);
tell("names", () => { const c = make(1, 2); const listed = []; for (const k in c) listed.push(k); return [Object.keys(c), listed, JSON.stringify(c), c.kind, c.twice, "sum" in c, Object.hasOwn(c, "sum")]; });
tell("above", () => { const c = make(1, 2); return [Object.getPrototypeOf(c) === proto, proto.isPrototypeOf(c), c.__proto__ === proto, c.constructor === Object, Object.getPrototypeOf(proto) === Object.prototype, Object.keys(proto), proto.constructor === Object, Object.hasOwn(proto, "constructor")]; });
tell("shown", () => [String(make(1, 2)), Object.prototype.toString.call(make(1, 2)), make(1, 2) instanceof Object]);
tell("setter", () => { const c = make(1, 2); c.both = 9; return [c.a, c.b, Object.keys(c)]; });
tell("shadowed", () => { const c = make(1, 2); c.sum = () => 5; c.kind = "own"; return [c.sum(), c.kind, make(3, 4).kind, make(3, 4).sum()]; });
tell("called", () => [proto.sum.call({ a: 5, b: 6 }), String(proto.sum()), Reflect.apply(proto.sum, make(7, 8), [])]);
tell("missing", () => make(1, 2).absent());

// Each of these has a prototype of its own, which something changes.
const replaced = { sum() { return this.a; } };
function makeReplaced(a) { const made = Object.create(replaced); made.a = a; return made; }
tell("replaced", () => { const c = makeReplaced(4); const before = c.sum(); replaced.sum = function () { return this.a * 10; }; const middle = c.sum(); delete replaced.sum; return [before, middle, typeof c.sum]; });
const guarded = { sum() { return this.a; } };
function makeGuarded(a) { const made = Object.create(guarded); made.a = a; return made; }
tell("setter above", () => { const before = makeGuarded(1).a; Object.defineProperty(guarded, "a", { get() { return 77; }, set(v) { this.seen = v; }, configurable: true }); const c = makeGuarded(2); return [before, c.a, c.seen, Object.keys(c)]; });
const locked = { sum() { return this.a; }, a: 1 };
function makeLocked(a) { const made = Object.create(locked); made.a = a; return made; }
tell("locked", () => { const before = makeLocked(5).sum(); Object.freeze(locked); return [before, makeLocked(6).sum(), Object.keys(makeLocked(6))]; });
const moved = { sum() { return this.a; } };
function makeMoved(a) { const made = Object.create(moved); made.a = a; return made; }
tell("moved", () => { const c = makeMoved(1); const before = c.sum(); Object.setPrototypeOf(moved, { above: 3, set late(v) { this.a = v; } }); c.late = 9; const middle = [c.above, c.a]; Object.setPrototypeOf(c, { sum() { return -1; } }); return [before, middle, c.sum(), makeMoved(2).above, makeMoved(2).sum()]; });
const held = { sum() { return this.a; } };
function makeHeld(a) { const made = Object.create(held); made.a = a; return made; }
globalThis.heldElsewhere = held;
tell("held", () => { const c = makeHeld(1); heldElsewhere.sum = () => 42; heldElsewhere.extra = 1; return [c.sum(), c.extra, (0, eval)("heldElsewhere.sum = () => 43; 1"), c.sum()]; });
const proxied = { sum() { return this.a; } };
function makeProxied(a) { const made = Object.create(proxied); made.a = a; return made; }
tell("proxied", () => { const c = makeProxied(3); Object.setPrototypeOf(proxied, new Proxy({}, { get: (t, k) => k === "odd" ? 1 : undefined, has: () => true })); return [c.sum(), c.odd, "never" in c, makeProxied(4).odd]; });
// An object made below another one.
const base = { name() { return "base " + this.a; }, a: 0 };
const heir = Object.assign(Object.create(base), { name() { return "heir " + base.name.call(this); } });
function makeHeir(a) { const made = Object.create(heir); made.a = a; return made; }
tell("heirs", () => [Object.create(base).name(), heir.name(), makeHeir(5).name(), base.isPrototypeOf(makeHeir(1)), Object.keys(heir)]);
// Objects linked to others.
const Account = { init: function (balance) { this.balance = balance; return this; }, add: function (k) { this.balance = (this.balance + k) & 4095; return this; } };
tell("linked", () => { const list = []; for (let i = 0; i < 4; i++) list.push(Object.create(Account).init(i)); let total = 0; for (let k = 0; k < 500; k++) total = (total + list[k & 3].add(k).balance) | 0; return [total, Object.create(Account).balance, Object.keys(list[0])]; });
// What throws says which functions were running.
const throwing = { set bad(v) { throw new Error("bad " + v); } };
function makeThrowing() { const made = Object.create(throwing); made.bad = 1; return made; }
tell("frames", () => { try { makeThrowing(); } catch (e) { return e.stack.split("\n").slice(0, 3).map((line) => line.trim().split(" ").slice(0, 2).join(" ").replace(/\/.*\//, "")); } });
tell("frames before", () => { try { later(); } catch (e) { return [e.name, e.stack.split("\n").filter((line) => line.includes("later")).length]; } });
function later() { return Object.create(laterProto); }
var laterProto = { run() { return 1; } };
tell("later", () => later().run());
let assigned = { run() { return 1; } };
function makeOfAssigned() { return Object.create(assigned); }
assigned = { run() { return 2; } };
tell("assigned", () => makeOfAssigned().run());
for (let i = 0; i < 2; i++) { const inLoop = { run() { return i; } }; const made = Object.create(inLoop); made.k = i; tell("loop " + i, () => [made.run(), made.k, Object.getPrototypeOf(made) === inLoop]); }
console.log(out.join("\n"));
