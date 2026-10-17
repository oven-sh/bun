// Private accessors: reading one that has only a setter and writing one that has only a getter throw, in every kind of expression.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function make(n: number) {
  return class C {
    static log: string[] = [];
    static #kept = n;
    static set #w(v: number) { C.log.push("set " + v + " " + (this === C)); C.#kept = v; }
    static get #r() { C.log.push("get " + (this === C)); return C.#kept; }
    static get #rw() { C.log.push("get"); return C.#kept; }
    static set #rw(v: number) { C.log.push("set " + v); C.#kept = v; }
    static rows(label: string) {
      const t = (what: string, f: () => unknown) => { C.log.length = 0; const r = said(f); console.log(label + " " + what + ": " + r + " [" + C.log.join() + "] " + C.#kept); };
      t("read of a setter alone", () => (C as any).#w);
      t("read of a setter alone on this", () => C.readOnThis());
      t("typeof a setter alone", () => typeof (C as any).#w);
      t("a setter alone called", () => (C as any).#w());
      t("a setter alone as a tag", () => (C as any).#w`a`);
      t("a setter alone +=", () => (C as any).#w += 1);
      t("a setter alone ++", () => (C as any).#w++);
      t("a setter alone ??=", () => (C as any).#w ??= 5);
      t("a setter alone ||=", () => (C as any).#w ||= 5);
      t("a setter alone &&=", () => (C as any).#w &&= 5);
      t("a setter alone =", () => C.#w = 4);
      t("a setter alone in a pattern", () => { [C.#w] = [8]; });
      t("a setter alone in", () => #w in C);
      t("a getter alone read", () => C.#r);
      t("a getter alone =", () => (C as any).#r = 4);
      t("a getter alone +=", () => (C as any).#r += 1);
      t("a getter alone ++", () => (C as any).#r++);
      t("a getter alone ||=", () => (C as any).#r ||= 5);
      t("a getter alone &&=", () => (C as any).#r &&= 5);
      t("a getter alone ??=", () => (C as any).#r ??= 5);
      t("a getter alone in a pattern", () => { [(C as any).#r] = [8]; });
      t("both read", () => C.#rw);
      t("both =", () => C.#rw = 6);
      t("both +=", () => C.#rw += 1);
      t("both ++", () => C.#rw++);
      t("both prefix --", () => --C.#rw);
      t("both ||=", () => C.#rw ||= 5);
      t("both &&=", () => C.#rw &&= 5);
      t("both ??=", () => C.#rw ??= 5);
    }
    static readOnThis() { return (this as any).#w; }
  };
}
make(1).rows("first");
make(20).rows("second");
class T {
  static set #w(v: number) {}
  static get #r() { return 1; }
  static #m() {}
  static {
    row("top read of a setter alone", () => (T as any).#w);
    row("top a setter alone +=", () => (T as any).#w += 1);
    row("top a getter alone =", () => (T as any).#r = 1);
  }
}
