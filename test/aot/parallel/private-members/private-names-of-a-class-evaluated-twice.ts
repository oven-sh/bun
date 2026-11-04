// A class that is evaluated several times: each evaluation has names of its own, and all share one layout.
function make(tag: number) {
  return class K { #x = tag; #m() { return tag; } static get(o: any) { return o.#x; } static set(o: any, v: number) { o.#x = v; } static has(o: any) { return #x in o; } static call(o: any) { return o.#m(); } me() { return this.#x; } };
}
function attempt(name: string, f: () => unknown) { try { console.log(name, f()); } catch (e: any) { console.log(name, e instanceof TypeError, e.constructor.name); } }
const K1 = make(1), K2 = make(2); const a = new K1(), b = new K2();
for (let round = 0; round < 3; round++) {
  attempt("K1.get(a)", () => K1.get(a)); attempt("K1.get(b)", () => K1.get(b)); attempt("K2.get(a)", () => K2.get(a)); attempt("K2.get(b)", () => K2.get(b));
  attempt("K1.has(a)", () => K1.has(a)); attempt("K1.has(b)", () => K1.has(b)); attempt("K2.has(a)", () => K2.has(a)); attempt("K2.has(b)", () => K2.has(b));
  attempt("K1.set(b)", () => K1.set(b, 9)); attempt("K2.set(b)", () => K2.set(b, 9 + round)); attempt("K2.get(b)", () => K2.get(b));
  attempt("K1.call(a)", () => K1.call(a)); attempt("K1.call(b)", () => K1.call(b)); attempt("me", () => K1.prototype.me.call(b)); attempt("me", () => K2.prototype.me.call(b));
}
const classes: any[] = []; for (let i = 0; i < 4; i++) classes.push(class L { #v = i; static get(o: any) { return o.#v; } });
const objects = classes.map(c => new c()); let text = "";
for (const c of classes) for (const o of objects) { try { text += c.get(o); } catch { text += "x"; } }
console.log(text);
const mixin = <T extends new (...a: any[]) => object>(Base: T) => class extends Base { #tag = 1; tag() { return this.#tag++; } };
class P {} class Q {} const MP = mixin(P), MQ = mixin(Q); const mp = new MP(), mq = new MQ();
attempt("mp", () => mp.tag() + mp.tag()); attempt("mq", () => mq.tag()); attempt("cross", () => MP.prototype.tag.call(mq)); attempt("cross", () => MQ.prototype.tag.call(mp));
