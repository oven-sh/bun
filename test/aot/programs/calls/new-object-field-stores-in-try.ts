// Field stores inside `try` into a new object, before and after other code has seen the object.
declare const console: any;
class C { x: number; y: string; z = 0; w?: number; constructor(x: number, y: string) { this.x = x; this.y = y; } }
class S { _v = 0; sets = 0; set v(n: number) { this.sets++; if (n < 0) throw new RangeError("negative"); this._v = n; } get v(): number { return this._v; } }
class D extends C { d: number; constructor(x: number) { super(x, "d"); this.d = x; } }
// An object of a class may be frozen, given an accessor or given another prototype by any code, as in plain JavaScript: the store that follows answers as the language says.
const O = Object; const kept: C[] = [];
function freeze(o: C): void { O.freeze(o); }
function trap(o: C, name: string): void { O.defineProperty(o, name, { set(v: unknown) { throw new EvalError("trap " + name + " " + v); }, get() { return -1; }, configurable: true }); }
function nothing(o: unknown): void { kept.length = 0; }
function name(e: any): string { return e.constructor.name + (e instanceof EvalError || e instanceof RangeError ? ":" + e.message : ""); }
function frozenByACall(a: number): string { try { const c = new C(a, "f"); freeze(c); c.z = a; return "stored " + c.z; } catch (e) { return name(e); } }
function frozenInline(a: number): string { try { const c = new C(a, "f"); O.freeze(c); c.z = a; return "stored " + c.z; } catch (e) { return name(e); } }
function trapped(a: number): string { try { const c = new C(a, "t"); trap(c, "z"); c.z = a; return "stored " + c.z; } catch (e) { return name(e); } }
function throughAGlobal(a: number): string { try { const c = new C(a, "g"); kept.push(c); O.freeze(kept[kept.length - 1]); c.x = a + 1; return "stored " + c.x; } catch (e) { return name(e); } }
function throughAClosure(a: number): string { try { const c = new C(a, "c"); const f = () => { O.freeze(c); }; f(); c.y = "n"; return "stored " + c.y; } catch (e) { return name(e); } }
function throughAClosureLater(a: number, run: (f: () => void) => void): string { try { const c = new C(a, "c"); run(() => { O.freeze(c); }); c.y = "n"; return "stored " + c.y; } catch (e) { return name(e); } }
function throughAJoin(a: number, other: C): string { try { const c = a & 1 ? new C(a, "j") : other; c.z = a; return "stored " + c.z; } catch (e) { return name(e); } }
function onOneWay(a: number): string { try { const c = new C(a, "o"); if (a & 1) freeze(c); c.z = a; return "stored " + c.z; } catch (e) { return name(e); } }
function notExtensible(a: number): string { try { const c = new C(a, "e"); O.preventExtensions(c); c.w = a; return "stored " + c.w; } catch (e) { return name(e); } }
function otherPrototype(a: number): string { try { const c = new C(a, "p"); O.setPrototypeOf(c, { set w(v: number) { throw new EvalError("proto " + v); } }); c.w = a; return "stored " + c.w; } catch (e) { return name(e); } }
function setter(a: number): string { try { const s = new S(); s.v = a; return "stored " + s.v + " " + s.sets; } catch (e) { return name(e); } }
function asItsOwnValue(a: number): string { try { const o: { self: unknown; n: number } = { self: undefined, n: a }; o.self = o; O.freeze(o.self as { self: unknown; n: number }); o.n = a + 1; return "stored " + o.n; } catch (e) { return name(e); } }
function inALoop(n: number): string { let out = ""; let before: C | undefined; for (let i = 0; i < n; i++) { try { const c = new C(i, "l"); if (before) before.z = i; c.z = i; if (i & 1) freeze(c); before = c; out += c.z; } catch (e) { out += name(e)[0]; before = undefined; } } return out; }
function inTheHandler(a: number): string { const c = new C(a, "h"); try { freeze(c); throw 1; } catch (e) { try { c.z = a; return "stored"; } catch (e2) { return name(e2); } } }
function derived(a: number): string { try { const d = new D(a); freeze(d); d.d = a + 1; return "stored " + d.d; } catch (e) { return name(e); } }
function seenByTheConstructor(a: number): string { class K { v = 0; constructor() { O.freeze(this); } } try { const k = new K(); k.v = a; return "stored " + k.v; } catch (e) { return name(e); } }
function wrongType(a: unknown): string { try { const c = new C(1, "w"); c.z = a as number; return "stored " + typeof c.z; } catch (e) { return name(e); } }
// Nothing else has seen these objects: the stores are plain stores.
function unseen(a: number): string { try { const c = new C(a, "u"); nothing(a); c.z = a; c.w = a + 1; const d = new D(a); d.z = c.z + 1; return "stored " + c.z + c.w + d.z + d.d + O.keys(c).join("") + O.keys(d).join(""); } catch (e) { return name(e); } }
for (let round = 0; round < 3; round++) {
  const frozen = new C(0, "frozen"); freeze(frozen);
  console.log(frozenByACall(1), frozenInline(2), trapped(3), throughAGlobal(4), throughAClosure(5), throughAClosureLater(6, f => f()), throughAClosureLater(7, () => {}));
  console.log(throughAJoin(1, frozen), throughAJoin(2, frozen), throughAJoin(2, new C(9, "n")), onOneWay(1), onOneWay(2), notExtensible(3), otherPrototype(4), setter(5), setter(-5), asItsOwnValue(6));
  console.log(inALoop(6), inTheHandler(1), derived(2), seenByTheConstructor(3), wrongType(4), wrongType("s"), unseen(5));
}
export {};
