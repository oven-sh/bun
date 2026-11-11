// A store that creates a property asks what stands above the object: a setter or a property that is read only on a prototype object, put there and taken away again, another prototype object, and what a callee does to the object half made.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
let log = "";
function attempt(run) { log = ""; try { return show(run()); } catch (e) { return (e instanceof TypeError ? "TypeError" : "other") + log; } }
function show(o) { let names = ""; for (const name in o) names += name + "=" + o[name] + " "; return names + Object.keys(o).join() + log; }
function Node(kind, pos, end) { this.kind = kind; this.pos = pos; this.end = end; this.parent = undefined; this.flags = 0; }
class Token { constructor(kind, text) { this.kind = kind; this.text = text; this.next = null; } }
class Keyword extends Token { constructor(text) { super(1, text); this.reserved = true; } }
function Branching(first, both) { if (first) this.a = 1; this.b = 2; if (both) this.a = 3; this.c = 4; }
function Backwards() { this.z = 1; this.y = 2; this.x = 3; }
function Twice(v) { this.a = v; this.b = v; this.a = v + 1; }
function ReadsItself(v) { this.a = v; this.b = this.a + 1; this.c = this.missing; this.d = "a" in this; this.e = "z" in this; }
function CallsOut(hook) { this.a = 1; hook(this); this.b = 2; this.c = 3; }
function Deletes() { this.a = 1; this.b = 2; delete this.a; this.a = 3; }
function Freezes(a) { this.a = a; Object.freeze(this); this.b = a; }
function ClosesFirst(a) { Object.preventExtensions(this); this.a = a; }
for (let i = 0; i < 40; i++) { new Node(i, i, i + 1); new Token(i, "t"); new Keyword("k"); new Branching(i & 1, i & 2); new Backwards(); new Twice(i); new ReadsItself(i); new CallsOut(() => { }); new Deletes(); }
report(attempt(() => new Node(1, 2, 3)));
report(attempt(() => new Token(1, "t")));
report(attempt(() => new Keyword("k")));
report(attempt(() => new Branching(false, false)));
report(attempt(() => new Branching(false, true)));
report(attempt(() => new Branching(true, false)));
report(attempt(() => new Branching(true, true)));
report(attempt(() => new Backwards()));
report(attempt(() => new Twice(1)));
report(attempt(() => new ReadsItself(1)));
report(attempt(() => new Deletes()));
report(attempt(() => new Freezes(1)));
report(attempt(() => new ClosesFirst(1)));
const hooks = [o => { o.extra = 9; }, o => { o.b = 9; }, o => { o.c = 9; }, o => { delete o.a; }, o => { Object.defineProperty(o, "b", { set(v) { log += " own b=" + v; }, configurable: true, enumerable: true }); }, o => { Object.defineProperty(o, "b", { value: 8, writable: false, enumerable: true }); }, o => { Object.setPrototypeOf(o, { set b(v) { log += " above b=" + v; } }); }, o => { Object.setPrototypeOf(o, null); }, o => { Object.preventExtensions(o); }, o => { Object.freeze(o); }];
for (let h = 0; h < hooks.length; h++) report(attempt(() => new CallsOut(hooks[h])));
const above = [{ set(v) { log += " set " + v; }, configurable: true }, { get() { return 77; }, configurable: true }, { value: 78, writable: false, configurable: true }, { value: 79, writable: true, configurable: true }];
const places = [[Node.prototype, "pos", () => new Node(1, 2, 3)], [Node.prototype, "flags", () => new Node(1, 2, 3)], [Token.prototype, "text", () => new Token(1, "t")], [Token.prototype, "text", () => new Keyword("k")], [Token.prototype, "reserved", () => new Keyword("k")], [Keyword.prototype, "kind", () => new Keyword("k")]];
for (let a = 0; a < above.length; a++) { for (let p = 0; p < places.length; p++) { Object.defineProperty(places[p][0], places[p][1], above[a]); report(attempt(places[p][2])); delete places[p][0][places[p][1]]; report(attempt(places[p][2])); } }
Object.setPrototypeOf(Node.prototype, { set end(v) { log += " end=" + v; } });
report(attempt(() => new Node(1, 2, 3)));
Object.setPrototypeOf(Node.prototype, Object.prototype);
report(attempt(() => new Node(1, 2, 3)));
const former = Node.prototype;
Node.prototype = { set kind(v) { log += " kind=" + v; } };
report(attempt(() => new Node(1, 2, 3)));
Node.prototype = 5;
report(attempt(() => new Node(1, 2, 3)));
Node.prototype = former;
report(attempt(() => new Node(1, 2, 3)));
report(attempt(() => new Node(1, 2, 3)));
report("end");
