// RUN: lower
// OPTIONS: builtin-modules

// Thirty ways in which TypeScript lets a value into a position of another type; nothing may throw or answer otherwise than plain Bun.
const log = (...a: unknown[]) => console.log(a.map(String).join(" "));
class Animal { name: string; constructor(n: string) { this.name = n; } }
class Dog extends Animal { barks: number = 3; tail: { len: number } = { len: 7 }; bark(): number { return this.barks + this.tail.len; } }
class Cat extends Animal { lives: string = "nine"; meow(): string { return this.lives; } }
{ const dogs: Dog[] = [new Dog("d")]; const animals: Animal[] = dogs; animals.push(new Cat("c")); for (const d of dogs) { try { log(1, d.name, d.barks, d.tail?.len, typeof d.bark); log(1, d.bark()); } catch (e) { log(1, (e as Error).constructor.name); } } }
{ const a: number[] = [1, 2]; const x: number = a[5]; log(2, x, x + 1, typeof x, x === undefined); const o: Dog[] = []; const d: Dog = o[0]; try { log(2, d.barks); } catch (e) { log(2, (e as Error).constructor.name); } }
{ class U { x!: number; y!: Dog; z!: string; sum(): number { return this.x + 1; } } const u = new U(); log(3, u.x, u.sum(), u.z, Object.keys(u).length); try { log(3, u.y.barks); } catch (e) { log(3, (e as Error).constructor.name); } }
{ const v = JSON.parse('{"barks":"many","tail":null}') as Dog; log(4, v.barks, typeof v.barks, v.tail); try { log(4, v.tail.len); } catch (e) { log(4, (e as Error).constructor.name); } try { log(4, v.bark()); } catch (e) { log(4, (e as Error).constructor.name); } }
{ function isDog(a: Animal): a is Dog { return true; } const c: Animal = new Cat("c"); if (isDog(c)) { log(5, c.barks, typeof c.bark); try { log(5, c.tail.len); } catch (e) { log(5, (e as Error).constructor.name); } } }
{ function assertDog(a: Animal): asserts a is Dog { } const c: Animal = new Cat("c"); assertDog(c); log(6, c.barks, c.name); }
{ interface H { handle(a: Animal): string; } const h: H = { handle(d: Dog) { return String(d.barks) + typeof d.tail; } } as H; log(7, h.handle(new Cat("c"))); }
{ const rec: Record<string, Dog> = {}; const d = rec["nobody"]; try { log(8, d.barks); } catch (e) { log(8, (e as Error).constructor.name); } const m = new Map<string, Dog>(); const g = m.get("x")!; try { log(8, g.barks); } catch (e) { log(8, (e as Error).constructor.name); } }
{ enum E { A, B } const e: E = 7 as E; const names: string[] = ["a", "b"]; log(9, e, names[e], E[e]); switch (e) { case E.A: log(9, "A"); break; case E.B: log(9, "B"); break; default: { const n: never = e; log(9, "never", n); } } }
{ function f(x: number): number; function f(x: any): any { return String(x) + "!"; } const n: number = f(1); log(10, n, typeof n, n + 1); }
{ const n: number = "text" as unknown as number; log(11, n + 1, typeof n, n * 2, Math.abs(n)); const arr: number[] = [1.5, 2.5]; arr.push(n); let s = 0; for (const x of arr) s += x; log(11, s); }
{ const o: { a: number; b?: number } = { a: 1 }; const p: { a: number; b: number } = o as { a: number; b: number }; log(12, p.b, p.b + 1, "b" in p); }
{ function gen<T>(x: unknown): T { return x as T; } const d = gen<Dog>({ barks: "q" }); log(13, d.barks, typeof d.bark); const n = gen<number>(null); log(13, n, n + 1); const s = gen<string>(5); try { log(13, s.length, s.toUpperCase()); } catch (e) { log(13, (e as Error).constructor.name); } }
{ const t: [number, string] = [1, "a"]; (t as unknown as unknown[]).length = 0; log(14, t[0], t[1], t.length); const u: [number, number] = [1, 2]; u.push(3); u.pop(); u.pop(); u.pop(); log(14, u[0], u[1], u.length); }
{ const ro: readonly number[] = [1, 2, 3]; (ro as number[]).push("x" as unknown as number); (ro as number[])[0] = 0.5; log(15, ro.join(), ro.length); const fz: Readonly<{ v: number }> = { v: 1 }; (fz as { v: number }).v = 2; log(15, fz.v); }
{ class P { private secret: number = 1; get(): number { return this.secret; } } const p = new P(); (p as any).secret = "changed"; log(16, p.get(), typeof p.get()); delete (p as any).secret; log(16, p.get()); (p as any).extra = 1; log(16, Object.keys(p).join()); }
{ class Q { readonly id: number = 1; twice(): number { return this.id * 2; } } const q = new Q(); (q as { id: number }).id = 21; log(17, q.twice()); Object.defineProperty(q, "id", { get() { return 100; } }); log(17, q.twice()); }
{ function th(this: Dog): number { return this.barks; } log(18, th.call(new Cat("c") as unknown as Dog), th.call({ barks: "own" } as unknown as Dog)); try { log(18, (th as any)()); } catch (e) { log(18, (e as Error).constructor.name); } }
{ const cb: (d: Dog) => number = d => d.barks; const list: Animal[] = [new Dog("d"), new Cat("c")]; log(19, (list as Dog[]).map(cb).join()); }
{ let x: string | number = "s"; const set = () => { x = 5; }; if (typeof x === "string") { set(); log(20, typeof x, (x as string).length); } }
{ const o: { v: string | number } = { v: "s" }; const set = () => { o.v = 5; }; if (typeof o.v === "string") { set(); log(21, typeof o.v, o.v.length); } }
{ abstract class Base { constructor() { this.init(); } abstract init(): void; } class Der extends Base { n: number = 5; seen!: string; init() { this.seen = String(this.n); } } const d = new Der(); log(22, d.seen, d.n); }
{ const d = Object.create(Dog.prototype) as Dog; log(23, d.barks, d instanceof Dog); try { log(23, d.bark()); } catch (e) { log(23, (e as Error).constructor.name); } }
{ const d = new Dog("d"); Object.setPrototypeOf(d, Cat.prototype); log(24, d instanceof Dog, typeof d.bark, (d as unknown as Cat).meow()); }
{ const d = new Dog("d"); const spread: Dog = { ...d } as Dog; log(25, spread.barks, typeof spread.bark, spread instanceof Dog); const as: Dog = Object.assign({}, d) as Dog; try { as.bark(); } catch (e) { log(25, (e as Error).constructor.name); } }
{ const big: number = 2 ** 53; const i: number = big + 1; log(26, i, (i | 0), 2 ** 31 | 0, (2 ** 31) >>> 0); let c: number = 2147483647; c++; log(26, c); c = -2147483648; c--; log(26, c); const z: number = -0; log(26, Object.is(z * 1, -0), 1 / z, Object.is(Math.round(-0.4), -0), 0 * -1 === 0, Object.is(0 * -1, -0)); }
{ function opt(a: number, b?: number): number { return a + (b as number); } log(27, opt(1), opt(1, 2), (opt as any)(), (opt as any)("s", "t")); }
{ function rest(...n: number[]): number { let s = 0; for (const x of n) s += x; return s; } log(28, rest(), rest(1, 2), (rest as any)("a", "b"), rest(...([1, undefined] as number[]))); }
{ type Sh = { k: "c"; r: number } | { k: "s"; w: number }; const bad = { k: "c", w: 2 } as unknown as Sh; const area = (s: Sh): number => s.k === "c" ? s.r * 2 : s.w; log(29, area(bad), area({ k: "x" } as unknown as Sh)); }
{ const sym: unique symbol = Symbol("u"); const o: { [sym]: number } = { [sym]: 1 }; (o as any)[sym] = "s"; log(30, typeof o[sym]); const idx: { [k: number]: string } = ["a"]; log(30, idx[3], idx[-1]); }

// GENERATED: Dog isDog init rest area
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_3]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isDog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean site=[[w_6]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="init"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]] site=[[w_8]]} results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = PropGet v0 key="n"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: PropSet v0, v4 key="seen"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="rest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array<number> site=[[w_11]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_12]]}] {
// CHECK-NEXT: b0(v0: Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=number site=[[w_12]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Convert v8 declared={type=number site=[[w_14]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = Add v4, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_13]]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v12)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_15]]|[[L_16]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_18]]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_15]]|[[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="k"
// CHECK-NEXT: v2 = String string="c"
// CHECK-NEXT: v3 = StrictEq v1, v2
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByField v0, v4 key="k"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_15]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v6 key="r"
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Mul v7, v8
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = NarrowByField v0, v10 key="k"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_16]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = PropGet v12 key="w"
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_18]]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
