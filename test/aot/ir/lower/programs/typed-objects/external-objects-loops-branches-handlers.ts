// RUN: lower
// OPTIONS: builtin-modules

// Objects of the program and objects from outside (parsed data, accessors that count and that throw, proxies) go through the same functions,
// whose reads and stores through a type that admits both stand in loops, in the arms of branches and switches, under handlers, around awaits
// and yields, and in closures. What is computed from one read is used behind the next branch. Every answer is the language's.
declare const console: { log(...values: unknown[]): void };
declare const JSON: { parse(text: string): any };
declare const Object: { defineProperty(o: any, k: string, d: any): any };
declare const Proxy: new (target: object, handler: object) => any;
interface Item { count: number; total: number; name?: string; next?: Item; flag?: boolean; n?: number; u?: string | number; a1?: number; a2?: number; a3?: number; a4?: number; a5?: number; a6?: number; a7?: number; a8?: number; late?: string }
const log: string[] = [];
let throwsAt = -1, reads = 0;
function member(i: number): Item { return { count: i, total: i * 2, name: "m" + i, flag: (i & 1) === 0, n: i + 0.5, u: i & 1 ? "u" + i : i } }
function bare(i: number): Item { return { count: i, total: 1 } }
function parsed(i: number): Item { return JSON.parse('{"count":' + i + ',"total":3,"name":"p' + i + '","flag":false,"n":' + i + '.25,"u":"text"}') as Item }
function counting(i: number): Item {
  const o: any = { name: "g" + i, flag: true, u: 4 };
  let count = i, total = 5;
  Object.defineProperty(o, "count", { get() { if (++reads === throwsAt) throw new RangeError("count"); return count }, set(v: number) { log.push("c=" + v); count = v }, enumerable: true, configurable: true });
  Object.defineProperty(o, "total", { get() { if (++reads === throwsAt) throw new RangeError("total"); return total }, set(v: number) { log.push("t=" + v); total = v }, enumerable: true, configurable: true });
  return o as Item;
}
function behindProxy(i: number): Item { return new Proxy({ count: i, total: 7, n: 1.5 }, { get(t: any, k: string) { reads++; return t[k] } }) as Item }
const makers: ((i: number) => Item)[] = [member, bare, parsed, counting, behindProxy];
function mixed(seed: number, length: number): Item[] { const list: Item[] = []; for (let i = 0; i < length; i++) list.push(makers[(seed + i * 3) % makers.length](i + 1)); return list }

function inLoop(list: Item[], limit: number): number {
  let sum = 0, last: Item | undefined;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    let v = it.count;
    if (v & 1) { v += it.total; sum += v } else { sum -= it.n ?? 0; if (it.flag) continue }
    last = it;
    sum += (it.u === undefined ? 1 : 2) + v;
    if (sum > limit) break;
  }
  return sum + (last ? last.count : 0);
}
function underHandler(a: Item): string { try { const x = a.count; const y = a.total; return x + ":" + y + ":" + a.count } catch (e) { return "caught " + (e as Error).message + " " + a.name } finally { log.push("f") } }
function inSwitch(a: Item, k: number): number { switch (k) { case 0: return a.count; case 1: a.total = a.count + 1; case 2: return a.total + (a.n ?? 0); default: return -1 } }
function alongChain(a: Item): number { let t = 0; for (let x: Item | undefined = a; x; x = x.next) { t += x.count; for (let j = 0; j < 2; j++) t += x.n ?? j } return t }
function* yielding(a: Item): Generator<number, void, unknown> { yield a.count; yield a.total + a.count; a.total = 9; yield a.total }
async function awaiting(a: Item): Promise<number> { const c = a.count; await null; return c + a.count + a.total }
function closing(a: Item): () => number { const c = a.count, t = a.total; return () => c + t + a.count }
function eitherOf(a: Item, b: Item, first: boolean): number { const p = first ? a : b; return p.count + (first ? b : a).total + p.total }
function everything(a: Item): string { return [a.count, a.total, a.name, a.flag, a.n, a.u, a.a1, a.a8, a.late].join() }
function swapping(a: Item, b: Item): number { const t = a.count; a.count = b.count; b.count = t; return a.count * 100 + b.count }
function deleting(a: Item): string { const c = a.count; delete (a as any).name; return c + " " + a.name + " " + a.count }
function twice(a: Item, again: boolean): number { let s = a.count; do { s += a.total; a.total = s & 15; again = !again } while (!again); return s + a.total }
function attempt(f: () => unknown): unknown { try { return f() } catch (e) { return (e as Error).name + " " + (e as Error).message } }

