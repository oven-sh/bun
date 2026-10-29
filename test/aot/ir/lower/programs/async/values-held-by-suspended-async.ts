// RUN: lower
// OPTIONS: builtin-modules

declare const console: { log(...values: unknown[]): void };
class Rec { constructor(public name: string, public n: number) {} say(more: unknown): string { return this.name + this.n + ":" + String(more); } }
let made = 0;
function obj(name: string): Rec { return new Rec(name + "#", ++made); }
function fresh(): Rec[] { return [obj("x"), obj("y"), obj("z")]; }
let sink: unknown[] = [];
function churn(): void { sink = []; for (let i = 0; i < 400; i++) sink.push({ i, s: "g" + i, a: [i, i + 0.5] }); sink = []; }
async function tick(): Promise<void> { churn(); await null; churn(); }
async function later<T>(v: T): Promise<T> { await tick(); return v; }
async function fails(v: unknown): Promise<never> { await tick(); throw v; }
const show = (r: Rec | undefined): string => (r ? r.name + r.n : "-");

async function builder(): Promise<string> { let s = ""; for (let i = 0; i < 40; i++) { s += i; s += ","; if (i % 7 === 0) await tick(); } return s; }
async function builderInside(): Promise<string> { let s = ""; for (let k = 0; k < 4; k++) { await tick(); for (let i = 0; i < 30; i++) s += i * k; s += "|"; } return s; }
async function rope(a: string, b: string): Promise<string> { const r = a + b + a; await tick(); const q = r + b; await tick(); return q.charAt(5) + q.length + r.slice(2, 9); }
async function pattern(): Promise<string> { const [a, b = await later(obj("b")), c] = [obj("a"), undefined, obj("c")]; return show(a) + show(b) + show(c); }
async function patternOfFresh(): Promise<string> { const [a, , c = await later(obj("c")), d = await later(obj("d"))] = fresh(); return show(a) + show(c) + show(d); }
async function members(): Promise<string> { const { p, q = await later(obj("q")), r } = { p: obj("p"), q: undefined as Rec | undefined, r: obj("r") }; return show(p) + show(q) + show(r); }
async function overMap(): Promise<string> { const m = new Map<string, Rec>([["a", obj("ma")], ["b", obj("mb")], ["c", obj("mc")]]); let s = ""; for (const [k, v] of m) { m.delete(k); await tick(); s += k + show(v); } return s + m.size; }
async function overSet(): Promise<string> { const set = new Set<Rec>(fresh()); let s = ""; for (const v of set) { set.delete(v); await tick(); s += show(v); } return s + set.size; }
async function overArray(): Promise<string> { const a = fresh(); let s = ""; for (const v of a) { a[a.indexOf(v)] = obj("gone"); await tick(); s += show(v); } return s; }
function* gen(): Generator<Rec> { yield obj("g1"); yield obj("g2"); yield obj("g3"); }
async function overGenerator(): Promise<string> { let s = ""; for (const v of gen()) { await tick(); s += show(v); } return s; }
async function overEntries(): Promise<string> { let s = ""; for (const [k, v] of Object.entries({ a: obj("ea"), b: obj("eb") })) { await tick(); s += k + show(v); } for (const v of Object.values({ a: obj("va"), b: obj("vb") })) { await tick(); s += show(v); } return s; }
async function overKeys(): Promise<string> { const o: Record<string, Rec> = { a: obj("ka"), b: obj("kb"), c: obj("kc") }; let s = ""; for (const k in o) { const v = o[k]; delete o[k]; await tick(); s += k + show(v); } return s; }
async function literals(): Promise<string> {
  const o = { a: obj("la"), b: await later(obj("lb")), c: obj("lc"), d: await later(obj("ld")) };
  const a = [obj("aa"), await later(obj("ab")), obj("ac"), ...fresh(), await later(obj("ad")), ...fresh()];
  const t = `${show(obj("ta"))} ${show(await later(obj("tb")))} ${show(obj("tc"))}`;
  return show(o.a) + show(o.b) + show(o.c) + show(o.d) + a.map(show).join("") + t;
}
function three(a: Rec, b: Rec, c: Rec): string { return show(a) + show(b) + show(c); }
class Trio { s: string; constructor(a: Rec, b: Rec, c: Rec) { this.s = three(a, b, c); } }
async function argumentsOfCalls(): Promise<string> { return three(obj("c1"), await later(obj("c2")), obj("c3")) + new Trio(obj("n1"), await later(obj("n2")), obj("n3")).s + obj("recv").say(await later(7)) + fresh()[1].say(show(await later(obj("in")))); }
async function closures(): Promise<string> { let o = obj("cl"); const read = () => o; const write = (v: Rec) => { o = v; }; await tick(); const first = show(read()); write(obj("cl2")); await tick(); return first + show(read()) + [1, 2].map(k => show(o) + k).join(); }
async function numbers(x: number, y: number): Promise<string> { let i = 3, d = x / y, big = 12345678901234567890n, sym = Symbol("s"), str = "k" + x; for (let k = 0; k < 3; k++) { await tick(); i += k; d *= 1.5; big += 1n; str += k; } return [i, d, big, sym.description, str].join(); }
async function manyLive(): Promise<string> { const a = obj("1"), b = obj("2"), c = obj("3"), d = obj("4"), e = obj("5"), f = obj("6"), g = obj("7"), h = obj("8"), i = obj("9"), j = obj("10"), k = obj("11"), l = obj("12"), m = obj("13"), n = obj("14"), o = obj("15"), p = obj("16"); await tick(); const q = obj("17"), r = obj("18"); await tick(); return [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r].map(show).join(""); }
async function rethrown(): Promise<string> { const thrown = obj("thrown"); try { try { throw thrown; } finally { await tick(); } } catch (e) { await tick(); return String(e === thrown) + show(e as Rec); } }
async function rejectedInto(): Promise<string> { let s = ""; for (let i = 0; i < 3; i++) { const kept = obj("kept"); try { await fails(obj("why")); } catch (e) { s += show(e as Rec) + show(kept); } finally { await tick(); s += show(kept); } } return s; }
async function finallyReturns(): Promise<string> { const kept = obj("fr"); try { await fails(obj("lost")); return "no"; } catch { return show(kept) + show(await later(obj("fr2"))); } finally { await tick(); } }
async function throwsAtOnce(): Promise<string> {
  const kept = obj("once"); let s = "";
  for (let i = 0; i < 3; i++) { const p = Promise.resolve(i); Object.defineProperty(p, "constructor", { get(): never { throw obj("ctor"); } }); try { s += await p; } catch (e) { s += show(e as Rec); } await tick(); s += show(kept); }
  const thenable = { get then(): never { throw obj("then"); } }; try { await thenable; } catch (e) { s += show(e as Rec); } await tick();
  return s + show(kept);
}
async function thenables(): Promise<string> { const kept = obj("th"); const v = await { then(ok: (v: Rec) => void) { churn(); ok(obj("thv")); ok(obj("twice")); } }; await tick(); return show(kept) + show(v as unknown as Rec); }
async function deep(n: number, carried: Rec): Promise<string> { const own = obj("d" + n); if (n === 0) { await tick(); return show(carried); } const below = await deep(n - 1, own); await tick(); return (n % 40 === 0 ? show(own) + show(carried) : "") + below; }
async function six(a: Rec, b: Rec, c: Rec, d: Rec, e: Rec, f: Rec): Promise<string> { await tick(); return [a, b, c, d, e, f].map(show).join(""); }
async function seven(a: Rec, b: Rec, c: Rec, d: Rec, e: Rec, f: Rec, g: Rec): Promise<string> { await tick(); return [a, b, c, d, e, f, g].map(show).join(""); }
async function nine(a: Rec, b: Rec, c: Rec, d: Rec, e: Rec, f: Rec, g: Rec, h: Rec, i: Rec): Promise<string> { await tick(); return [a, b, c, d, e, f, g, h, i].map(show).join(""); }
async function restAndDefault(a: Rec, b: Rec = obj("def"), ...more: Rec[]): Promise<string> { await tick(); return show(a) + show(b) + more.map(show).join(""); }
class Base { constructor(public held: Rec) {} async read(extra: Rec): Promise<string> { await tick(); return show(this.held) + show(extra); } }
class Heir extends Base { async read(extra: Rec): Promise<string> { const mine = obj("heir"); const up = await super.read(extra); await tick(); const inner = async () => { await tick(); return show(this.held) + show(mine); }; return up + (await inner()); } static async make(): Promise<Heir> { await tick(); return new Heir(obj("made")); } }
async function methods(): Promise<string> { return (await Heir.make()).read(obj("extra")); }
async function forAwait(): Promise<string> { let s = ""; for await (const v of [later(obj("fa1")), obj("fa2"), later(obj("fa3"))]) { await tick(); s += show(v); } return s; }
async function together(): Promise<string> { const kept = obj("all"); const all = await Promise.all([later(obj("p1")), later(obj("p2")), six(obj("a"), obj("b"), obj("c"), obj("d"), obj("e"), obj("f"))]); const raced = await Promise.race([later(obj("r1")), new Promise<Rec>(() => {})]); return show(kept) + show(all[0]) + show(all[1]) + all[2] + show(raced); }
async function parked(): Promise<string> {
  const opens: ((v: Rec) => void)[] = []; const results: Promise<string>[] = [];
  const waits = async (i: number): Promise<string> => { const own = obj("w" + i); const got = await new Promise<Rec>(ok => { if (i % 3 === 0) opens.push(ok); }); await tick(); return show(own) + show(got); };
  for (let i = 0; i < 600; i++) { const p = waits(i); if (i % 3 === 0) results.push(p); }
  for (let k = 0; k < 5; k++) await tick();
  opens.forEach((ok, i) => ok(obj("o" + i)));
  const all = await Promise.all(results); return all.length + all[0] + all[all.length - 1];
}
async function switches(k: number): Promise<string> { const kept = obj("sw"); outer: for (let i = 0; i < 4; i++) { switch ((i + k) % 3) { case 0: await tick(); continue outer; case 1: { const inner = obj("sw1"); await tick(); if (i > 2) return show(inner) + show(kept); break; } default: await tick(); } } return show(kept); }

