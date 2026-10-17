function attempt(label, f) { try { console.log(label, String(f())); } catch (e) { console.log(label, e.constructor.name); } }


const yes = (s) => s + "!";
const hide = (v) => v;
class Base { m= null; n(s) { return "base " + s; } }
class C extends Base {
  #nul= null; #und= undefined; #fn= yes; #any= null; static #snul= null; static #sfn= yes;
  pnul= null; pund= undefined; pfn= yes; pany= null; static snul= null; static sfn= yes;
  #method(s) { return "method " + s; }
  privates() { return [this.#nul?.("a"), this.#und?.("a"), this.#fn?.("a"), this.#any?.("a"), this.#method?.("a"), C.#snul?.("a"), C.#sfn?.("a")].join(); }
  publics() { return [this.pnul?.("a"), this.pund?.("a"), this.pfn?.("a"), this.pany?.("a"), C.snul?.("a"), C.sfn?.("a")].join(); }
  supers() { return [super.n?.("a"), super.m?.("a"), super.missing?.("a")].join(); }
  chains(o) { return [o?.pnul?.("a"), o?.pfn?.("a")].join(); }
  argumentsAreNotEvaluated() { let n = 0; this.#nul?.(String(n++)); this.pnul?.(String(n++)); this.#fn?.(String(n++)); return n; }
}
const c = new C();
attempt("private", () => c.privates());
attempt("public", () => c.publics());
attempt("super", () => c.supers());
attempt("chains", () => c.chains(c) + " " + c.chains(null));
attempt("arguments", () => c.argumentsAreNotEvaluated());
let moduleNull= null, moduleUndefined= undefined, moduleFunction= yes; const touch = () => { moduleNull = null; moduleUndefined = undefined; moduleFunction = yes; }; touch();
attempt("module variables", () => [moduleNull?.("a"), moduleUndefined?.("a"), moduleFunction?.("a")].join());
attempt("locals", () => { let a= hide(null), b= hide(undefined), f= hide(yes); return [a?.("a"), b?.("a"), f?.("a")].join(); });
attempt("any", () => [hide(null)?.("a"), hide(undefined)?.("a"), hide(yes)?.("a"), hide({ f: null }).f?.("a"), hide({}).f?.("a"), hide({ f: yes }).f?.("a")].join());
const o = { b: { f: null } }; const k = "b" + "";
attempt("a?.b?.()", () => [o?.b?.f?.("a"), o.b?.g?.("a"), o?.missing?.("a"), o?.[k]?.f?.("a"), o?.[k + "x"]?.("a"), o[k]?.["f"]?.("a")].join());
attempt("not a function", () => hide(5)?.("a"));
attempt("not a function, private", () => new (class { #x= 5; run() { return this.#x?.("a"); } })().run());
