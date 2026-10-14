// Static private fields in every kind of expression: unary, binary, `++`, compound and logical assignments, BigInts, chained stores.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function make(n: number) {
  return class C {
    static #n = n;
    static #big = 10n;
    static #s = "s" + n;
    static #flag = false;
    static #list = [n, n + 1];
    static #o = { v: n, who(this: unknown) { return this === C.#o; }, tag(this: unknown, s: TemplateStringsArray) { return (this === C.#o) + s[0]; }, deep: { w: n } as { w: number } | undefined };
    static #K = class Inner { v = n; };
    static #key = "k" + n;
    static #p = Promise.resolve(n);
    static #a = 1;
    static #b = 2;
    static *#g() { yield n; yield n + 1; }
    static rows(label: string) {
      const t = (what: string, f: () => unknown) => row(label + " " + what, f);
      t("unary", () => [-C.#n, +C.#n, ~C.#n, !C.#flag, typeof C.#n, void C.#n].join());
      t("binary", () => [C.#n + 1, C.#n * 2, C.#n ** 2, C.#n < 3, C.#n === n, C.#s + C.#n, `${C.#s}!`].join());
      t("post and pre", () => [C.#n++, C.#n, ++C.#n, C.#n--, --C.#n, C.#n].join());
      t("a bigint", () => [String(C.#big++), String(++C.#big), String(C.#big -= 2n)].join());
      t("compound", () => [C.#n += 2, C.#n -= 2, C.#n *= 3, C.#n /= 3, C.#n %= 100, C.#n <<= 1, C.#n >>= 1, C.#n |= 0, C.#n &= 255, C.#n ^= 0, C.#n **= 1, C.#s += "x"].join());
      t("logical", () => [C.#flag ||= true, C.#flag &&= false, C.#n ??= 9].join());
      t("a chain of stores", () => { C.#a = C.#b = 3; return [C.#a, C.#b].join(); });
      t("a swap", () => { C.#a = 1; C.#b = 2; [C.#a, C.#b] = [C.#b, C.#a]; return [C.#a, C.#b].join(); });
      t("an object pattern", () => { ({ x: C.#a, y: C.#b = 7 } = { x: 5 } as { x: number, y?: number }); return [C.#a, C.#b].join(); });
      t("the value of a store", () => (C.#a = 4) + 1);
      t("a member of it", () => [C.#o.v, C.#o["v"], C.#o.deep?.w, C.#list[1], C.#list.length, C.#o.who(), C.#o.tag`x`].join());
      t("a store below it", () => { C.#o.v = 8; C.#o.v++; C.#list[0] += 5; C.#list.push(1); return [C.#o.v, C.#list.join("")].join(); });
      t("spread", () => [[...C.#list].length, Object.keys({ ...C.#o }).length, Math.max(...C.#list)].join());
      t("for of", () => { let s = 0; for (const x of C.#list) s += x; for (const x of C.#g()) s += x; return s; });
      t("for in", () => { let s = ""; for (const k in C.#o) s += k; return s; });
      t("a computed key", () => Object.keys({ [C.#key]: 1 })[0] + ({ k1: "one", k2: "two" } as Record<string, string>)[C.#key]);
      t("new and instanceof", () => [new C.#K().v, new C.#K() instanceof C.#K, class extends C.#K {}.name.length].join());
      t("switch", () => { switch (C.#key) { case "k1": return "one"; case "k2": return "two"; default: return "none"; } });
      t("conditional", () => [C.#flag ? C.#a : C.#b, C.#n && C.#a, C.#flag || C.#b].join());
      t("an argument", () => Math.min(C.#a, C.#b) + [C.#a].concat(C.#b).join(""));
      t("yield", () => [...(function* () { yield C.#a; yield* C.#g(); })()].join());
      t("a closure keeps the class, not the value", () => { const f = () => C.#a; C.#a = 40; return f(); });
    }
    static async later(label: string) { console.log(label + " await: " + (await C.#p) + " " + (await C.#n)); }
  };
}
const A = make(1), B = make(2);
A.rows("first"); B.rows("second"); A.rows("first again");
A.later("first").then(() => B.later("second"));