const rows: [string, () => Promise<string>][] = [
  ["builder", builder], ["builderInside", builderInside], ["rope", () => rope("abcdefgh", "12345")], ["pattern", pattern], ["patternOfFresh", patternOfFresh], ["members", members], ["overMap", overMap], ["overSet", overSet], ["overArray", overArray],
  ["overGenerator", overGenerator], ["overEntries", overEntries], ["overKeys", overKeys], ["literals", literals], ["argumentsOfCalls", argumentsOfCalls], ["closures", closures], ["numbers", () => numbers(7, 3)], ["manyLive", manyLive], ["rethrown", rethrown],
  ["rejectedInto", rejectedInto], ["finallyReturns", finallyReturns], ["throwsAtOnce", throwsAtOnce], ["thenables", thenables], ["deep", () => deep(200, obj("top"))], ["six", () => six(obj("a"), obj("b"), obj("c"), obj("d"), obj("e"), obj("f"))],
  ["seven", () => seven(obj("a"), obj("b"), obj("c"), obj("d"), obj("e"), obj("f"), obj("g"))], ["nine", () => nine(obj("a"), obj("b"), obj("c"), obj("d"), obj("e"), obj("f"), obj("g"), obj("h"), obj("i"))],
  ["restAndDefault", async () => (await restAndDefault(obj("a"))) + (await restAndDefault(obj("a"), undefined, obj("m1"), obj("m2")))], ["methods", methods], ["forAwait", forAwait], ["together", together], ["parked", parked], ["switches", async () => (await switches(0)) + (await switches(1)) + (await switches(2))],
];
async function main(): Promise<void> {
  for (let round = 0; round < 3; round++) for (const [name, f] of rows) { made = 0; try { console.log(round, name, await f()); } catch (e) { console.log(round, name, "THREW", String(e)); } }
  made = 0; const all = await Promise.all(rows.map(([, f]) => f().then(s => s.length, () => -1))); console.log("at once", all.join());
}
main();

