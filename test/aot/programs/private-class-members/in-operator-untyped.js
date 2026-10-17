// `#name in object`: the right-hand side is evaluated once, non-objects throw, and the result narrows (the same program without type annotations).
function said(f) { try { return String(f()); } catch (e) { return "threw " + (e).name; } }
function row(label, f) { console.log(label + ": " + said(f)); }
const collect = (globalThis).gc ?? (() => (globalThis).Bun.gc(true));

function make(n) {
  return class C {
    static #field = n;
    static #blank;
    static #method() { return n; }
    static get #getter() { return n; }
    static set #setter(v) {}
    static get #both() { return n; }
    static set #both(v) {}
    #instance = n;
    static asks = [];
    static {
      C.asks = [["field", v => #field in v], ["blank", v => #blank in v], ["method", v => #method in v], ["getter", v => #getter in v], ["setter", v => #setter in v], ["both", v => #both in v], ["instance", v => #instance in v]];
    }
    static once(f) { return #field in f(); }
    static inCondition(v) { if (#method in v) return "yes"; else return "no"; }
    static negated(v) { return !(#method in v); }
    static inLoop(vs) { let n = 0; for (const v of vs) if (#field in v) n++; return n; }
    static caught(v) { try { return #field in v; } catch (e) { return "caught " + (e).name; } finally { C.finals++; } }
    static finals = 0;
    static narrowed(v) { return typeof v === "function" && #field in v ? v.#field : -1; }
    static both(v) { return #field in v && #method in v; }
  };
}
const A = make(1), B = make(2);
class H extends A {}
const values = [["the class", A], ["another evaluation", B], ["an heir", H], ["an instance", new A()], ["an object below", Object.create(A)], ["a proxy", new Proxy(A, {})], ["a function", () => 1], ["an object", {}], ["an array", []],
  ["null", null], ["undefined", undefined], ["a number", 1], ["zero", 0], ["NaN", NaN], ["a string", "s"], ["the empty string", ""], ["true", true], ["false", false], ["a symbol", Symbol()], ["a bigint", 1n]];
for (const [kind, ask] of A.asks) for (const [name, v] of values) row(kind + " in " + name, () => ask(v));
let evaluated = 0;
row("the right side once", () => A.once(() => { evaluated++; return A; }) + " " + evaluated);
row("the right side once, then thrown", () => { try { A.once(() => { evaluated++; return 1; }); } catch (e) { return (e).name + " " + evaluated; } });
for (const [name, v] of values) {
  row("in a condition: " + name, () => A.inCondition(v));
  row("negated: " + name, () => A.negated(v));
  row("caught: " + name, () => A.caught(v) + " " + A.finals);
  row("narrowed: " + name, () => A.narrowed(v));
  row("both: " + name, () => A.both(v));
}
row("in a loop", () => A.inLoop([A, B, H, {}, A]));
row("in a loop that throws", () => A.inLoop([A, 1, A]));
class T { static #s = 1; static #m() {} static has(v) { return [#s in v, #m in v].join(); } }
for (const [name, v] of [["the top-level class", T], ...values]) row("top level: " + name, () => T.has(v));
