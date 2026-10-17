// Calls of private methods, fields holding functions, and getters returning functions: what `this` is, with spread arguments and optional chains (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

function who(t, C) { return t === C ? "the class" : t === undefined ? "undefined" : typeof t; }
function make(n) {
  return class C {
    static #m(...a) { return "m" + n + " " + who(this, C) + " " + a.length; }
    static #f = function (...a) { return "f" + n + " " + who(this, C) + " " + a.length; };
    static #arrow = (...a) => "arrow" + n + " " + a.length;
    static #reads = 0;
    static get #g() { C.#reads++; return function (...a) { return "g" + n + " " + who(this, C) + " " + a.length + " read " + C.#reads; }; }
    static #none = undefined;
    static #K = class { v = n; };
    static rows() {
      row("plain m", () => C.#m(1));
      row("plain f", () => C.#f(1));
      row("plain g", () => C.#g(1));
      row("plain arrow", () => C.#arrow(1));
      row("this m", () => C.viaThis());
      row("spread m", () => C.#m(...[1, 2, 3]));
      row("spread f", () => C.#f(...[1, 2, 3]));
      row("spread g", () => C.#g(...[1, 2, 3]));
      row("parenthesized m", () => (C.#m)(1));
      row("parenthesized f", () => (C.#f)(1));
      row("parenthesized g", () => (C.#g)(1));
      row("comma m", () => (0, C.#m)(1));
      row("comma f", () => (0, C.#f)(1));
      row("tag m", () => C.#m`a${1}b`);
      row("tag f", () => C.#f`a${1}b`);
      row("tag g", () => C.#g`a${1}b`);
      row("tag arrow", () => C.#arrow`a${1}b`);
      row("tag on this", () => C.tagOnThis());
      row("chain m", () => C?.#m(1));
      row("chain f", () => C?.#f(1));
      row("chain g", () => C?.#g(1));
      row("optional call m", () => C.#m?.(1));
      row("optional call f", () => C.#f?.(1));
      row("optional call g", () => C.#g?.(1));
      row("optional call of nothing", () => C.#none?.(1));
      row("call of nothing", () => (C.#none)(1));
      row("both chains m", () => C?.#m?.(1));
      row("call", () => C.#m.call(5, 1, 2));
      row("apply", () => C.#m.apply(C, [1, 2]));
      row("bind", () => C.#m.bind(C)(1));
      row("Reflect.apply", () => Reflect.apply(C.#m, undefined, [1]));
      row("held", () => { const f = C.#m; return f(1); });
      row("new of the method", () => new (C.#m)());
      row("new of a class in a field", () => new C.#K().v);
      row("new of a class in a field, no list", () => (new C.#K).v);
      row("chain in parentheses m", () => (C?.#m)(1));
      row("chain in parentheses f", () => (C?.#f)(1));
      row("chain in parentheses g", () => (C?.#g)(1));
      row("chain in parentheses of null", () => { const o = null; return (o?.#m)(1); });
      row("chain in parentheses, optional call", () => { const o = null; return (o?.#m)?.(1); });
      row("chain in parentheses on another", () => { const o = {}; return (o?.#m)(1); });
    }
    static viaThis() { return this.#m(1); }
    static tagOnThis() { return this.#m`a`; }
  };
}
make(1).rows();
make(2).rows();
class T {
  static #m(...a) { return "m " + who(this, T) + " " + a.length; }
  static #f = function (...a) { return "f " + who(this, T) + " " + a.length; };
  static get #g() { return function (...a) { return "g " + who(this, T) + " " + a.length; }; }
  static x = T.#m`a`;
  static y = T.#f`a`;
  static z = T.#g`a`;
  static {
    row("top tag m", () => T.#m`a${1}`);
    row("top tag f", () => T.#f`a${1}`);
    row("top tag g", () => T.#g`a${1}`);
    row("top tag on this", () => T.tag());
    row("top in initializers", () => [T.x, T.y, T.z].join());
    row("top chain in parentheses m", () => (T?.#m)(1));
    row("top chain in parentheses f", () => (T?.#f)(1));
    row("top chain in parentheses g", () => (T?.#g)(1));
  }
  static tag() { return this.#m`a`; }
}
