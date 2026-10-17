// `new C(..)` inside `try`: the inlined constructor's field stores cannot throw and need no exception handling.
// IR= 0 construct Invoke
// IR= 0 constructTwo Invoke
// IR= 3 seenFirst Invoke
// IR+ "withSetter" 
declare const console: any;
class C { x: number; y: string; z = 0; constructor(x: number, y: string) { this.x = x; this.y = y; } }
class D extends C { w: number; constructor(x: number) { super(x, "d"); this.w = x + 1; } }
class S { _v = 0; get v(): number { return this._v; } set v(n: number) { if (n < 0) throw new RangeError("negative"); this._v = n; } }
let failures = 0; const seen: C[] = [];
function note(c: C): void { if (seen.length < 4) seen.push(c); }
function construct(a: number, b: string): C | undefined { try { const c = new C(a, b); c.z = a; return c; } catch (e) { failures++; return undefined; } }
function constructTwo(a: number): number { try { const c = new C(a, "c"); const d = new D(a); return c.x + d.w + d.x; } catch (e) { failures++; return 0; } }
function seenFirst(a: number): C | undefined { try { const c = new C(a, "s"); note(c); c.z = a; return c; } catch (e) { failures++; return undefined; } }
function withSetter(a: number): number { try { const s = new S(); s.v = a; return s.v; } catch (e) { failures++; return -1; } }
let s = 0;
function run(): void { for (let i = 0; i < 3_000_000; i++) { s += construct(i & 7, "b")!.z + constructTwo(i & 3) + seenFirst(i & 1)!.z + withSetter((i & 15) - 1); } }
run();
console.log(s, failures, seen.length, JSON.stringify(seen[0]), Object.keys(construct(1, "k")!).join());
export {};
