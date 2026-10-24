// Private accessors: reading one that has only a setter and writing one that has only a getter throw, in every kind of expression (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

function make(n) {
  return class C {
    static log = [];
    static #kept = n;
    static set #w(v) { C.log.push("set " + v + " " + (this === C)); C.#kept = v; }
    static get #r() { C.log.push("get " + (this === C)); return C.#kept; }
    static get #rw() { C.log.push("get"); return C.#kept; }
    static set #rw(v) { C.log.push("set " + v); C.#kept = v; }
    static rows(label) {
      const t = (what, f) => { C.log.length = 0; const r = said(f); console.log(label + " " + what + ": " + r + " [" + C.log.join() + "] " + C.#kept); };
      t("read of a setter alone", () => (C).#w);
      t("read of a setter alone on this", () => C.readOnThis());
      t("typeof a setter alone", () => typeof (C).#w);
      t("a setter alone called", () => (C).#w());
      t("a setter alone as a tag", () => (C).#w`a`);
      t("a setter alone, chained", () => C?.#w);
      t("a setter alone +=", () => (C).#w += 1);
      t("a setter alone ++", () => (C).#w++);
      t("a setter alone ??=", () => (C).#w ??= 5);
      t("a setter alone ||=", () => (C).#w ||= 5);
      t("a setter alone &&=", () => (C).#w &&= 5);
      t("a setter alone =", () => C.#w = 4);
      t("a setter alone in a pattern", () => { [C.#w] = [8]; });
      t("a setter alone in", () => #w in C);
      t("a getter alone read", () => C.#r);
      t("a getter alone =", () => (C).#r = 4);
      t("a getter alone +=", () => (C).#r += 1);
      t("a getter alone ++", () => (C).#r++);
      t("a getter alone ||=", () => (C).#r ||= 5);
      t("a getter alone &&=", () => (C).#r &&= 5);
      t("a getter alone ??=", () => (C).#r ??= 5);
      t("a getter alone in a pattern", () => { [(C).#r] = [8]; });
      t("both read", () => C.#rw);
      t("both =", () => C.#rw = 6);
      t("both +=", () => C.#rw += 1);
      t("both ++", () => C.#rw++);
      t("both prefix --", () => --C.#rw);
      t("both ||=", () => C.#rw ||= 5);
      t("both &&=", () => C.#rw &&= 5);
      t("both ??=", () => C.#rw ??= 5);
    }
    static readOnThis() { return (this).#w; }
  };
}
make(1).rows("first");
make(20).rows("second");
class T {
  static set #w(v) {}
  static get #r() { return 1; }
  static #m() {}
  static {
    row("top read of a setter alone", () => (T).#w);
    row("top a setter alone +=", () => (T).#w += 1);
    row("top a getter alone =", () => (T).#r = 1);
    row("top a method =", () => (T).#m = 1);
    row("top a method +=", () => (T).#m += 1);
    row("top a method ++", () => (T).#m++);
    row("top a method ||=", () => typeof ((T).#m ||= 1));
    row("top a method &&=", () => (T).#m &&= 1);
    row("top a method in a pattern", () => { [(T).#m] = [1]; });
  }
}
