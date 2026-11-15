// Plain functions, and functions stored under a name, that methods of one class call with their own `this`; and the same functions on every other receiver.
const out = [];
const show = (v) => typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v === "object" && v ? (v === globalThis ? "global" : JSON.stringify(v)) : typeof v === "function" ? "fn" : String(v);
const tell = (f) => { try { out.push(show(f())); } catch (e) { out.push(e.constructor.name); } };
class State { init(at) { this.pos = at; this.allowed = true; this.list = [at, at + 1]; return this; } here() { return this.pos * 2; } }
let reader = {};
{ class Reader { constructor(at) { this.state = new State(); this.state.init(at); this.options = { ranges: at > 2 }; this.count = 0; } next() { this.state.pos++; return this.state.pos; } match(v) { return this.state.pos === v; } get twice() { return this.count * 2; } } reader = Reader; }
let parser = {};
{ const Parent = reader; class Parser extends Parent { constructor(at) { super(at); this.input = "abcdef"; } step(v) { return this.next() + v; } } parser = Parser; parser.tag = 1; }
const K = parser;
{
  const P = K, pp = P.prototype;
  function finish(node, kind, at) { node.kind = kind; node.at = at; if (this.options.ranges) node.range = [at, 0]; this.count += 1; this.note(node); return node; }
  let other = function (node, a) { const f = () => this.state.here(); this.late = a; return f() + this.twice + this.step(a) + (this.match(a) ? 100 : 0); };
  pp.note = function (node) { this.state.allowed = false; node.text = this.input.slice(this.state.pos & 3); };
  pp.finish = function (node, kind) { return finish.call(this, node, kind, this.state.pos); };
  pp.finishAt = function (node, kind, at) { return finish.apply(this, [node, kind, at]); };
  pp.other = function (node, a) { return other.call(this, node, a); };
  pp.swap = function () { other = function (node, a) { return this === undefined ? "none" : a; }; };
  globalThis.finishOf = finish; globalThis.otherOf = (r, ...l) => other.apply(r, l);
}
class Kind { constructor(label) { this.label = label; this.update = null; } }
const kinds = { a: new Kind("a"), b: new Kind("b"), c: new Kind("c"), d: new Kind("d") };
kinds.a.update = function (previous) { this.state.allowed = false; if (previous === kinds.b) this.state.list.push(this.state.pos); return this.count; };
kinds.b.update = kinds.d.update = function () { const last = this.state.list.pop(); this.state.allowed = last === 1; return last; };
K.prototype.updateKind = function (kind, previous) { let update; if (kind.label === previous) return "same"; else if (update = kind.update) return update.call(this, previous); else return this.state.allowed; };
const work = (p, m) => { let t = 0; for (let i = 0; i < m; i++) { const node = { n: i }; const v = i % 3 === 0 ? p.finish(node, "k" + (i & 1)) : i % 3 === 1 ? p.finishAt(node, "at", i) : p.other(node, i); const u = p.updateKind(kinds["abcd"[i & 3]], kinds["bcad"[i & 3]]); t = (t * 31 + (typeof v === "number" ? v : v ? Object.keys(v).length : 2) + (typeof u === "number" ? u : u ? 3 : 1)) | 0; } return t; };
const p = new K(1);
tell(() => work(p, 1)); tell(() => work(p, 9)); tell(() => work(new K(3), 60)); tell(() => p.state); tell(() => p.finish({ n: 1 }, "x"));
tell(() => { let s = 0; for (let i = 0; i < 200; i++) s = (s + work(new K(i & 7), 6)) | 0; return s; });
const receivers = [undefined, null, 5, "s", true, 3n, { state: { pos: 1, list: [], here() { return 2; } }, options: {}, count: 1, input: "zz", next() { return 4; }, step(v) { return v; }, match() { return false; }, note(n) { n.noted = 1; } }, Object.create(p), new Proxy(new K(2), {}), Object.freeze(new K(2)), K, K.prototype, new (class extends K { constructor() { super(4); this.extra = 1; } next() { return 1000; } note(n) { n.heir = 1; } })(), [], function () {}, Object.assign(new K(5), { state: "gone" }), Object.defineProperty(new K(6), "state", { get() { return new State().init(8); } }), Object.setPrototypeOf(new K(7), { next() { return 9; }, step() { return 3; }, match() { return true; }, note() { } }), (() => { const q = new K(2); delete q.state; return q; })(), (() => { const q = new K(2); q.next = () => 77; q.note = (n) => { n.own = 1; }; return q; })()];
for (const r of receivers) { tell(() => finishOf.call(r, { n: 1 }, "k", 2)); tell(() => otherOf(r, { n: 1 }, 2)); tell(() => kinds.a.update.call(r, kinds.b)); tell(() => kinds.b.update.call(r)); tell(() => K.prototype.updateKind.call(r, kinds.d, 0)); }
tell(() => finishOf({ n: 1 }, "k", 2)); tell(() => kinds.a.update(kinds.b)); tell(() => new finishOf({ n: 1 }, "k", 2) instanceof finishOf);
p.options = null; tell(() => work(p, 5)); p.options = { ranges: 1 }; p.state = { pos: "text", list: new Set(), here() { return 1; } }; tell(() => work(p, 6));
K.prototype.note = function (n) { n.replaced = this.count; }; tell(() => work(new K(2), 12));
kinds.a.update = function () { return this instanceof K ? 1 : 2; }; kinds.c.update = () => 9; tell(() => work(new K(2), 12));
new K(1).swap(); tell(() => work(new K(2), 12)); tell(() => otherOf(undefined, 1, 2));
for (const line of out) console.log(line);
