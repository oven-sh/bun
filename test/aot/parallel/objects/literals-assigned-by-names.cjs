// Object.assign of literals: the values in order, then the stores in order, on what the target is.
const out = [];
const note = (name, value) => { out.push("eval " + name); return value; };
const attempt = (name, f) => { try { const v = f(); out.push(name + " " + (typeof v === "object" && v ? JSON.stringify(v) : String(v))); } catch (error) { out.push(name + " " + error.constructor.name + " " + error.message.slice(0, 40)); } };
class Options {
    constructor(i) {
        Object.assign(this, { a: 1, b: i, c: [i] });
    }
    set watched(v) { out.push("set " + v); this.held = v; }
    get watched() { return this.held; }
}
attempt("this", () => new Options(2));
attempt("keys", () => Object.keys(new Options(3)).join());
attempt("setter", () => Object.assign(new Options(1), { watched: note("w", 5), b: note("b", 6) }));
attempt("frozen", () => Object.assign(Object.freeze({ a: 1 }), { a: note("a", 2) }));
attempt("sealed", () => Object.assign(Object.seal({ a: 1 }), { a: 2, z: 3 }));
attempt("null", () => { const t = null; return Object.assign(t, { a: note("n", 1) }); });
attempt("undefined", () => { let t; return Object.assign(t, { a: 1 }); });
attempt("number", () => { const t = 5; const r = Object.assign(t, { a: 1 }); return typeof r + r.a + (r + 1); });
attempt("text", () => { const t = "ab"; return Object.assign(t, { a: 1 }).a; });
attempt("text index", () => { const t = "ab"; return Object.assign(t, { 0: 1 }); });
attempt("function", () => { function f() {} return Object.assign(f, { a: 1, b: 2 }) === f && f.a + f.b; });
attempt("array", () => Object.assign([1, 2], { length: 1, extra: 2 }).length);
attempt("order", () => Object.assign(note("t", {}), { x: note("x", 1), y: note("y", 2) }, note("s", { z: 3 }), { x: note("x2", 4) }));
attempt("throws between", () => { const t = { set y(v) { throw new RangeError("y"); } }; try { Object.assign(t, { x: 1, y: 2, z: 3 }); } catch (e) { return Object.keys(t).join() + t.x + t.z + e.message; } });
attempt("value throws", () => { const t = {}; try { Object.assign(t, { x: 1, y: (() => { throw new RangeError("v"); })() }); } catch (e) { return Object.keys(t).join() + e.message; } });
attempt("proxy", () => { const log = []; const t = new Proxy({}, { set(o, k, v) { log.push(k); o[k] = v; return true; }, defineProperty(o, k, d) { log.push("define " + k); return Reflect.defineProperty(o, k, d); } }); Object.assign(t, { p: 1, q: 2 }); return log.join(); });
attempt("refusing proxy", () => Object.assign(new Proxy({}, { set() { return false; } }), { p: 1 }));
attempt("names", () => { const t = {}; Object.assign(t, { f() { return 1; }, g: () => 2, h: function () {}, C: class {} }); return [t.f.name, t.g.name, t.h.name, t.C.name].join(); });
attempt("proto", () => { const t = {}; Object.assign(t, { __proto__: { inherited: 1 }, own: 2 }); return t.inherited + " " + Object.keys(t).join(); });
attempt("computed", () => { const k = "key"; return Object.assign({ a: 1 }, { [k]: 2, b: 3 }); });
attempt("getter", () => { let n = 0; const t = Object.create({}); return JSON.stringify(Object.assign(t, { get a() { return ++n; }, b: 1 })) + n; });
attempt("nested", () => Object.assign(Object.assign({}, { a: 1, c: 2 }), { b: 3, a: 4 }));
attempt("inherited setter", () => { const t = Object.create({ set v(x) { out.push("above " + x); } }); Object.assign(t, { v: 1, w: 2 }); return Object.keys(t).join(); });
attempt("read only above", () => { const t = Object.create(Object.freeze({ r: 1 })); return Object.assign(t, { r: 2 }); });
function fill(target, i) { return Object.assign(target, { i, twice: i * 2 }); }
let sum = 0;
for (let i = 0; i < 20; i++)
    sum += fill(i & 1 ? { a: i } : new Options(i), i).twice + fill([], i).i;
out.push(String(sum));
console.log(out.join("\n"));
