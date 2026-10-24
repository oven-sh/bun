function attempt(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}
const point = { x: 1, y: 2 };
const read = o => o.x + ":" + o.y + ":" + Object.keys(o).join();
attempt("as made", () => read(point));
attempt("assign", () => read(Object.assign(point, { x: "s", z: 3 })));
attempt("defineProperty", () => read(Object.defineProperty(point, "y", { get() { return "got"; }, enumerable: true, configurable: true })));
attempt("defineProperties", () => read(Object.defineProperties(point, { w: { value: 4, enumerable: true }, x: { value: null, writable: true, enumerable: true, configurable: true } })));
attempt("Reflect.set", () => (Reflect.set(point, "x", 5n), read(point)));
attempt("Reflect.defineProperty", () => (Reflect.defineProperty(point, "x", { value: Symbol.iterator.description }), read(point)));
attempt("Reflect.deleteProperty", () => (Reflect.deleteProperty(point, "x"), read(point)));
attempt("setPrototypeOf", () => (Object.setPrototypeOf(point, { x: "inherited" }), read(point)));
attempt("__proto__", () => ((point.__proto__ = { x: "by __proto__" }), read(point)));
attempt("__defineGetter__", () => (point.__defineGetter__("x", () => "old style"), read(point)));
attempt("computed", () => { const key = ["x"].join(""); delete point[key]; point[key] = [1]; return read(point); });
attempt("entries", () => read(Object.fromEntries(Object.entries(point).map(([k, v]) => [k, typeof v]))));
attempt("spread", () => read({ ...point, x: undefined }));
attempt("with a proxy", () => { const p = new Proxy(point, { set(t, k, v) { t[k] = v + "!"; return true; } }); p.x = "through"; return read(point); });
attempt("structuredClone", () => read(structuredClone({ x: new Date(0), y: /r/g })).length);
attempt("JSON", () => read(JSON.parse(JSON.stringify({ x: { toJSON() { return [2]; } }, y: undefined }))));
attempt("array methods", () => { const a = [point]; a.fill({ x: "filled", y: 0 }); return read(a[0]) + read(a.with(0, { x: "with", y: 1 })[0]) + read(a.toSpliced(0, 1, { x: "spliced", y: 2 })[0]) + read(a.copyWithin(0, 0)[0]); });
attempt("sort moves", () => { const a = [{ x: 2, y: "b" }, { x: 1, y: 7 }]; a.sort((p, q) => p.x - q.x); return read(a[0]) + read(a.reverse()[0]) + read(a.toSorted((p, q) => p.x - q.x)[0]); });
attempt("freeze then store", () => { const f = Object.freeze({ x: 1, y: 2 }); f.x = 9; return read(f); });
attempt("class fields redefined", () => { class C { x = 1; y = 2; } const c = new C(); Object.defineProperty(c, "x", { get: () => "getter", enumerable: true }); return read(c); });
attempt("instance gets another prototype", () => { class C { x = 1; get y() { return "from C"; } } class D { get y() { return "from D"; } } const c = new C(); Object.setPrototypeOf(c, D.prototype); return read(c) + (c instanceof C); });
attempt("prototype method replaced", () => { class C { m() { return 1; } } const c = new C(); const before = c.m(); C.prototype.m = () => "replaced"; return before + c.m(); });
attempt("arguments alias", () => (function (a) { "sloppy"; arguments[0] = "aliased"; return typeof a + arguments.length; })(1));
