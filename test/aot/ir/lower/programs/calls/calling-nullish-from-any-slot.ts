// RUN: lower
// OPTIONS: builtin-modules

// A function, a callable Proxy, nothing or a revoked Proxy is kept in every kind of place (fields, private and static fields, variables of a module and of a closure, tuples, maps, records, what ?: ?? || join ..) and called from there, as the last thing a function does and not: a TypeError where there is nothing.
declare const console: any;
type Fn = (x: number) => number;
interface Pair { first?: Fn; second: Fn | null }
const inc: Fn = x => x + 1;
const proxied: Fn = new Proxy(inc, {});
const revocable = Proxy.revocable(inc, {}); revocable.revoke();
const revoked: Fn = revocable.proxy;
function outcome(f: () => unknown): string { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : "other " + String(e); } }
let moduleVariable: Fn | undefined;
let moduleVariableOrNull: Fn | null = null;
class Box {
  field?: Fn; orNull: Fn | null = null; static shared: Fn | undefined; #hidden: Fn | undefined;
  constructor(f?: Fn) { if (f) { this.field = f; this.orNull = f; this.#hidden = f; } }
  get got(): Fn | undefined { return this.field; }
  c0() { return this.field!(1); }
  c1() { try { return this.field!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c2() { var result; result = this.field!(1); return result; }
  c3() { try { var result; result = this.field!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c4() { return this.orNull!(1); }
  c5() { try { return this.orNull!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c6() { var result; result = this.orNull!(1); return result; }
  c7() { try { var result; result = this.orNull!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c8() { return this.#hidden!(1); }
  c9() { try { return this.#hidden!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c10() { var result; result = this.#hidden!(1); return result; }
  c11() { try { var result; result = this.#hidden!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c12() { return this.got!(1); }
  c13() { try { return this.got!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c14() { var result; result = this.got!(1); return result; }
  c15() { try { var result; result = this.got!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  static c16() { return Box.shared!(1); }
  static c17() { try { return Box.shared!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  static c18() { var result; result = Box.shared!(1); return result; }
  static c19() { try { var result; result = Box.shared!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
}
class Heir extends Box {
  c20() { return this.field!(1); }
  c21() { try { return this.field!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c22() { var result; result = this.field!(1); return result; }
  c23() { try { var result; result = this.field!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c24() { return super.got!(1); }
  c25() { try { return super.got!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
  c26() { var result; result = super.got!(1); return result; }
  c27() { try { var result; result = super.got!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
}
function c28(b: Box) { return b.field!(1); }
function c29(b: Box) { try { return b.field!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c30(b: Box) { var result; result = b.field!(1); return result; }
function c31(b: Box) { try { var result; result = b.field!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c32() { return moduleVariable!(1); }
function c33() { try { return moduleVariable!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c34() { var result; result = moduleVariable!(1); return result; }
function c35() { try { var result; result = moduleVariable!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c36() { return moduleVariableOrNull!(1); }
function c37() { try { return moduleVariableOrNull!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c38() { var result; result = moduleVariableOrNull!(1); return result; }
function c39() { try { var result; result = moduleVariableOrNull!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c40(f?: Fn) { let kept: Fn | undefined; const set = (g?: Fn) => { kept = g; }; set(f); return kept!(1); }
function c41(f?: Fn) { try { let kept: Fn | undefined; const set = (g?: Fn) => { kept = g; }; set(f); return kept!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c42(f?: Fn) { let kept: Fn | undefined; const set = (g?: Fn) => { kept = g; }; set(f); var result; result = kept!(1); return result; }
function c43(f?: Fn) { try { let kept: Fn | undefined; const set = (g?: Fn) => { kept = g; }; set(f); var result; result = kept!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c44(t: [Fn | undefined, number]) { return t[0]!(1); }
function c45(t: [Fn | undefined, number]) { try { return t[0]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c46(t: [Fn | undefined, number]) { var result; result = t[0]!(1); return result; }
function c47(t: [Fn | undefined, number]) { try { var result; result = t[0]!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c48(m: Map<string, Fn>) { return m.get("k")!(1); }
function c49(m: Map<string, Fn>) { try { return m.get("k")!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c50(m: Map<string, Fn>) { var result; result = m.get("k")!(1); return result; }
function c51(m: Map<string, Fn>) { try { var result; result = m.get("k")!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c52(r: Record<string, Fn>) { return r.k(1); }
function c53(r: Record<string, Fn>) { try { return r.k(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c54(r: Record<string, Fn>) { var result; result = r.k(1); return result; }
function c55(r: Record<string, Fn>) { try { var result; result = r.k(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c56(r: Record<string, Fn>, k: string) { return r[k](1); }
function c57(r: Record<string, Fn>, k: string) { try { return r[k](1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c58(r: Record<string, Fn>, k: string) { var result; result = r[k](1); return result; }
function c59(r: Record<string, Fn>, k: string) { try { var result; result = r[k](1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c60(a: (Fn | null)[], i: number) { return a[i]!(1); }
function c61(a: (Fn | null)[], i: number) { try { return a[i]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c62(a: (Fn | null)[], i: number) { var result; result = a[i]!(1); return result; }
function c63(a: (Fn | null)[], i: number) { try { var result; result = a[i]!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c64(a: Fn[], i: number) { return a[i](1); }
function c65(a: Fn[], i: number) { try { return a[i](1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c66(a: Fn[], i: number) { var result; result = a[i](1); return result; }
function c67(a: Fn[], i: number) { try { var result; result = a[i](1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c68(a: (Fn | undefined)[], i: number) { return a[i]!(1); }
function c69(a: (Fn | undefined)[], i: number) { try { return a[i]!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c70(a: (Fn | undefined)[], i: number) { var result; result = a[i]!(1); return result; }
function c71(a: (Fn | undefined)[], i: number) { try { var result; result = a[i]!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c72(c: boolean, p: Pair) { return (c ? p.first : p.second)!(1); }
function c73(c: boolean, p: Pair) { try { return (c ? p.first : p.second)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c74(c: boolean, p: Pair) { var result; result = (c ? p.first : p.second)!(1); return result; }
function c75(c: boolean, p: Pair) { try { var result; result = (c ? p.first : p.second)!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c76(c: boolean, p: Pair) { return (c ? p.first : p.second)!(1); }
function c77(c: boolean, p: Pair) { try { return (c ? p.first : p.second)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c78(c: boolean, p: Pair) { var result; result = (c ? p.first : p.second)!(1); return result; }
function c79(c: boolean, p: Pair) { try { var result; result = (c ? p.first : p.second)!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c80(p: Pair) { return (p.first ?? p.second)!(1); }
function c81(p: Pair) { try { return (p.first ?? p.second)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c82(p: Pair) { var result; result = (p.first ?? p.second)!(1); return result; }
function c83(p: Pair) { try { var result; result = (p.first ?? p.second)!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c84(p: Pair) { return (p.first || p.second)!(1); }
function c85(p: Pair) { try { return (p.first || p.second)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c86(p: Pair) { var result; result = (p.first || p.second)!(1); return result; }
function c87(p: Pair) { try { var result; result = (p.first || p.second)!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c88(p: Pair) { return (p.second && p.first)!(1); }
function c89(p: Pair) { try { return (p.second && p.first)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c90(p: Pair) { var result; result = (p.second && p.first)!(1); return result; }
function c91(p: Pair) { try { var result; result = (p.second && p.first)!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c92({ first }: Pair) { return first!(1); }
function c93({ first }: Pair) { try { return first!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c94({ first }: Pair) { var result; result = first!(1); return result; }
function c95({ first }: Pair) { try { var result; result = first!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c96({ first = undefined }: Pair) { return first!(1); }
function c97({ first = undefined }: Pair) { try { return first!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c98({ first = undefined }: Pair) { var result; result = first!(1); return result; }
function c99({ first = undefined }: Pair) { try { var result; result = first!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c100(f: Fn | undefined = undefined) { return f!(1); }
function c101(f: Fn | undefined = undefined) { try { return f!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c102(f: Fn | undefined = undefined) { var result; result = f!(1); return result; }
function c103(f: Fn | undefined = undefined) { try { var result; result = f!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c104(...f: Fn[]) { return f[0](1); }
function c105(...f: Fn[]) { try { return f[0](1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c106(...f: Fn[]) { var result; result = f[0](1); return result; }
function c107(...f: Fn[]) { try { var result; result = f[0](1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c108(o: { inner: Pair }) { return o.inner.first!(1); }
function c109(o: { inner: Pair }) { try { return o.inner.first!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c110(o: { inner: Pair }) { var result; result = o.inner.first!(1); return result; }
function c111(o: { inner: Pair }) { try { var result; result = o.inner.first!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c112(p: Pair) { return (p.second, p.first)!(1); }
function c113(p: Pair) { try { return (p.second, p.first)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c114(p: Pair) { var result; result = (p.second, p.first)!(1); return result; }
function c115(p: Pair) { try { var result; result = (p.second, p.first)!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c116(p: Pair) { let f: Fn | undefined; return (f = p.first)!(1); }
function c117(p: Pair) { try { let f: Fn | undefined; return (f = p.first)!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c118(p: Pair) { let f: Fn | undefined; var result; result = (f = p.first)!(1); return result; }
function c119(p: Pair) { try { let f: Fn | undefined; var result; result = (f = p.first)!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c120(p: Pair) { return p.first!.call(undefined, 1); }
function c121(p: Pair) { try { return p.first!.call(undefined, 1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c122(p: Pair) { var result; result = p.first!.call(undefined, 1); return result; }
function c123(p: Pair) { try { var result; result = p.first!.call(undefined, 1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c124(p: Pair) { return p.first!.apply(undefined, [1]); }
function c125(p: Pair) { try { return p.first!.apply(undefined, [1]); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c126(p: Pair) { var result; result = p.first!.apply(undefined, [1]); return result; }
function c127(p: Pair) { try { var result; result = p.first!.apply(undefined, [1]); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c128(p: Pair) { return Reflect.apply(p.first!, undefined, [1]); }
function c129(p: Pair) { try { return Reflect.apply(p.first!, undefined, [1]); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c130(p: Pair) { var result; result = Reflect.apply(p.first!, undefined, [1]); return result; }
function c131(p: Pair) { try { var result; result = Reflect.apply(p.first!, undefined, [1]); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c132(t: { tag?: (s: TemplateStringsArray) => number }) { return t.tag!`x`; }
function c133(t: { tag?: (s: TemplateStringsArray) => number }) { try { return t.tag!`x`; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c134(t: { tag?: (s: TemplateStringsArray) => number }) { var result; result = t.tag!`x`; return result; }
function c135(t: { tag?: (s: TemplateStringsArray) => number }) { try { var result; result = t.tag!`x`; return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c136(p: Pair) { return p.first?.(1); }
function c137(p: Pair) { try { return p.first?.(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c138(p: Pair) { var result; result = p.first?.(1); return result; }
function c139(p: Pair) { try { var result; result = p.first?.(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c140(p: Pair) { return p.second?.(1); }
function c141(p: Pair) { try { return p.second?.(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c142(p: Pair) { var result; result = p.second?.(1); return result; }
function c143(p: Pair) { try { var result; result = p.second?.(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c144(p: { make?: () => Fn }) { return p.make!()(1); }
function c145(p: { make?: () => Fn }) { try { return p.make!()(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c146(p: { make?: () => Fn }) { var result; result = p.make!()(1); return result; }
function c147(p: { make?: () => Fn }) { try { var result; result = p.make!()(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c148(p: { method?(x: number): number }) { return p.method!(1); }
function c149(p: { method?(x: number): number }) { try { return p.method!(1); } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c150(p: { method?(x: number): number }) { var result; result = p.method!(1); return result; }
function c151(p: { method?(x: number): number }) { try { var result; result = p.method!(1); return result; } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c152(p: Pair, k: number) { switch (k) { case 1: return p.first!(1); case 2: { return p.second!(1); } default: return -3; } }
function c153(p: Pair, k: number) { try { switch (k) { case 1: return p.first!(1); case 2: { return p.second!(1); } default: return -3; } } catch (e) { return e instanceof TypeError ? -1 : -2; } }
function c154(p: Pair, k: number) { switch (k) { case 1: var result; result = p.first!(1); return result; case 2: { var result; result = p.second!(1); return result; } default: return -3; } }
function c155(p: Pair, k: number) { try { switch (k) { case 1: var result; result = p.first!(1); return result; case 2: { var result; result = p.second!(1); return result; } default: return -3; } } catch (e) { return e instanceof TypeError ? -1 : -2; } }
console.log("a field of this, last:", outcome(() => { var r; r = new Box(inc).c0(); return r; }), outcome(() => { var r; r = new Box(proxied).c0(); return r; }), outcome(() => { var r; r = new Box().c0(); return r; }), outcome(() => { var r; r = new Box(revoked).c0(); return r; }), outcome(() => { var r; r = new Box(inc).c0(); return r; }));
console.log("a field of this, last, in try:", outcome(() => { var r; r = new Box(inc).c1(); return r; }), outcome(() => { var r; r = new Box(proxied).c1(); return r; }), outcome(() => { var r; r = new Box().c1(); return r; }), outcome(() => { var r; r = new Box(revoked).c1(); return r; }), outcome(() => { var r; r = new Box(inc).c1(); return r; }));
console.log("a field of this, not last:", outcome(() => { var r; r = new Box(inc).c2(); return r; }), outcome(() => { var r; r = new Box(proxied).c2(); return r; }), outcome(() => { var r; r = new Box().c2(); return r; }), outcome(() => { var r; r = new Box(revoked).c2(); return r; }), outcome(() => { var r; r = new Box(inc).c2(); return r; }));
console.log("a field of this, not last, in try:", outcome(() => { var r; r = new Box(inc).c3(); return r; }), outcome(() => { var r; r = new Box(proxied).c3(); return r; }), outcome(() => { var r; r = new Box().c3(); return r; }), outcome(() => { var r; r = new Box(revoked).c3(); return r; }), outcome(() => { var r; r = new Box(inc).c3(); return r; }));
console.log("a field of this or null, last:", outcome(() => { var r; r = new Box(inc).c4(); return r; }), outcome(() => { var r; r = new Box(proxied).c4(); return r; }), outcome(() => { var r; r = new Box().c4(); return r; }), outcome(() => { var r; r = new Box(revoked).c4(); return r; }), outcome(() => { var r; r = new Box(inc).c4(); return r; }));
console.log("a field of this or null, last, in try:", outcome(() => { var r; r = new Box(inc).c5(); return r; }), outcome(() => { var r; r = new Box(proxied).c5(); return r; }), outcome(() => { var r; r = new Box().c5(); return r; }), outcome(() => { var r; r = new Box(revoked).c5(); return r; }), outcome(() => { var r; r = new Box(inc).c5(); return r; }));
console.log("a field of this or null, not last:", outcome(() => { var r; r = new Box(inc).c6(); return r; }), outcome(() => { var r; r = new Box(proxied).c6(); return r; }), outcome(() => { var r; r = new Box().c6(); return r; }), outcome(() => { var r; r = new Box(revoked).c6(); return r; }), outcome(() => { var r; r = new Box(inc).c6(); return r; }));
console.log("a field of this or null, not last, in try:", outcome(() => { var r; r = new Box(inc).c7(); return r; }), outcome(() => { var r; r = new Box(proxied).c7(); return r; }), outcome(() => { var r; r = new Box().c7(); return r; }), outcome(() => { var r; r = new Box(revoked).c7(); return r; }), outcome(() => { var r; r = new Box(inc).c7(); return r; }));
console.log("a private field, last:", outcome(() => { var r; r = new Box(inc).c8(); return r; }), outcome(() => { var r; r = new Box(proxied).c8(); return r; }), outcome(() => { var r; r = new Box().c8(); return r; }), outcome(() => { var r; r = new Box(revoked).c8(); return r; }), outcome(() => { var r; r = new Box(inc).c8(); return r; }));
console.log("a private field, last, in try:", outcome(() => { var r; r = new Box(inc).c9(); return r; }), outcome(() => { var r; r = new Box(proxied).c9(); return r; }), outcome(() => { var r; r = new Box().c9(); return r; }), outcome(() => { var r; r = new Box(revoked).c9(); return r; }), outcome(() => { var r; r = new Box(inc).c9(); return r; }));
console.log("a private field, not last:", outcome(() => { var r; r = new Box(inc).c10(); return r; }), outcome(() => { var r; r = new Box(proxied).c10(); return r; }), outcome(() => { var r; r = new Box().c10(); return r; }), outcome(() => { var r; r = new Box(revoked).c10(); return r; }), outcome(() => { var r; r = new Box(inc).c10(); return r; }));
console.log("a private field, not last, in try:", outcome(() => { var r; r = new Box(inc).c11(); return r; }), outcome(() => { var r; r = new Box(proxied).c11(); return r; }), outcome(() => { var r; r = new Box().c11(); return r; }), outcome(() => { var r; r = new Box(revoked).c11(); return r; }), outcome(() => { var r; r = new Box(inc).c11(); return r; }));
console.log("a getter, last:", outcome(() => { var r; r = new Box(inc).c12(); return r; }), outcome(() => { var r; r = new Box(proxied).c12(); return r; }), outcome(() => { var r; r = new Box().c12(); return r; }), outcome(() => { var r; r = new Box(revoked).c12(); return r; }), outcome(() => { var r; r = new Box(inc).c12(); return r; }));
console.log("a getter, last, in try:", outcome(() => { var r; r = new Box(inc).c13(); return r; }), outcome(() => { var r; r = new Box(proxied).c13(); return r; }), outcome(() => { var r; r = new Box().c13(); return r; }), outcome(() => { var r; r = new Box(revoked).c13(); return r; }), outcome(() => { var r; r = new Box(inc).c13(); return r; }));
console.log("a getter, not last:", outcome(() => { var r; r = new Box(inc).c14(); return r; }), outcome(() => { var r; r = new Box(proxied).c14(); return r; }), outcome(() => { var r; r = new Box().c14(); return r; }), outcome(() => { var r; r = new Box(revoked).c14(); return r; }), outcome(() => { var r; r = new Box(inc).c14(); return r; }));
console.log("a getter, not last, in try:", outcome(() => { var r; r = new Box(inc).c15(); return r; }), outcome(() => { var r; r = new Box(proxied).c15(); return r; }), outcome(() => { var r; r = new Box().c15(); return r; }), outcome(() => { var r; r = new Box(revoked).c15(); return r; }), outcome(() => { var r; r = new Box(inc).c15(); return r; }));
console.log("a static field, last:", outcome(() => { var r; r = (Box.shared = inc, Box.c16()); return r; }), outcome(() => { var r; r = (Box.shared = proxied, Box.c16()); return r; }), outcome(() => { var r; r = (Box.shared = undefined, Box.c16()); return r; }), outcome(() => { var r; r = (Box.shared = revoked, Box.c16()); return r; }), outcome(() => { var r; r = (Box.shared = inc, Box.c16()); return r; }));
console.log("a static field, last, in try:", outcome(() => { var r; r = (Box.shared = inc, Box.c17()); return r; }), outcome(() => { var r; r = (Box.shared = proxied, Box.c17()); return r; }), outcome(() => { var r; r = (Box.shared = undefined, Box.c17()); return r; }), outcome(() => { var r; r = (Box.shared = revoked, Box.c17()); return r; }), outcome(() => { var r; r = (Box.shared = inc, Box.c17()); return r; }));
console.log("a static field, not last:", outcome(() => { var r; r = (Box.shared = inc, Box.c18()); return r; }), outcome(() => { var r; r = (Box.shared = proxied, Box.c18()); return r; }), outcome(() => { var r; r = (Box.shared = undefined, Box.c18()); return r; }), outcome(() => { var r; r = (Box.shared = revoked, Box.c18()); return r; }), outcome(() => { var r; r = (Box.shared = inc, Box.c18()); return r; }));
console.log("a static field, not last, in try:", outcome(() => { var r; r = (Box.shared = inc, Box.c19()); return r; }), outcome(() => { var r; r = (Box.shared = proxied, Box.c19()); return r; }), outcome(() => { var r; r = (Box.shared = undefined, Box.c19()); return r; }), outcome(() => { var r; r = (Box.shared = revoked, Box.c19()); return r; }), outcome(() => { var r; r = (Box.shared = inc, Box.c19()); return r; }));
console.log("an inherited field, last:", outcome(() => { var r; r = new Heir(inc).c20(); return r; }), outcome(() => { var r; r = new Heir(proxied).c20(); return r; }), outcome(() => { var r; r = new Heir().c20(); return r; }), outcome(() => { var r; r = new Heir(revoked).c20(); return r; }), outcome(() => { var r; r = new Heir(inc).c20(); return r; }));
console.log("an inherited field, last, in try:", outcome(() => { var r; r = new Heir(inc).c21(); return r; }), outcome(() => { var r; r = new Heir(proxied).c21(); return r; }), outcome(() => { var r; r = new Heir().c21(); return r; }), outcome(() => { var r; r = new Heir(revoked).c21(); return r; }), outcome(() => { var r; r = new Heir(inc).c21(); return r; }));
console.log("an inherited field, not last:", outcome(() => { var r; r = new Heir(inc).c22(); return r; }), outcome(() => { var r; r = new Heir(proxied).c22(); return r; }), outcome(() => { var r; r = new Heir().c22(); return r; }), outcome(() => { var r; r = new Heir(revoked).c22(); return r; }), outcome(() => { var r; r = new Heir(inc).c22(); return r; }));
console.log("an inherited field, not last, in try:", outcome(() => { var r; r = new Heir(inc).c23(); return r; }), outcome(() => { var r; r = new Heir(proxied).c23(); return r; }), outcome(() => { var r; r = new Heir().c23(); return r; }), outcome(() => { var r; r = new Heir(revoked).c23(); return r; }), outcome(() => { var r; r = new Heir(inc).c23(); return r; }));
console.log("a getter by super, last:", outcome(() => { var r; r = new Heir(inc).c24(); return r; }), outcome(() => { var r; r = new Heir(proxied).c24(); return r; }), outcome(() => { var r; r = new Heir().c24(); return r; }), outcome(() => { var r; r = new Heir(revoked).c24(); return r; }), outcome(() => { var r; r = new Heir(inc).c24(); return r; }));
console.log("a getter by super, last, in try:", outcome(() => { var r; r = new Heir(inc).c25(); return r; }), outcome(() => { var r; r = new Heir(proxied).c25(); return r; }), outcome(() => { var r; r = new Heir().c25(); return r; }), outcome(() => { var r; r = new Heir(revoked).c25(); return r; }), outcome(() => { var r; r = new Heir(inc).c25(); return r; }));
console.log("a getter by super, not last:", outcome(() => { var r; r = new Heir(inc).c26(); return r; }), outcome(() => { var r; r = new Heir(proxied).c26(); return r; }), outcome(() => { var r; r = new Heir().c26(); return r; }), outcome(() => { var r; r = new Heir(revoked).c26(); return r; }), outcome(() => { var r; r = new Heir(inc).c26(); return r; }));
console.log("a getter by super, not last, in try:", outcome(() => { var r; r = new Heir(inc).c27(); return r; }), outcome(() => { var r; r = new Heir(proxied).c27(); return r; }), outcome(() => { var r; r = new Heir().c27(); return r; }), outcome(() => { var r; r = new Heir(revoked).c27(); return r; }), outcome(() => { var r; r = new Heir(inc).c27(); return r; }));
console.log("a field of an instance, last:", outcome(() => { var r; r = c28(new Box(inc)); return r; }), outcome(() => { var r; r = c28(new Box(proxied)); return r; }), outcome(() => { var r; r = c28(new Box()); return r; }), outcome(() => { var r; r = c28(new Box(revoked)); return r; }), outcome(() => { var r; r = c28(new Box(inc)); return r; }));
console.log("a field of an instance, last, in try:", outcome(() => { var r; r = c29(new Box(inc)); return r; }), outcome(() => { var r; r = c29(new Box(proxied)); return r; }), outcome(() => { var r; r = c29(new Box()); return r; }), outcome(() => { var r; r = c29(new Box(revoked)); return r; }), outcome(() => { var r; r = c29(new Box(inc)); return r; }));
console.log("a field of an instance, not last:", outcome(() => { var r; r = c30(new Box(inc)); return r; }), outcome(() => { var r; r = c30(new Box(proxied)); return r; }), outcome(() => { var r; r = c30(new Box()); return r; }), outcome(() => { var r; r = c30(new Box(revoked)); return r; }), outcome(() => { var r; r = c30(new Box(inc)); return r; }));
console.log("a field of an instance, not last, in try:", outcome(() => { var r; r = c31(new Box(inc)); return r; }), outcome(() => { var r; r = c31(new Box(proxied)); return r; }), outcome(() => { var r; r = c31(new Box()); return r; }), outcome(() => { var r; r = c31(new Box(revoked)); return r; }), outcome(() => { var r; r = c31(new Box(inc)); return r; }));
console.log("a module variable, last:", outcome(() => { var r; r = (moduleVariable = inc, c32()); return r; }), outcome(() => { var r; r = (moduleVariable = proxied, c32()); return r; }), outcome(() => { var r; r = (moduleVariable = undefined, c32()); return r; }), outcome(() => { var r; r = (moduleVariable = revoked, c32()); return r; }), outcome(() => { var r; r = (moduleVariable = inc, c32()); return r; }));
console.log("a module variable, last, in try:", outcome(() => { var r; r = (moduleVariable = inc, c33()); return r; }), outcome(() => { var r; r = (moduleVariable = proxied, c33()); return r; }), outcome(() => { var r; r = (moduleVariable = undefined, c33()); return r; }), outcome(() => { var r; r = (moduleVariable = revoked, c33()); return r; }), outcome(() => { var r; r = (moduleVariable = inc, c33()); return r; }));
console.log("a module variable, not last:", outcome(() => { var r; r = (moduleVariable = inc, c34()); return r; }), outcome(() => { var r; r = (moduleVariable = proxied, c34()); return r; }), outcome(() => { var r; r = (moduleVariable = undefined, c34()); return r; }), outcome(() => { var r; r = (moduleVariable = revoked, c34()); return r; }), outcome(() => { var r; r = (moduleVariable = inc, c34()); return r; }));
console.log("a module variable, not last, in try:", outcome(() => { var r; r = (moduleVariable = inc, c35()); return r; }), outcome(() => { var r; r = (moduleVariable = proxied, c35()); return r; }), outcome(() => { var r; r = (moduleVariable = undefined, c35()); return r; }), outcome(() => { var r; r = (moduleVariable = revoked, c35()); return r; }), outcome(() => { var r; r = (moduleVariable = inc, c35()); return r; }));
console.log("a module variable or null, last:", outcome(() => { var r; r = (moduleVariableOrNull = inc, c36()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = proxied, c36()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = null, c36()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = revoked, c36()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = inc, c36()); return r; }));
console.log("a module variable or null, last, in try:", outcome(() => { var r; r = (moduleVariableOrNull = inc, c37()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = proxied, c37()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = null, c37()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = revoked, c37()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = inc, c37()); return r; }));
console.log("a module variable or null, not last:", outcome(() => { var r; r = (moduleVariableOrNull = inc, c38()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = proxied, c38()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = null, c38()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = revoked, c38()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = inc, c38()); return r; }));
console.log("a module variable or null, not last, in try:", outcome(() => { var r; r = (moduleVariableOrNull = inc, c39()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = proxied, c39()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = null, c39()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = revoked, c39()); return r; }), outcome(() => { var r; r = (moduleVariableOrNull = inc, c39()); return r; }));
console.log("a captured variable, last:", outcome(() => { var r; r = c40(inc); return r; }), outcome(() => { var r; r = c40(proxied); return r; }), outcome(() => { var r; r = c40(); return r; }), outcome(() => { var r; r = c40(revoked); return r; }), outcome(() => { var r; r = c40(inc); return r; }));
console.log("a captured variable, last, in try:", outcome(() => { var r; r = c41(inc); return r; }), outcome(() => { var r; r = c41(proxied); return r; }), outcome(() => { var r; r = c41(); return r; }), outcome(() => { var r; r = c41(revoked); return r; }), outcome(() => { var r; r = c41(inc); return r; }));
console.log("a captured variable, not last:", outcome(() => { var r; r = c42(inc); return r; }), outcome(() => { var r; r = c42(proxied); return r; }), outcome(() => { var r; r = c42(); return r; }), outcome(() => { var r; r = c42(revoked); return r; }), outcome(() => { var r; r = c42(inc); return r; }));
console.log("a captured variable, not last, in try:", outcome(() => { var r; r = c43(inc); return r; }), outcome(() => { var r; r = c43(proxied); return r; }), outcome(() => { var r; r = c43(); return r; }), outcome(() => { var r; r = c43(revoked); return r; }), outcome(() => { var r; r = c43(inc); return r; }));
console.log("a tuple, last:", outcome(() => { var r; r = c44([inc, 1]); return r; }), outcome(() => { var r; r = c44([proxied, 1]); return r; }), outcome(() => { var r; r = c44([undefined, 1]); return r; }), outcome(() => { var r; r = c44([revoked, 1]); return r; }), outcome(() => { var r; r = c44([inc, 1]); return r; }));
console.log("a tuple, last, in try:", outcome(() => { var r; r = c45([inc, 1]); return r; }), outcome(() => { var r; r = c45([proxied, 1]); return r; }), outcome(() => { var r; r = c45([undefined, 1]); return r; }), outcome(() => { var r; r = c45([revoked, 1]); return r; }), outcome(() => { var r; r = c45([inc, 1]); return r; }));
console.log("a tuple, not last:", outcome(() => { var r; r = c46([inc, 1]); return r; }), outcome(() => { var r; r = c46([proxied, 1]); return r; }), outcome(() => { var r; r = c46([undefined, 1]); return r; }), outcome(() => { var r; r = c46([revoked, 1]); return r; }), outcome(() => { var r; r = c46([inc, 1]); return r; }));
console.log("a tuple, not last, in try:", outcome(() => { var r; r = c47([inc, 1]); return r; }), outcome(() => { var r; r = c47([proxied, 1]); return r; }), outcome(() => { var r; r = c47([undefined, 1]); return r; }), outcome(() => { var r; r = c47([revoked, 1]); return r; }), outcome(() => { var r; r = c47([inc, 1]); return r; }));
console.log("a map, last:", outcome(() => { var r; r = c48(new Map([["k", inc]])); return r; }), outcome(() => { var r; r = c48(new Map([["k", proxied]])); return r; }), outcome(() => { var r; r = c48(new Map()); return r; }), outcome(() => { var r; r = c48(new Map([["k", revoked]])); return r; }), outcome(() => { var r; r = c48(new Map([["k", inc]])); return r; }));
console.log("a map, last, in try:", outcome(() => { var r; r = c49(new Map([["k", inc]])); return r; }), outcome(() => { var r; r = c49(new Map([["k", proxied]])); return r; }), outcome(() => { var r; r = c49(new Map()); return r; }), outcome(() => { var r; r = c49(new Map([["k", revoked]])); return r; }), outcome(() => { var r; r = c49(new Map([["k", inc]])); return r; }));
console.log("a map, not last:", outcome(() => { var r; r = c50(new Map([["k", inc]])); return r; }), outcome(() => { var r; r = c50(new Map([["k", proxied]])); return r; }), outcome(() => { var r; r = c50(new Map()); return r; }), outcome(() => { var r; r = c50(new Map([["k", revoked]])); return r; }), outcome(() => { var r; r = c50(new Map([["k", inc]])); return r; }));
console.log("a map, not last, in try:", outcome(() => { var r; r = c51(new Map([["k", inc]])); return r; }), outcome(() => { var r; r = c51(new Map([["k", proxied]])); return r; }), outcome(() => { var r; r = c51(new Map()); return r; }), outcome(() => { var r; r = c51(new Map([["k", revoked]])); return r; }), outcome(() => { var r; r = c51(new Map([["k", inc]])); return r; }));
console.log("a record by name, last:", outcome(() => { var r; r = c52({ k: inc }); return r; }), outcome(() => { var r; r = c52({ k: proxied }); return r; }), outcome(() => { var r; r = c52({ }); return r; }), outcome(() => { var r; r = c52({ k: revoked }); return r; }), outcome(() => { var r; r = c52({ k: inc }); return r; }));
console.log("a record by name, last, in try:", outcome(() => { var r; r = c53({ k: inc }); return r; }), outcome(() => { var r; r = c53({ k: proxied }); return r; }), outcome(() => { var r; r = c53({ }); return r; }), outcome(() => { var r; r = c53({ k: revoked }); return r; }), outcome(() => { var r; r = c53({ k: inc }); return r; }));
console.log("a record by name, not last:", outcome(() => { var r; r = c54({ k: inc }); return r; }), outcome(() => { var r; r = c54({ k: proxied }); return r; }), outcome(() => { var r; r = c54({ }); return r; }), outcome(() => { var r; r = c54({ k: revoked }); return r; }), outcome(() => { var r; r = c54({ k: inc }); return r; }));
console.log("a record by name, not last, in try:", outcome(() => { var r; r = c55({ k: inc }); return r; }), outcome(() => { var r; r = c55({ k: proxied }); return r; }), outcome(() => { var r; r = c55({ }); return r; }), outcome(() => { var r; r = c55({ k: revoked }); return r; }), outcome(() => { var r; r = c55({ k: inc }); return r; }));
console.log("a record by key, last:", outcome(() => { var r; r = c56({ k: inc }, "k"); return r; }), outcome(() => { var r; r = c56({ k: proxied }, "k"); return r; }), outcome(() => { var r; r = c56({ k: inc }, "other"); return r; }), outcome(() => { var r; r = c56({ k: revoked }, "k"); return r; }), outcome(() => { var r; r = c56({ k: inc }, "k"); return r; }));
console.log("a record by key, last, in try:", outcome(() => { var r; r = c57({ k: inc }, "k"); return r; }), outcome(() => { var r; r = c57({ k: proxied }, "k"); return r; }), outcome(() => { var r; r = c57({ k: inc }, "other"); return r; }), outcome(() => { var r; r = c57({ k: revoked }, "k"); return r; }), outcome(() => { var r; r = c57({ k: inc }, "k"); return r; }));
console.log("a record by key, not last:", outcome(() => { var r; r = c58({ k: inc }, "k"); return r; }), outcome(() => { var r; r = c58({ k: proxied }, "k"); return r; }), outcome(() => { var r; r = c58({ k: inc }, "other"); return r; }), outcome(() => { var r; r = c58({ k: revoked }, "k"); return r; }), outcome(() => { var r; r = c58({ k: inc }, "k"); return r; }));
console.log("a record by key, not last, in try:", outcome(() => { var r; r = c59({ k: inc }, "k"); return r; }), outcome(() => { var r; r = c59({ k: proxied }, "k"); return r; }), outcome(() => { var r; r = c59({ k: inc }, "other"); return r; }), outcome(() => { var r; r = c59({ k: revoked }, "k"); return r; }), outcome(() => { var r; r = c59({ k: inc }, "k"); return r; }));
console.log("an array of functions or null, last:", outcome(() => { var r; r = c60([inc], 0); return r; }), outcome(() => { var r; r = c60([proxied], 0); return r; }), outcome(() => { var r; r = c60([null], 0); return r; }), outcome(() => { var r; r = c60([revoked], 0); return r; }), outcome(() => { var r; r = c60([inc], 0); return r; }));
console.log("an array of functions or null, last, in try:", outcome(() => { var r; r = c61([inc], 0); return r; }), outcome(() => { var r; r = c61([proxied], 0); return r; }), outcome(() => { var r; r = c61([null], 0); return r; }), outcome(() => { var r; r = c61([revoked], 0); return r; }), outcome(() => { var r; r = c61([inc], 0); return r; }));
console.log("an array of functions or null, not last:", outcome(() => { var r; r = c62([inc], 0); return r; }), outcome(() => { var r; r = c62([proxied], 0); return r; }), outcome(() => { var r; r = c62([null], 0); return r; }), outcome(() => { var r; r = c62([revoked], 0); return r; }), outcome(() => { var r; r = c62([inc], 0); return r; }));
console.log("an array of functions or null, not last, in try:", outcome(() => { var r; r = c63([inc], 0); return r; }), outcome(() => { var r; r = c63([proxied], 0); return r; }), outcome(() => { var r; r = c63([null], 0); return r; }), outcome(() => { var r; r = c63([revoked], 0); return r; }), outcome(() => { var r; r = c63([inc], 0); return r; }));
console.log("past the end of an array, last:", outcome(() => { var r; r = c64([inc], 0); return r; }), outcome(() => { var r; r = c64([proxied], 0); return r; }), outcome(() => { var r; r = c64([inc], 1); return r; }), outcome(() => { var r; r = c64([revoked], 0); return r; }), outcome(() => { var r; r = c64([inc], 0); return r; }));
console.log("past the end of an array, last, in try:", outcome(() => { var r; r = c65([inc], 0); return r; }), outcome(() => { var r; r = c65([proxied], 0); return r; }), outcome(() => { var r; r = c65([inc], 1); return r; }), outcome(() => { var r; r = c65([revoked], 0); return r; }), outcome(() => { var r; r = c65([inc], 0); return r; }));
console.log("past the end of an array, not last:", outcome(() => { var r; r = c66([inc], 0); return r; }), outcome(() => { var r; r = c66([proxied], 0); return r; }), outcome(() => { var r; r = c66([inc], 1); return r; }), outcome(() => { var r; r = c66([revoked], 0); return r; }), outcome(() => { var r; r = c66([inc], 0); return r; }));
console.log("past the end of an array, not last, in try:", outcome(() => { var r; r = c67([inc], 0); return r; }), outcome(() => { var r; r = c67([proxied], 0); return r; }), outcome(() => { var r; r = c67([inc], 1); return r; }), outcome(() => { var r; r = c67([revoked], 0); return r; }), outcome(() => { var r; r = c67([inc], 0); return r; }));
console.log("a hole of an array, last:", outcome(() => { var r; r = c68([inc, , inc], 2); return r; }), outcome(() => { var r; r = c68([proxied, , proxied], 2); return r; }), outcome(() => { var r; r = c68([inc, , inc], 1); return r; }), outcome(() => { var r; r = c68([revoked, , revoked], 2); return r; }), outcome(() => { var r; r = c68([inc, , inc], 2); return r; }));
console.log("a hole of an array, last, in try:", outcome(() => { var r; r = c69([inc, , inc], 2); return r; }), outcome(() => { var r; r = c69([proxied, , proxied], 2); return r; }), outcome(() => { var r; r = c69([inc, , inc], 1); return r; }), outcome(() => { var r; r = c69([revoked, , revoked], 2); return r; }), outcome(() => { var r; r = c69([inc, , inc], 2); return r; }));
console.log("a hole of an array, not last:", outcome(() => { var r; r = c70([inc, , inc], 2); return r; }), outcome(() => { var r; r = c70([proxied, , proxied], 2); return r; }), outcome(() => { var r; r = c70([inc, , inc], 1); return r; }), outcome(() => { var r; r = c70([revoked, , revoked], 2); return r; }), outcome(() => { var r; r = c70([inc, , inc], 2); return r; }));
console.log("a hole of an array, not last, in try:", outcome(() => { var r; r = c71([inc, , inc], 2); return r; }), outcome(() => { var r; r = c71([proxied, , proxied], 2); return r; }), outcome(() => { var r; r = c71([inc, , inc], 1); return r; }), outcome(() => { var r; r = c71([revoked, , revoked], 2); return r; }), outcome(() => { var r; r = c71([inc, , inc], 2); return r; }));
console.log("either arm of ?:, last:", outcome(() => { var r; r = c72(true, { first: inc, second: inc }) + c72(false, { first: inc, second: inc }); return r; }), outcome(() => { var r; r = c72(true, { first: proxied, second: proxied }) + c72(false, { first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c72(true, { second: inc }); return r; }), outcome(() => { var r; r = c72(true, { first: revoked, second: revoked }) + c72(false, { first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c72(true, { first: inc, second: inc }) + c72(false, { first: inc, second: inc }); return r; }));
console.log("either arm of ?:, last, in try:", outcome(() => { var r; r = c73(true, { first: inc, second: inc }) + c73(false, { first: inc, second: inc }); return r; }), outcome(() => { var r; r = c73(true, { first: proxied, second: proxied }) + c73(false, { first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c73(true, { second: inc }); return r; }), outcome(() => { var r; r = c73(true, { first: revoked, second: revoked }) + c73(false, { first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c73(true, { first: inc, second: inc }) + c73(false, { first: inc, second: inc }); return r; }));
console.log("either arm of ?:, not last:", outcome(() => { var r; r = c74(true, { first: inc, second: inc }) + c74(false, { first: inc, second: inc }); return r; }), outcome(() => { var r; r = c74(true, { first: proxied, second: proxied }) + c74(false, { first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c74(true, { second: inc }); return r; }), outcome(() => { var r; r = c74(true, { first: revoked, second: revoked }) + c74(false, { first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c74(true, { first: inc, second: inc }) + c74(false, { first: inc, second: inc }); return r; }));
console.log("either arm of ?:, not last, in try:", outcome(() => { var r; r = c75(true, { first: inc, second: inc }) + c75(false, { first: inc, second: inc }); return r; }), outcome(() => { var r; r = c75(true, { first: proxied, second: proxied }) + c75(false, { first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c75(true, { second: inc }); return r; }), outcome(() => { var r; r = c75(true, { first: revoked, second: revoked }) + c75(false, { first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c75(true, { first: inc, second: inc }) + c75(false, { first: inc, second: inc }); return r; }));
console.log("the other arm of ?:, last:", outcome(() => { var r; r = c76(false, { first: inc, second: inc }); return r; }), outcome(() => { var r; r = c76(false, { first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c76(false, { first: inc, second: null }); return r; }), outcome(() => { var r; r = c76(false, { first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c76(false, { first: inc, second: inc }); return r; }));
console.log("the other arm of ?:, last, in try:", outcome(() => { var r; r = c77(false, { first: inc, second: inc }); return r; }), outcome(() => { var r; r = c77(false, { first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c77(false, { first: inc, second: null }); return r; }), outcome(() => { var r; r = c77(false, { first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c77(false, { first: inc, second: inc }); return r; }));
console.log("the other arm of ?:, not last:", outcome(() => { var r; r = c78(false, { first: inc, second: inc }); return r; }), outcome(() => { var r; r = c78(false, { first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c78(false, { first: inc, second: null }); return r; }), outcome(() => { var r; r = c78(false, { first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c78(false, { first: inc, second: inc }); return r; }));
console.log("the other arm of ?:, not last, in try:", outcome(() => { var r; r = c79(false, { first: inc, second: inc }); return r; }), outcome(() => { var r; r = c79(false, { first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c79(false, { first: inc, second: null }); return r; }), outcome(() => { var r; r = c79(false, { first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c79(false, { first: inc, second: inc }); return r; }));
console.log("joined by ??, last:", outcome(() => { var r; r = c80({ second: inc }); return r; }), outcome(() => { var r; r = c80({ second: proxied }); return r; }), outcome(() => { var r; r = c80({ second: null }); return r; }), outcome(() => { var r; r = c80({ second: revoked }); return r; }), outcome(() => { var r; r = c80({ second: inc }); return r; }));
console.log("joined by ??, last, in try:", outcome(() => { var r; r = c81({ second: inc }); return r; }), outcome(() => { var r; r = c81({ second: proxied }); return r; }), outcome(() => { var r; r = c81({ second: null }); return r; }), outcome(() => { var r; r = c81({ second: revoked }); return r; }), outcome(() => { var r; r = c81({ second: inc }); return r; }));
console.log("joined by ??, not last:", outcome(() => { var r; r = c82({ second: inc }); return r; }), outcome(() => { var r; r = c82({ second: proxied }); return r; }), outcome(() => { var r; r = c82({ second: null }); return r; }), outcome(() => { var r; r = c82({ second: revoked }); return r; }), outcome(() => { var r; r = c82({ second: inc }); return r; }));
console.log("joined by ??, not last, in try:", outcome(() => { var r; r = c83({ second: inc }); return r; }), outcome(() => { var r; r = c83({ second: proxied }); return r; }), outcome(() => { var r; r = c83({ second: null }); return r; }), outcome(() => { var r; r = c83({ second: revoked }); return r; }), outcome(() => { var r; r = c83({ second: inc }); return r; }));
console.log("joined by ||, last:", outcome(() => { var r; r = c84({ second: inc }); return r; }), outcome(() => { var r; r = c84({ second: proxied }); return r; }), outcome(() => { var r; r = c84({ second: null }); return r; }), outcome(() => { var r; r = c84({ second: revoked }); return r; }), outcome(() => { var r; r = c84({ second: inc }); return r; }));
console.log("joined by ||, last, in try:", outcome(() => { var r; r = c85({ second: inc }); return r; }), outcome(() => { var r; r = c85({ second: proxied }); return r; }), outcome(() => { var r; r = c85({ second: null }); return r; }), outcome(() => { var r; r = c85({ second: revoked }); return r; }), outcome(() => { var r; r = c85({ second: inc }); return r; }));
console.log("joined by ||, not last:", outcome(() => { var r; r = c86({ second: inc }); return r; }), outcome(() => { var r; r = c86({ second: proxied }); return r; }), outcome(() => { var r; r = c86({ second: null }); return r; }), outcome(() => { var r; r = c86({ second: revoked }); return r; }), outcome(() => { var r; r = c86({ second: inc }); return r; }));
console.log("joined by ||, not last, in try:", outcome(() => { var r; r = c87({ second: inc }); return r; }), outcome(() => { var r; r = c87({ second: proxied }); return r; }), outcome(() => { var r; r = c87({ second: null }); return r; }), outcome(() => { var r; r = c87({ second: revoked }); return r; }), outcome(() => { var r; r = c87({ second: inc }); return r; }));
console.log("joined by &&, last:", outcome(() => { var r; r = c88({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c88({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c88({ second: inc }); return r; }), outcome(() => { var r; r = c88({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c88({ first: inc, second: inc }); return r; }));
console.log("joined by &&, last, in try:", outcome(() => { var r; r = c89({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c89({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c89({ second: inc }); return r; }), outcome(() => { var r; r = c89({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c89({ first: inc, second: inc }); return r; }));
console.log("joined by &&, not last:", outcome(() => { var r; r = c90({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c90({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c90({ second: inc }); return r; }), outcome(() => { var r; r = c90({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c90({ first: inc, second: inc }); return r; }));
console.log("joined by &&, not last, in try:", outcome(() => { var r; r = c91({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c91({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c91({ second: inc }); return r; }), outcome(() => { var r; r = c91({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c91({ first: inc, second: inc }); return r; }));
console.log("destructured, last:", outcome(() => { var r; r = c92({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c92({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c92({ second: null }); return r; }), outcome(() => { var r; r = c92({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c92({ first: inc, second: inc }); return r; }));
console.log("destructured, last, in try:", outcome(() => { var r; r = c93({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c93({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c93({ second: null }); return r; }), outcome(() => { var r; r = c93({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c93({ first: inc, second: inc }); return r; }));
console.log("destructured, not last:", outcome(() => { var r; r = c94({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c94({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c94({ second: null }); return r; }), outcome(() => { var r; r = c94({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c94({ first: inc, second: inc }); return r; }));
console.log("destructured, not last, in try:", outcome(() => { var r; r = c95({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c95({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c95({ second: null }); return r; }), outcome(() => { var r; r = c95({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c95({ first: inc, second: inc }); return r; }));
console.log("destructured with a default, last:", outcome(() => { var r; r = c96({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c96({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c96({ second: null }); return r; }), outcome(() => { var r; r = c96({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c96({ first: inc, second: inc }); return r; }));
console.log("destructured with a default, last, in try:", outcome(() => { var r; r = c97({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c97({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c97({ second: null }); return r; }), outcome(() => { var r; r = c97({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c97({ first: inc, second: inc }); return r; }));
console.log("destructured with a default, not last:", outcome(() => { var r; r = c98({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c98({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c98({ second: null }); return r; }), outcome(() => { var r; r = c98({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c98({ first: inc, second: inc }); return r; }));
console.log("destructured with a default, not last, in try:", outcome(() => { var r; r = c99({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c99({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c99({ second: null }); return r; }), outcome(() => { var r; r = c99({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c99({ first: inc, second: inc }); return r; }));
console.log("a parameter with a default, last:", outcome(() => { var r; r = c100(inc); return r; }), outcome(() => { var r; r = c100(proxied); return r; }), outcome(() => { var r; r = c100(); return r; }), outcome(() => { var r; r = c100(revoked); return r; }), outcome(() => { var r; r = c100(inc); return r; }));
console.log("a parameter with a default, last, in try:", outcome(() => { var r; r = c101(inc); return r; }), outcome(() => { var r; r = c101(proxied); return r; }), outcome(() => { var r; r = c101(); return r; }), outcome(() => { var r; r = c101(revoked); return r; }), outcome(() => { var r; r = c101(inc); return r; }));
console.log("a parameter with a default, not last:", outcome(() => { var r; r = c102(inc); return r; }), outcome(() => { var r; r = c102(proxied); return r; }), outcome(() => { var r; r = c102(); return r; }), outcome(() => { var r; r = c102(revoked); return r; }), outcome(() => { var r; r = c102(inc); return r; }));
console.log("a parameter with a default, not last, in try:", outcome(() => { var r; r = c103(inc); return r; }), outcome(() => { var r; r = c103(proxied); return r; }), outcome(() => { var r; r = c103(); return r; }), outcome(() => { var r; r = c103(revoked); return r; }), outcome(() => { var r; r = c103(inc); return r; }));
console.log("a rest parameter, last:", outcome(() => { var r; r = c104(inc); return r; }), outcome(() => { var r; r = c104(proxied); return r; }), outcome(() => { var r; r = c104(); return r; }), outcome(() => { var r; r = c104(revoked); return r; }), outcome(() => { var r; r = c104(inc); return r; }));
console.log("a rest parameter, last, in try:", outcome(() => { var r; r = c105(inc); return r; }), outcome(() => { var r; r = c105(proxied); return r; }), outcome(() => { var r; r = c105(); return r; }), outcome(() => { var r; r = c105(revoked); return r; }), outcome(() => { var r; r = c105(inc); return r; }));
console.log("a rest parameter, not last:", outcome(() => { var r; r = c106(inc); return r; }), outcome(() => { var r; r = c106(proxied); return r; }), outcome(() => { var r; r = c106(); return r; }), outcome(() => { var r; r = c106(revoked); return r; }), outcome(() => { var r; r = c106(inc); return r; }));
console.log("a rest parameter, not last, in try:", outcome(() => { var r; r = c107(inc); return r; }), outcome(() => { var r; r = c107(proxied); return r; }), outcome(() => { var r; r = c107(); return r; }), outcome(() => { var r; r = c107(revoked); return r; }), outcome(() => { var r; r = c107(inc); return r; }));
console.log("nested records, last:", outcome(() => { var r; r = c108({ inner: { first: inc, second: inc } }); return r; }), outcome(() => { var r; r = c108({ inner: { first: proxied, second: proxied } }); return r; }), outcome(() => { var r; r = c108({ inner: { second: null } }); return r; }), outcome(() => { var r; r = c108({ inner: { first: revoked, second: revoked } }); return r; }), outcome(() => { var r; r = c108({ inner: { first: inc, second: inc } }); return r; }));
console.log("nested records, last, in try:", outcome(() => { var r; r = c109({ inner: { first: inc, second: inc } }); return r; }), outcome(() => { var r; r = c109({ inner: { first: proxied, second: proxied } }); return r; }), outcome(() => { var r; r = c109({ inner: { second: null } }); return r; }), outcome(() => { var r; r = c109({ inner: { first: revoked, second: revoked } }); return r; }), outcome(() => { var r; r = c109({ inner: { first: inc, second: inc } }); return r; }));
console.log("nested records, not last:", outcome(() => { var r; r = c110({ inner: { first: inc, second: inc } }); return r; }), outcome(() => { var r; r = c110({ inner: { first: proxied, second: proxied } }); return r; }), outcome(() => { var r; r = c110({ inner: { second: null } }); return r; }), outcome(() => { var r; r = c110({ inner: { first: revoked, second: revoked } }); return r; }), outcome(() => { var r; r = c110({ inner: { first: inc, second: inc } }); return r; }));
console.log("nested records, not last, in try:", outcome(() => { var r; r = c111({ inner: { first: inc, second: inc } }); return r; }), outcome(() => { var r; r = c111({ inner: { first: proxied, second: proxied } }); return r; }), outcome(() => { var r; r = c111({ inner: { second: null } }); return r; }), outcome(() => { var r; r = c111({ inner: { first: revoked, second: revoked } }); return r; }), outcome(() => { var r; r = c111({ inner: { first: inc, second: inc } }); return r; }));
console.log("behind a comma, last:", outcome(() => { var r; r = c112({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c112({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c112({ second: null }); return r; }), outcome(() => { var r; r = c112({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c112({ first: inc, second: inc }); return r; }));
console.log("behind a comma, last, in try:", outcome(() => { var r; r = c113({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c113({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c113({ second: null }); return r; }), outcome(() => { var r; r = c113({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c113({ first: inc, second: inc }); return r; }));
console.log("behind a comma, not last:", outcome(() => { var r; r = c114({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c114({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c114({ second: null }); return r; }), outcome(() => { var r; r = c114({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c114({ first: inc, second: inc }); return r; }));
console.log("behind a comma, not last, in try:", outcome(() => { var r; r = c115({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c115({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c115({ second: null }); return r; }), outcome(() => { var r; r = c115({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c115({ first: inc, second: inc }); return r; }));
console.log("assigned on the way, last:", outcome(() => { var r; r = c116({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c116({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c116({ second: null }); return r; }), outcome(() => { var r; r = c116({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c116({ first: inc, second: inc }); return r; }));
console.log("assigned on the way, last, in try:", outcome(() => { var r; r = c117({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c117({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c117({ second: null }); return r; }), outcome(() => { var r; r = c117({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c117({ first: inc, second: inc }); return r; }));
console.log("assigned on the way, not last:", outcome(() => { var r; r = c118({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c118({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c118({ second: null }); return r; }), outcome(() => { var r; r = c118({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c118({ first: inc, second: inc }); return r; }));
console.log("assigned on the way, not last, in try:", outcome(() => { var r; r = c119({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c119({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c119({ second: null }); return r; }), outcome(() => { var r; r = c119({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c119({ first: inc, second: inc }); return r; }));
console.log("by call, last:", outcome(() => { var r; r = c120({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c120({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c120({ second: null }); return r; }), outcome(() => { var r; r = c120({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c120({ first: inc, second: inc }); return r; }));
console.log("by call, last, in try:", outcome(() => { var r; r = c121({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c121({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c121({ second: null }); return r; }), outcome(() => { var r; r = c121({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c121({ first: inc, second: inc }); return r; }));
console.log("by call, not last:", outcome(() => { var r; r = c122({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c122({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c122({ second: null }); return r; }), outcome(() => { var r; r = c122({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c122({ first: inc, second: inc }); return r; }));
console.log("by call, not last, in try:", outcome(() => { var r; r = c123({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c123({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c123({ second: null }); return r; }), outcome(() => { var r; r = c123({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c123({ first: inc, second: inc }); return r; }));
console.log("by apply, last:", outcome(() => { var r; r = c124({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c124({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c124({ second: null }); return r; }), outcome(() => { var r; r = c124({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c124({ first: inc, second: inc }); return r; }));
console.log("by apply, last, in try:", outcome(() => { var r; r = c125({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c125({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c125({ second: null }); return r; }), outcome(() => { var r; r = c125({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c125({ first: inc, second: inc }); return r; }));
console.log("by apply, not last:", outcome(() => { var r; r = c126({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c126({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c126({ second: null }); return r; }), outcome(() => { var r; r = c126({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c126({ first: inc, second: inc }); return r; }));
console.log("by apply, not last, in try:", outcome(() => { var r; r = c127({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c127({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c127({ second: null }); return r; }), outcome(() => { var r; r = c127({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c127({ first: inc, second: inc }); return r; }));
console.log("by Reflect.apply, last:", outcome(() => { var r; r = c128({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c128({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c128({ second: null }); return r; }), outcome(() => { var r; r = c128({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c128({ first: inc, second: inc }); return r; }));
console.log("by Reflect.apply, last, in try:", outcome(() => { var r; r = c129({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c129({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c129({ second: null }); return r; }), outcome(() => { var r; r = c129({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c129({ first: inc, second: inc }); return r; }));
console.log("by Reflect.apply, not last:", outcome(() => { var r; r = c130({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c130({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c130({ second: null }); return r; }), outcome(() => { var r; r = c130({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c130({ first: inc, second: inc }); return r; }));
console.log("by Reflect.apply, not last, in try:", outcome(() => { var r; r = c131({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c131({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c131({ second: null }); return r; }), outcome(() => { var r; r = c131({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c131({ first: inc, second: inc }); return r; }));
console.log("a tag of a template, last:", outcome(() => { var r; r = c132({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c132({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c132({ }); return r; }), outcome(() => { var r; r = c132({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c132({ tag: s => s.length }); return r; }));
console.log("a tag of a template, last, in try:", outcome(() => { var r; r = c133({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c133({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c133({ }); return r; }), outcome(() => { var r; r = c133({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c133({ tag: s => s.length }); return r; }));
console.log("a tag of a template, not last:", outcome(() => { var r; r = c134({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c134({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c134({ }); return r; }), outcome(() => { var r; r = c134({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c134({ tag: s => s.length }); return r; }));
console.log("a tag of a template, not last, in try:", outcome(() => { var r; r = c135({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c135({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c135({ }); return r; }), outcome(() => { var r; r = c135({ tag: s => s.length }); return r; }), outcome(() => { var r; r = c135({ tag: s => s.length }); return r; }));
console.log("an optional call, last:", outcome(() => { var r; r = c136({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c136({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c136({ second: null }); return r; }), outcome(() => { var r; r = c136({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c136({ first: inc, second: inc }); return r; }));
console.log("an optional call, last, in try:", outcome(() => { var r; r = c137({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c137({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c137({ second: null }); return r; }), outcome(() => { var r; r = c137({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c137({ first: inc, second: inc }); return r; }));
console.log("an optional call, not last:", outcome(() => { var r; r = c138({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c138({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c138({ second: null }); return r; }), outcome(() => { var r; r = c138({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c138({ first: inc, second: inc }); return r; }));
console.log("an optional call, not last, in try:", outcome(() => { var r; r = c139({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c139({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c139({ second: null }); return r; }), outcome(() => { var r; r = c139({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c139({ first: inc, second: inc }); return r; }));
console.log("an optional call of null, last:", outcome(() => { var r; r = c140({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c140({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c140({ second: null }); return r; }), outcome(() => { var r; r = c140({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c140({ first: inc, second: inc }); return r; }));
console.log("an optional call of null, last, in try:", outcome(() => { var r; r = c141({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c141({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c141({ second: null }); return r; }), outcome(() => { var r; r = c141({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c141({ first: inc, second: inc }); return r; }));
console.log("an optional call of null, not last:", outcome(() => { var r; r = c142({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c142({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c142({ second: null }); return r; }), outcome(() => { var r; r = c142({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c142({ first: inc, second: inc }); return r; }));
console.log("an optional call of null, not last, in try:", outcome(() => { var r; r = c143({ first: inc, second: inc }); return r; }), outcome(() => { var r; r = c143({ first: proxied, second: proxied }); return r; }), outcome(() => { var r; r = c143({ second: null }); return r; }), outcome(() => { var r; r = c143({ first: revoked, second: revoked }); return r; }), outcome(() => { var r; r = c143({ first: inc, second: inc }); return r; }));
console.log("the result of a call of nothing, last:", outcome(() => { var r; r = c144({ make: () => inc }); return r; }), outcome(() => { var r; r = c144({ make: () => proxied }); return r; }), outcome(() => { var r; r = c144({ }); return r; }), outcome(() => { var r; r = c144({ make: () => revoked }); return r; }), outcome(() => { var r; r = c144({ make: () => inc }); return r; }));
console.log("the result of a call of nothing, last, in try:", outcome(() => { var r; r = c145({ make: () => inc }); return r; }), outcome(() => { var r; r = c145({ make: () => proxied }); return r; }), outcome(() => { var r; r = c145({ }); return r; }), outcome(() => { var r; r = c145({ make: () => revoked }); return r; }), outcome(() => { var r; r = c145({ make: () => inc }); return r; }));
console.log("the result of a call of nothing, not last:", outcome(() => { var r; r = c146({ make: () => inc }); return r; }), outcome(() => { var r; r = c146({ make: () => proxied }); return r; }), outcome(() => { var r; r = c146({ }); return r; }), outcome(() => { var r; r = c146({ make: () => revoked }); return r; }), outcome(() => { var r; r = c146({ make: () => inc }); return r; }));
console.log("the result of a call of nothing, not last, in try:", outcome(() => { var r; r = c147({ make: () => inc }); return r; }), outcome(() => { var r; r = c147({ make: () => proxied }); return r; }), outcome(() => { var r; r = c147({ }); return r; }), outcome(() => { var r; r = c147({ make: () => revoked }); return r; }), outcome(() => { var r; r = c147({ make: () => inc }); return r; }));
console.log("a method of a record, last:", outcome(() => { var r; r = c148({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c148({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c148({ }); return r; }), outcome(() => { var r; r = c148({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c148({ method(x: number) { return x + 1; } }); return r; }));
console.log("a method of a record, last, in try:", outcome(() => { var r; r = c149({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c149({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c149({ }); return r; }), outcome(() => { var r; r = c149({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c149({ method(x: number) { return x + 1; } }); return r; }));
console.log("a method of a record, not last:", outcome(() => { var r; r = c150({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c150({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c150({ }); return r; }), outcome(() => { var r; r = c150({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c150({ method(x: number) { return x + 1; } }); return r; }));
console.log("a method of a record, not last, in try:", outcome(() => { var r; r = c151({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c151({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c151({ }); return r; }), outcome(() => { var r; r = c151({ method(x: number) { return x + 1; } }); return r; }), outcome(() => { var r; r = c151({ method(x: number) { return x + 1; } }); return r; }));
console.log("in a switch, last:", outcome(() => { var r; r = c152({ first: inc, second: inc }, 1) + c152({ first: inc, second: inc }, 2); return r; }), outcome(() => { var r; r = c152({ first: proxied, second: proxied }, 1) + c152({ first: proxied, second: proxied }, 2); return r; }), outcome(() => { var r; r = c152({ second: null }, 1); return r; }), outcome(() => { var r; r = c152({ first: revoked, second: revoked }, 1) + c152({ first: revoked, second: revoked }, 2); return r; }), outcome(() => { var r; r = c152({ first: inc, second: inc }, 1) + c152({ first: inc, second: inc }, 2); return r; }));
console.log("in a switch, last, in try:", outcome(() => { var r; r = c153({ first: inc, second: inc }, 1) + c153({ first: inc, second: inc }, 2); return r; }), outcome(() => { var r; r = c153({ first: proxied, second: proxied }, 1) + c153({ first: proxied, second: proxied }, 2); return r; }), outcome(() => { var r; r = c153({ second: null }, 1); return r; }), outcome(() => { var r; r = c153({ first: revoked, second: revoked }, 1) + c153({ first: revoked, second: revoked }, 2); return r; }), outcome(() => { var r; r = c153({ first: inc, second: inc }, 1) + c153({ first: inc, second: inc }, 2); return r; }));
console.log("in a switch, not last:", outcome(() => { var r; r = c154({ first: inc, second: inc }, 1) + c154({ first: inc, second: inc }, 2); return r; }), outcome(() => { var r; r = c154({ first: proxied, second: proxied }, 1) + c154({ first: proxied, second: proxied }, 2); return r; }), outcome(() => { var r; r = c154({ second: null }, 1); return r; }), outcome(() => { var r; r = c154({ first: revoked, second: revoked }, 1) + c154({ first: revoked, second: revoked }, 2); return r; }), outcome(() => { var r; r = c154({ first: inc, second: inc }, 1) + c154({ first: inc, second: inc }, 2); return r; }));
console.log("in a switch, not last, in try:", outcome(() => { var r; r = c155({ first: inc, second: inc }, 1) + c155({ first: inc, second: inc }, 2); return r; }), outcome(() => { var r; r = c155({ first: proxied, second: proxied }, 1) + c155({ first: proxied, second: proxied }, 2); return r; }), outcome(() => { var r; r = c155({ second: null }, 1); return r; }), outcome(() => { var r; r = c155({ first: revoked, second: revoked }, 1) + c155({ first: revoked, second: revoked }, 2); return r; }), outcome(() => { var r; r = c155({ first: inc, second: inc }, 1) + c155({ first: inc, second: inc }, 2); return r; }));

// GENERATED: c93 c128 c132 c8 Heir c24
// CHECK-LABEL: function {{*}}name="c93"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="first"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="first"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_4]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Call v6, -, v7 calleeName="first"
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b6() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="TypeError" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v14 = InstanceOf v10, v13 writtenExpression="e instanceof TypeError"
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v16):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v17 = Integer integer=-1
// CHECK-NEXT: Jump -> next b11(v17)
// CHECK-NEXT: b9(v18):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v19 = Integer integer=-2
// CHECK-NEXT: Jump -> next b11(v19)
// CHECK-NEXT: b11(v20):
// CHECK-NEXT: v21 = Convert v20 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c128"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Reflect
// CHECK-NEXT: v2 = Builtin builtin=ReflectApply
// CHECK-NEXT: v3 = PropGet v0 key="first"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: v5 = Data data=[[d_8]]
// CHECK-NEXT: v6 = Call v2, v1, v3, v4, v5 calleeName="Reflect.apply"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=number site=[[w_9]]}}, {declared={type=number site=[[w_7]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c132"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_10]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="tag"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_12]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = NewTemplateObject templateStrings=[{cooked="x" raw="x"}]
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="tag" calleeName="t.tag"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=number site=[[w_13]]}}, {declared={type=number site=[[w_11]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c8"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_14]] site=[[w_15]]} results=[{type=number site=[[w_16]]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: [[L_14]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_14]] field=3
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeName="this.#hidden"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=number site=[[w_19]]}}, {declared={type=number site=[[w_16]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_20]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_21]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_21]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c24"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_21]] site=[[w_22]]} results=[{type=number site=[[w_23]]}] {
// CHECK-NEXT: b0(v0: [[L_21]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_24]]
// CHECK-NEXT: v2 = GetSuperBase v1 homeKind=ClassPrototype
// CHECK-NEXT: v3 = SuperGet v2, v0 key="got"
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Call v3, v0, v4 calleeName="super.got"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=number site=[[w_25]]}}, {declared={type=number site=[[w_23]]}}]
// CHECK-NEXT: }