// GENERATED: fails numbers Heir write
// CHECK-LABEL: function {{*}}name="fails"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise<never> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v3 = Call v2 calleeName="tick"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v5 = Await v4, v1
// CHECK-NEXT: Throw v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="numbers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_2]]}, {type=number site=[[w_3]]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Integer integer=3
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v5 = Div v1, v2
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v7 = BigInt digits="12345678901234567890"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|bigint site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = Builtin builtin=Symbol
// CHECK-NEXT: v10 = String string="s"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="Symbol" callNumber=137
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|symbol site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = String string="k"
// CHECK-NEXT: v14 = Add v13, v1
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b2(v4, v6, v8, v15, v17)
// CHECK-NEXT: b2(v18: number, v19: number, v20: undefined|null|bigint, v21: undefined|null|string, v22: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v24 = Integer integer=3
// CHECK-NEXT: v25 = Less v22, v24
// CHECK-NEXT: Branch v25 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v26):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v28 = Call v27 calleeName="tick"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v30 = Await v29, v1, v2
// CHECK-NEXT: v31 = Add v18, v26
// CHECK-NEXT: v32 = Convert v31 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v33 = Double number=1.5
// CHECK-NEXT: v34 = Mul v19, v33
// CHECK-NEXT: v35 = Convert v34 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v36 = BigInt digits="1"
// CHECK-NEXT: v37 = Add v20, v36
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|bigint site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v39 = Add v21, v26
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v41 = Increment v26
// CHECK-NEXT: v42 = Convert v41 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b2(v32, v35, v38, v40, v42)
// CHECK-NEXT: b6(v43):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v44 = PropGet v12 key="description"
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|string site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v46 = NewArray v18, v19, v20, v45, v21 contents=undefined|null|number|string|bigint
// CHECK-NEXT: v47 = PropGet v46 key="join"
// CHECK-NEXT: v48 = Call v47, v46 calleeKey="join" calleeName="join"
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v50 = Convert v49 declared={type=undefined|null|string|object site=[[w_12]]}
// CHECK-NEXT: Return v50
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Heir"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="write"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 captures=[{type=env [[L_15]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_16]] site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: env [[L_15]], v1: undefined|null|[[L_16]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_15]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="o"
// CHECK-NEXT: v4 = Convert v1 declared={type=undefined|null|[[L_16]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutEnvironmentField v0, v4 layout=[[L_15]]
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
