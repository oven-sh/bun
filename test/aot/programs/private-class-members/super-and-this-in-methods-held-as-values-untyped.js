// Private class members: `super` and `this` in methods kept as values (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

function derived(n) {
  class Base { static base() { return 10; } static #m() { return "base " + n; } static baseM() { return Base.#m; } }
  class D extends Base {
    static #m() { return n + super.base(); }
    static #who() { return this; }
    static #itself(deep) { return deep ? D.#itself(false) : D.#itself; }
    static m() { return D.#m; }
    static who() { return D.#who; }
    static itself() { return D.#itself(true) === D.#itself; }
    static shaped(a, b = 1, ...c) { return a + b + c.length; }
    static #shaped(a, b = 1, ...c) { return a + b + c.length; }
    static shape() { return D.#shaped.length + " " + D.#shaped.name + " " + D.#shaped(1, 2, 3, 4); }
  }
  return D;
}
const D1 = derived(1), D2 = derived(2);
row("super in a method held as a value", () => { const f = D1.m(), g = D2.m(); return f() + " " + g() + " " + (f === D1.m()) + " " + ((f) === g); });
row("the base's own of the same name", () => D1.baseM()() + " " + ((D1.baseM()) === D1.m()) + " " + (D1.baseM() === D1.baseM()) + " " + (D1.baseM() === D2.baseM()));
row("this of a method held as a value", () => { const f = D1.who(); return [f.call(5), f.call(D1) === D1, f() === undefined].join(); });
row("it reads itself", () => D1.itself());
row("its shape", () => D1.shape());
function ofBuiltins(n) {
  return [
    class extends Array { static #m() { return n; } static m() { return this.#m; } },
    class extends Map { static #m() { return n; } static m() { return this.#m; } },
    class extends Error { static #m() { return n; } static m() { return this.#m; } },
    class extends Promise { static #m() { return n; } static m() { return this.#m; } },
    class extends Object { static #m() { return n; } static m() { return this.#m; } },
    class extends (function () {}) { static #m() { return n; } static m() { return this.#m; } },
    class extends (null) { static #m() { return n; } static m() { return this.#m; } },
  ];
}
row("heirs of built-ins", () => { const a = ofBuiltins(1), b = ofBuiltins(2); return a.map((K, i) => [K.m() === K.m(), (K.m()) === b[i].m(), K.m()(), b[i].m()()].join("")).join(); });
function generic(seed) {
  class G {
    static #make(v) { return [seed, v]; }
    static make() { return G.#make; }
    static #kept = seed;
    static kept() { return G.#kept; }
  }
  return G;
}
row("generic and abstract", () => { const A = generic("a"), B = generic(2); return [A.make() === A.make(), (A.make()) === B.make(), A.make()(1).join(""), B.make()("x").join(""), A.kept(), B.kept()].join(); });
function pair(n) {
  class L { static #m() { return "l" + n; } static m() { return L.#m; } static other() { return R.m(); } }
  class R { static #m() { return "r" + n; } static m() { return R.#m; } static other() { return L.m(); } }
  return [L, R];
}
row("two classes of one function", () => { const [L, R] = pair(1); return [L.m() === R.other(), R.m() === L.other(), (L.m()) === R.m(), L.m()(), R.m()()].join(); });
function nest(n) {
  return class Outer {
    static #o() { return "o" + n; }
    static o() { return Outer.#o; }
    static inner(k) {
      return class Inner {
        static #i() { return "i" + n + k; }
        static i() { return Inner.#i; }
        static o() { return Outer.#o; }
        static both() { return Outer.#o() + Inner.#i(); }
        static hasOuter(v) { return #o in v; }
      };
    }
  };
}
row("a nest", () => { const O = nest(1), I1 = O.inner(1), I2 = O.inner(2); return [I1.o() === O.o(), I2.o() === O.o(), I1.i() === I1.i(), (I1.i()) === I2.i(), I1.both(), I2.both(), I1.hasOuter(O), I1.hasOuter(I1), I1.hasOuter(nest(1))].join(); });
class Shadow {
  static #m() { return "outer"; }
  static outer() { return Shadow.#m; }
  static Inner = class In { static #m() { return "inner"; } static inner() { return In.#m; } };
}
row("one name in two classes", () => [Shadow.outer()(), Shadow.Inner.inner()(), (Shadow.outer()) === Shadow.Inner.inner()].join());
function suspended(n) {
  return class S {
    static has() { return #late in S; }
    static *gen() { yield #late in S; yield S.#m === S.#m; yield said(() => S.#late); }
    static async wait() { const a = #late in S; await null; return a + " " + (#late in S) + " " + said(() => S.#late); }
    static #m() { return n; }
    static early = "";
    static pending = undefined;
    static { S.early = [...S.gen()].join(); S.pending = S.wait(); }
    static #late = n;
  };
}
row("in a generator, ahead", () => suspended(1).early);
row("in a generator, behind", () => [...suspended(1).gen()].join());
suspended(1).pending.then(v => console.log("in an async function, across the initializer: " + v));
