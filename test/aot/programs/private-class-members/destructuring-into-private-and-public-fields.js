// The order of evaluation in destructuring assignments whose targets are private and public fields.
const log = [];
function note(s, v) { log.push(s); return v; }
function row(label, f) { log.length = 0; let r; try { r = String(f()); } catch (e) { r = "threw " + e.name; } console.log(label + ": " + r + " [" + log.join(" ") + "]"); }
class C {
  #x = 0; y = 0; static #s = 0;
  static priv(o, src) { ({ a: note("target", o).#x } = src); return o.#x; }
  static pub(o, src) { ({ a: note("target", o).y } = src); return o.y; }
  static stat(src) { ({ a: note("target", C).#s } = src); return C.#s; }
  static arr(o, src) { [note("target", o).#x] = src; return o.#x; }
  static arrPub(o, src) { [note("target", o).y] = src; return o.y; }
  static dflt(o, src) { ({ a: note("target", o).#x = note("default", 5) } = src); return o.#x; }
  static nul(src) { ({ a: note("target", null).#x } = src); }
  static nulPub(src) { ({ a: note("target", null).y } = src); }
}
const src = () => ({ get a() { return note("get", 7); } });
const it = () => ({ [Symbol.iterator]() { note("iter"); return { next() { note("next"); return { done: false, value: 8 }; }, return() { note("return"); return {}; } }; } });
row("a private field", () => C.priv(new C(), src()));
row("a public field", () => C.pub(new C(), src()));
row("a static private field", () => C.stat(src()));
row("in an array pattern, private", () => C.arr(new C(), it()));
row("in an array pattern, public", () => C.arrPub(new C(), it()));
row("with a default", () => C.dflt(new C(), { get a() { note("get"); return undefined; } }));
row("an object without the name", () => C.priv({}, src()));
row("null, private", () => C.nul(src()));
row("null, public", () => C.nulPub(src()));
class D extends class {} { #f; constructor() { const init = () => super(); ({ a: this.#f } = { get a() { note("get"); init(); } }); } }
class E extends class {} { f; constructor() { const init = () => super(); ({ a: this.f } = { get a() { note("get"); init(); } }); } }
row("this ahead of super(), private", () => new D());
row("this ahead of super(), public", () => new E());
