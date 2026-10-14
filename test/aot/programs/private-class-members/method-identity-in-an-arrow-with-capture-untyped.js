// A private method is the same function object every time it is read: the class is declared in an arrow function and captures a variable (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

const ways = ["viaThis", "viaArrow", "viaFunction", "viaDefault", "viaTry", "viaLoop", "viaCond", "viaInner", "viaLiteral", "viaArray", "viaSpread", "viaTemplate", "viaComma", "viaChain", "viaParen", "viaNullish", "viaAssign", "viaPattern", "viaHeritage", "viaKeyOfInner", "viaLiteralMethod", "viaLiteralGetter", "viaCatch", "viaRest", "viaFieldOfInner", "viaStaticBlockOfInner", "viaDeepArrows", "viaSwitch", "viaLabel"];
function check(label, A, B) {
  const f = A.m();
  for (const way of ways) row(label + " " + way, () => A[way]() === f);
  row(label + " viaGetter", () => A.viaGetter === f);
  row(label + " viaGenerator", () => A.viaGenerator().next().value === f);
  row(label + " viaInstance", () => new A().viaInstance() === f && new A().field === f);
  row(label + " early", () => A.early === f && A.viaNullishEarly === f);
  row(label + " same", () => A.same());
  row(label + " sameInlined", () => A.sameInlined());
  row(label + " called", () => f());
  row(label + " what it is", () => f.name + " " + f.length + " " + typeof f + " " + ("prototype" in f));
  row(label + " no constructor", () => new f());
  row(label + " kinds", () => [A.a() === A.a(), A.g() === A.g(), A.ag() === A.ag(), A.a() === A.m(), A.g() === A.ag()].join());
  row(label + " kinds run", () => [A.g()().next().value, typeof A.a()().then, typeof A.ag()().next].join());
  row(label + " mark", () => { f.mark = label; return A.viaThis().mark; });
  row(label + " mark behind a collection", () => { collect(); return A.viaArrow().mark; });
  row(label + " set", () => { const s = new Set(); s.add(A.m()); s.add(A.viaThis()); const n = s.size; s.delete(A.viaArrow()); return n + " " + s.size; });
  row(label + " weak map", () => { const w = new WeakMap(); w.set(A.m(), 5); return w.get(A.viaTry()); });
  row(label + " index", () => [A.a(), A.m(), A.g()].indexOf(A.viaLoop()));
  row(label + " switch", () => { switch (A.m()) { case A.a(): return "a"; case A.viaChain(): return "m"; default: return "none"; } });
  row(label + " its generator's prototype is kept", () => A.g().prototype === A.g().prototype);
  if (!B) return;
  row(label + " another evaluation", () => A.m() === B.m());
  row(label + " another evaluation's kinds", () => [A.a() === B.a(), A.g() === B.g(), A.ag() === B.ag()].join());
  row(label + " another evaluation called", () => B.m()() + " " + A.m()());
  row(label + " another evaluation's mark", () => B.m().mark);
  row(label + " two in a set", () => new Set([A.m(), B.m(), A.viaThis(), B.viaThis()]).size);
}
const make = (n) => class P {
    static #m() { return n; }
    static async #a() { return n; }
    static *#g() { yield n; }
    static async *#ag() { yield n; }
    static m() { return P.#m; }
    static viaThis() { return this.#m; }
    static viaArrow() { return (() => P.#m)(); }
    static viaFunction() { return (function () { return P.#m; })(); }
    static get viaGetter() { return P.#m; }
    static viaDefault(f = P.#m) { return f; }
    static viaTry() { try { return P.#m; } finally { } }
    static viaLoop() { let f; for (let i = 0; i < 3; i++) f = P.#m; return f; }
    static viaCond(c) { return c ? P.#m : P.#m; }
    static *viaGenerator() { yield P.#m; }
    static viaInner() { return class Q { static q() { return P.#m; } }.q(); }
    static viaLiteral() { return { f: P.#m }.f; }
    static viaArray() { return [P.#m][0]; }
    static viaSpread() { return [...[P.#m]][0]; }
    static viaTemplate() { return ((s, f) => f)`${P.#m}`; }
    static viaComma() { return (P.name, P.#m); }
    static viaChain() { return P?.#m; }
    static viaParen() { return (P).#m; }
    static viaNullish() { return P.early ?? P.#m; }
    static viaAssign() { let f; f = P.#m; return f; }
    static viaPattern() { const { f } = { f: P.#m }; return f; }
    static viaHeritage() { let f; class X extends (f = P.#m, Object) {} return f; }
    static viaKeyOfInner() { let f; class X { [(f = P.#m, "k")]() {} } return f; }
    static viaLiteralMethod() { return { m() { return P.#m; } }.m(); }
    static viaLiteralGetter() { return { get g() { return P.#m; } }.g; }
    static viaCatch() { try { throw 0; } catch { return P.#m; } }
    static viaRest(...a) { return [P.#m, ...a][0]; }
    static viaFieldOfInner() { return new (class { v = P.#m; })().v; }
    static viaStaticBlockOfInner() { let f; class X { static { f = P.#m; } } return f; }
    static viaDeepArrows() { return (() => () => () => P.#m)()()(); }
    static viaSwitch(k = 1) { switch (k) { case 1: return P.#m; default: return undefined; } }
    static viaLabel() { out: { if (P.name !== undefined) break out; return undefined; } return P.#m; }
    field = P.#m;
    viaInstance() { return P.#m; }
    static early = undefined;
    static viaNullishEarly = P.viaNullish();
    static { P.early = P.#m; }
    static same() { return P.#m === P.#m; }
    static sameInlined() { return P.m() === P.m(); }
    static a() { return P.#a; }
    static g() { return P.#g; }
    static ag() { return P.#ag; }
};
check("c", make(1), make(2));