for (let seed = 0; seed < makers.length; seed++) {
  const list = mixed(seed, 11);
  for (let i = 0; i + 1 < list.length; i += 2) if (!(list[i] as any).__proto__ || true) attempt(() => { list[i].next = list[i + 1] });
  console.log("loop", seed, inLoop(list, 1e9), inLoop(list, 20), inLoop(mixed(seed, 3), 5), "chain", alongChain(list[0]), alongChain(list[2]));
}
for (let k = 0; k < makers.length; k++) {
  log.length = 0; reads = 0;
  const a = makers[k](k + 3), b = makers[(k + 2) % makers.length](k + 5);
  const g = yielding(makers[k](k + 1));
  console.log("one", k, underHandler(a), inSwitch(a, 0), inSwitch(a, 1), inSwitch(a, 2), inSwitch(a, 3), [g.next().value, g.next().value, g.next().value].join(), closing(a)(), eitherOf(a, b, true), eitherOf(a, b, false), everything(a), swapping(a, b), swapping(a, a), deleting(a), twice(a, true), twice(b, false), log.join("|"), reads);
}
for (throwsAt = 1; throwsAt < 7; throwsAt++) {
  reads = 0; const first = underHandler(counting(2));
  reads = 0; const second = attempt(() => inLoop([member(1), counting(3), member(5), counting(7)], 1e9));
  reads = 0; const third = attempt(() => eitherOf(counting(1), member(2), (throwsAt & 1) === 0));
  reads = 0; const fourth = attempt(() => twice(counting(4), true));
  console.log("throws at", throwsAt, first, second, third, fourth);
}
throwsAt = -1;
let pending = makers.length;
for (let k = 0; k < makers.length; k++) awaiting(makers[k](k + 2)).then((v) => { log.push("a" + k + "=" + v); if (!--pending) console.log(log.filter((s) => s[0] === "a").join()) });

// GENERATED: bare underHandler awaiting
// CHECK-LABEL: function {{*}}name="bare"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number}
// CHECK-NEXT: v2 = Integer integer=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = NewObject -, v1, v3 layout=[[L_2]] fields=[8, 14]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="underHandler"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b6():
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b4():
// CHECK-NEXT: v1 = PropGet v0 key="count"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_7]]}
// CHECK-NEXT: v3 = PropGet v0 key="total"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_8]]}
// CHECK-NEXT: v5 = String string=":"
// CHECK-NEXT: v6 = Add v2, v5
// CHECK-NEXT: v7 = Add v6, v4
// CHECK-NEXT: v8 = String string=":"
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = PropGet v0 key="count"
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4() role=CatchHandler handler=b6():
// CHECK-NEXT: v13 = CatchValue
// CHECK-NEXT: v14 = String string="caught "
// CHECK-NEXT: v15 = Convert v13 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v16 = PropGet v15 key="message"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v18 = Add v14, v17
// CHECK-NEXT: v19 = String string=" "
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = PropGet v0 key="name"
// CHECK-NEXT: v22 = Add v20, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5(v23)
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: v25 = Integer
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Jump -> next b7(v25, v24, v26)
// CHECK-NEXT: b6() role=CleanupHandler:
// CHECK-NEXT: v27 = CatchValue
// CHECK-NEXT: v28 = Integer integer=1
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Jump -> next b7(v28, v29, v27)
// CHECK-NEXT: b7(v30, v31, v32):
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v34 = CheckInitialized v33 name="log"
// CHECK-NEXT: v35 = PropGet v34 key="push"
// CHECK-NEXT: v36 = String string="f"
// CHECK-NEXT: v37 = Call v35, v34, v36 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v38 = Convert v37 declared={type=number site=[[w_11]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Switch v30 cases=[0] -> case b8(), otherwise b9()
// CHECK-NEXT: b8():
// CHECK-NEXT: v39 = Convert v31 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v39
// CHECK-NEXT: b9():
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="awaiting"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="count"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v4 = Null
// CHECK-NEXT: v5 = Await v4, v1
// CHECK-NEXT: v6 = Convert v5 declared={type=null site=[[w_14]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v7 = PropGet v1 key="count"
// CHECK-NEXT: v8 = Add v3, v7
// CHECK-NEXT: v9 = PropGet v1 key="total"
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=number|object site=[[w_15]]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
