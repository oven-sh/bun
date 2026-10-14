// Calls of private methods, fields holding functions, and getters returning functions: what `this` is, with spread arguments and optional chains.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

type F = (this: unknown, ...a: unknown[]) => string;
function who(t: unknown, C: unknown) { return t === C ? "the class" : t === undefined ? "undefined" : typeof t; }
function make(n: number) {
  return class C {
    static #m(this: unknown, ...a: unknown[]) { return "m" + n + " " + who(this, C) + " " + a.length; }
    static #f: F = function (this: unknown, ...a: unknown[]) { return "f" + n + " " + who(this, C) + " " + a.length; };
    static #arrow = (...a: unknown[]) => "arrow" + n + " " + a.length;
    static #reads = 0;
    static get #g(): F { C.#reads++; return function (this: unknown, ...a: unknown[]) { return "g" + n + " " + who(this, C) + " " + a.length + " read " + C.#reads; }; }
    static #none: F | undefined = undefined;
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
      row("optional call m", () => C.#m?.(1));
      row("optional call f", () => C.#f?.(1));
      row("optional call g", () => C.#g?.(1));
      row("optional call of nothing", () => C.#none?.(1));
      row("call of nothing", () => (C.#none as F)(1));
      row("call", () => C.#m.call(5, 1, 2));
      row("apply", () => C.#m.apply(C, [1, 2]));
      row("bind", () => C.#m.bind(C)(1));
      row("Reflect.apply", () => Reflect.apply(C.#m, undefined, [1]));
      row("held", () => { const f = C.#m; return f(1); });
      row("new of the method", () => new (C.#m as any)());
      row("new of a class in a field", () => new C.#K().v);
      row("new of a class in a field, no list", () => (new C.#K).v);
      row("asserted m", () => C.#m!(1));
      row("asserted f", () => C.#f!(1));
      row("asserted g", () => C.#g!(1));
      row("asserted nothing", () => C.#none!(1));
      row("as m", () => (C.#m as F)(1));
      row("as f", () => (C.#f as F)(1));
      row("as g", () => (C.#g as F)(1));
      row("angle m", () => (<F>C.#m)(1));
      row("satisfies m", () => (C.#m satisfies F)(1));
      row("asserted twice m", () => C.#m!!(1));
      row("asserted on this", () => C.assertedOnThis());
      row("asserted tag", () => C.#m!`a`);
      row("as any receiver m", () => (C as any).#m(1));
      row("as any receiver f", () => (C as any).#f(1));
      row("asserted receiver m", () => C!.#m(1));
    }
    static viaThis() { return this.#m(1); }
    static tagOnThis() { return this.#m`a`; }
    static assertedOnThis() { return this.#m!(1); }
  };
}
make(1).rows();
make(2).rows();
class T {
  static #m(this: unknown, ...a: unknown[]) { return "m " + who(this, T) + " " + a.length; }
  static #f: F = function (this: unknown, ...a: unknown[]) { return "f " + who(this, T) + " " + a.length; };
  static get #g(): F { return function (this: unknown, ...a: unknown[]) { return "g " + who(this, T) + " " + a.length; }; }
  static x = T.#m`a`;
  static y = T.#f`a`;
  static z = T.#g`a`;
  static {
    row("top tag m", () => T.#m`a${1}`);
    row("top tag f", () => T.#f`a${1}`);
    row("top tag g", () => T.#g`a${1}`);
    row("top tag on this", () => T.tag());
    row("top in initializers", () => [T.x, T.y, T.z].join());
    row("top asserted m", () => T.#m!(1));
    row("top asserted f", () => T.#f!(1));
    row("top asserted g", () => T.#g!(1));
    row("top as m", () => (T.#m as F)(1));
    row("top asserted on this", () => T.asserted());
  }
  static tag() { return this.#m`a`; }
  static asserted() { return this.#m!(1); }
}
