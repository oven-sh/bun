// `#name in object`: the right-hand side is evaluated once, non-objects throw, and the result narrows.
declare const console: { log(...a: unknown[]): void };
function said(f: () => unknown): string { try { return String(f()); } catch (e) { return "threw " + (e as Error).name; } }
function row(label: string, f: () => unknown): void { console.log(label + ": " + said(f)); }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));

function make(n: number) {
  return class C {
    static #field = n;
    static #blank: unknown;
    static #method() { return n; }
    static get #getter() { return n; }
    static set #setter(v: number) {}
    static get #both() { return n; }
    static set #both(v: number) {}
    #instance = n;
    static asks: [string, (v: any) => boolean][] = [];
    static {
      C.asks = [["field", v => #field in v], ["blank", v => #blank in v], ["method", v => #method in v], ["getter", v => #getter in v], ["setter", v => #setter in v], ["both", v => #both in v], ["instance", v => #instance in v]];
    }
    static once(f: () => any) { return #field in f(); }
    static inCondition(v: any) { if (#method in v) return "yes"; else return "no"; }
    static negated(v: any) { return !(#method in v); }
    static inLoop(vs: any[]) { let n = 0; for (const v of vs) if (#field in v) n++; return n; }
    static caught(v: any) { try { return #field in v; } catch (e) { return "caught " + (e as Error).name; } finally { C.finals++; } }
    static finals = 0;
    static narrowed(v: unknown) { return typeof v === "function" && #field in v ? v.#field : -1; }
    static both(v: any) { return #field in v && #method in v; }
  };
}
const A = make(1), B = make(2);
class H extends A {}
const values: [string, any][] = [["the class", A], ["another evaluation", B], ["an heir", H], ["an instance", new A()], ["an object below", Object.create(A)], ["a proxy", new Proxy(A, {})], ["a function", () => 1], ["an object", {}], ["an array", []],
  ["null", null], ["undefined", undefined], ["a number", 1], ["zero", 0], ["NaN", NaN], ["a string", "s"], ["the empty string", ""], ["true", true], ["false", false], ["a symbol", Symbol()], ["a bigint", 1n]];
for (const [kind, ask] of A.asks) for (const [name, v] of values) row(kind + " in " + name, () => ask(v));
let evaluated = 0;
row("the right side once", () => A.once(() => { evaluated++; return A; }) + " " + evaluated);
row("the right side once, then thrown", () => { try { A.once(() => { evaluated++; return 1; }); } catch (e) { return (e as Error).name + " " + evaluated; } });
for (const [name, v] of values) {
  row("in a condition: " + name, () => A.inCondition(v));
  row("negated: " + name, () => A.negated(v));
  row("caught: " + name, () => A.caught(v) + " " + A.finals);
  row("narrowed: " + name, () => A.narrowed(v));
  row("both: " + name, () => A.both(v));
}
row("in a loop", () => A.inLoop([A, B, H, {}, A]));
row("in a loop that throws", () => A.inLoop([A, 1, A]));
class T { static #s = 1; static #m() {} static has(v: any) { return [#s in v, #m in v].join(); } }
for (const [name, v] of [["the top-level class", T] as [string, any], ...values]) row("top level: " + name, () => T.has(v));
