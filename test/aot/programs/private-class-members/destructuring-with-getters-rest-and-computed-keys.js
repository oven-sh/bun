// The order of evaluation in destructuring patterns with getters, rest elements and computed keys.
const log = [];
function note(s, v) { log.push(s); return v; }
function row(label, f) { log.length = 0; let r; try { r = String(f()); } catch (e) { r = "threw " + e.name; } console.log(label + ": " + r + " [" + log.join(" ") + "]"); }
const src = () => ({ get a() { return note("get a", 7); }, get b() { return note("get b", 8); } });
const key = (s) => ({ toString() { note(s + "-tostring"); return s; } });
row("rest", () => { const o = {}; ({ ...note("target", o).r } = new Proxy({ a: 1, b: 2 }, { ownKeys(t) { note("keys"); return Reflect.ownKeys(t); } })); return Object.keys(o.r).join(); });
row("rest behind a property", () => { const o = {}; ({ a: note("t1", o).x, ...note("t2", o).r } = src()); return o.x + " " + Object.keys(o.r).join(); });
row("computed keys on both sides", () => { const o = {}; ({ [note("source-key", key("a"))]: note("target", o)[note("target-key", key("k"))] } = src()); return o.k; });
row("a nested object pattern", () => { const o = {}; ({ a: { c: note("target", o).y } } = { get a() { note("get a"); return { get c() { return note("get c", 3); } }; } }); return o.y; });
row("a nested array pattern", () => { const o = {}; ({ a: [note("target", o).y] } = { get a() { note("get a"); return [4]; } }); return o.y; });
row("two properties", () => { const o = {}; ({ a: note("t1", o).x, b: note("t2", o).y } = src()); return o.x + " " + o.y; });
row("an identifier", () => { let x; ({ a: x } = src()); return x; });
row("shorthand with a default", () => { let a; ({ a = note("default", 1) } = { get a() { note("get a"); } }); return a; });
row("an identifier in its dead zone", () => { ({ a: late } = src()); let late; });
row("a setter", () => { const o = { set x(v) { note("set " + v); } }; ({ a: note("target", o).x } = src()); return "done"; });
row("the target throws", () => { ({ a: (() => { note("target"); throw new RangeError(); })().x } = src()); });
row("the getter throws", () => { const o = {}; ({ a: note("target", o).x } = { get a() { note("get a"); throw new RangeError(); } }); });
row("undefined as the target's object", () => { ({ a: note("target", undefined).x } = src()); });
row("the source is null", () => { const o = {}; ({ a: note("target", o).x } = null); });
class B { set x(v) { note("super set " + v); } }
class D extends B { m() { ({ a: super.x } = src()); return "done"; } n() { ({ a: super[note("super-key", "x")] } = src()); return "done"; } }
row("a super property", () => new D().m());
row("a computed super property", () => new D().n());
row("in a for-of head", () => { const o = {}; for ({ a: note("target", o).x } of [src(), src()]) note("body " + o.x); return o.x; });
row("in a loop", () => { const o = { x: 0 }; let t = 0; for (let i = 0; i < 3; i++) { ({ a: o.x } = { a: i }); t += o.x; } return t; });
row("the value of the expression", () => { const o = {}; const s = src(); return ({ a: o.x } = s) === s; });
