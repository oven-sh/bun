// `f?.(..)` returns `undefined` when `f` is undefined or null, wherever `f` is stored.
function attempt(label: string, f: () => unknown) { try { console.log(label, String(f())); } catch (e: any) { console.log(label, e.constructor.name); } }
type F = ((s: string) => string) | null;
type G = ((s: string) => string) | undefined;
const yes = (s: string) => s + "!";
const hide = (v: unknown): any => v;
class Base { m: F = null; n(s: string) { return "base " + s; } }
class C extends Base {
  #nul: F = null; #und: G = undefined; #fn: F = yes; #any: any = null; static #snul: F = null; static #sfn: F = yes;
  pnul: F = null; pund: G = undefined; pfn: F = yes; pany: any = null; static snul: F = null; static sfn: F = yes;
  #method(s: string) { return "method " + s; }
  privates() { return [this.#nul?.("a"), this.#und?.("a"), this.#fn?.("a"), this.#any?.("a"), this.#method?.("a"), C.#snul?.("a"), C.#sfn?.("a")].join(); }
  publics() { return [this.pnul?.("a"), this.pund?.("a"), this.pfn?.("a"), this.pany?.("a"), C.snul?.("a"), C.sfn?.("a")].join(); }
  supers() { return [super.n?.("a")/*JS, super.m?.("a"), super.missing?.("a")*/].join(); }
  chains(o: C | null) { return [o?.pnul?.("a"), o?.pfn?.("a")].join(); }
  argumentsAreNotEvaluated() { let n = 0; this.#nul?.(String(n++)); this.pnul?.(String(n++)); this.#fn?.(String(n++)); return n; }
}
const c = new C();
attempt("private", () => c.privates());
attempt("public", () => c.publics());
attempt("super", () => c.supers());
attempt("chains", () => c.chains(c) + " " + c.chains(null));
attempt("arguments", () => c.argumentsAreNotEvaluated());
let moduleNull: F = null, moduleUndefined: G = undefined, moduleFunction: F = yes; const touch = () => { moduleNull = null; moduleUndefined = undefined; moduleFunction = yes; }; touch();
attempt("module variables", () => [moduleNull?.("a"), moduleUndefined?.("a"), moduleFunction?.("a")].join());
attempt("locals", () => { let a: F = hide(null), b: G = hide(undefined), f: F = hide(yes); return [a?.("a"), b?.("a"), f?.("a")].join(); });
attempt("any", () => [hide(null)?.("a"), hide(undefined)?.("a"), hide(yes)?.("a"), hide({ f: null }).f?.("a"), hide({}).f?.("a"), hide({ f: yes }).f?.("a")].join());
const o: { b?: { f: F; g?: G } | null; [k: string]: any } = { b: { f: null } }; const k: string = "b" + "";
attempt("a?.b?.()", () => [o?.b?.f?.("a"), o.b?.g?.("a"), o?.missing?.("a"), o?.[k]?.f?.("a"), o?.[k + "x"]?.("a"), o[k]?.["f"]?.("a")].join());
attempt("not a function", () => hide(5)?.("a"));
attempt("not a function, private", () => new (class { #x: any = 5; run() { return this.#x?.("a"); } })().run());
