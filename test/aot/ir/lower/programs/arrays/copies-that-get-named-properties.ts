// RUN: lower
// OPTIONS: builtin-modules

// A copy of an array gets named properties right behind its birth, as a list of syntax nodes does. Everything else an array does follows, over collections.
import { edenGC, fullGC } from "bun:jsc";
interface Ranged<T> extends Array<T> { pos: number; end: number; flag: boolean; bits: number }
interface Wide<T> extends Ranged<T> { a: number; b: string; c: T | undefined }
interface Item { v: number }
const ring: unknown[] = new Array(2048).fill(null); let turn = 0;
function churn(n: number) { for (let i = 0; i < n; i++) { ring[turn++ & 2047] = [i, i]; ring[turn++ & 2047] = { a: i, b: i, c: i, d: i, e: i, f: i }; ring[turn++ & 2047] = ranged([{ v: i }], i); } }
function ranged<T>(elements: T[], at: number): Ranged<T> {
  const list = (elements.length >= 1 && elements.length <= 4 ? elements.slice() : elements) as Ranged<T>;
  list.pos = at; list.end = at + elements.length; list.flag = (at & 1) === 1; list.bits = 0;
  return list;
}
function part<T>(elements: T[], from: number, to: number, at: number): Ranged<T> { const list = elements.slice(from, to) as Ranged<T>; list.pos = at; list.end = at + 1; list.flag = false; list.bits = 7; return list; }
function one<T>(elements: T[]): Ranged<T> { const list = elements.slice() as Ranged<T>; list.pos = 5; return list; }
function wide<T>(elements: T[], at: number): Wide<T> { const list = elements.slice() as Wide<T>; list.pos = at; list.end = at; list.flag = true; list.bits = 1; list.a = at; list.b = "b" + at; list.c = elements[0]; return list; }
function sometimes<T>(elements: T[], named: boolean): T[] { const list = elements.slice(); if (named) (list as Ranged<T>).pos = 1; return list; }
const out: string[] = [];
const kept: Ranged<Item>[] = [], keptParts: Ranged<number>[] = [], keptWide: Wide<Item>[] = [], keptOnes: Ranged<string>[] = [], keptSometimes: number[][] = [];
const numbers: number[] = []; for (let i = 0; i < 70; i++) numbers.push(i);
for (let i = 0; i < 4000; i++) {
  const items: Item[] = []; for (let k = 0; k < i % 7; k++) items.push({ v: i * 10 + k });
  kept.push(ranged(items, i)); keptParts.push(part(numbers, i % 60, (i % 60) + (i % 9), i)); keptWide.push(wide(items, i)); keptOnes.push(one(["s" + i])); keptSometimes.push(sometimes([i, i + 1], (i & 3) === 0));
  if (i % 500 === 0) { churn(1500); if (i & 1) edenGC(); else fullGC(); }
}
fullGC(); churn(4000); fullGC();
function check(label: string) {
  let bad = "";
  for (let i = 0; i < 4000 && !bad; i++) {
    const n = i % 7, a = kept[i], p = keptParts[i], w = keptWide[i], o = keptOnes[i], s = keptSometimes[i];
    if (a.pos !== i || a.end !== i + n || a.flag !== ((i & 1) === 1) || a.bits !== 0) bad = "names of " + i;
    for (let k = 0; k < n && !bad; k++) if (a[k].v !== i * 10 + k || w[k].v !== i * 10 + k) bad = "element " + k + " of " + i;
    if (p.pos !== i || p.end !== i + 1 || p.bits !== 7 || p[0] !== (i % 9 ? i % 60 : undefined)) bad = "part " + i;
    if (w.a !== i || w.b !== "b" + i || w.c !== w[0] || w.pos !== i || !w.flag) bad = "wide " + i;
    if (o.pos !== 5 || o[0] !== "s" + i || Object.keys(o).join() !== "0,pos") bad = "one " + i;
    if (s[0] !== i || s[1] !== i + 1 || ("pos" in s) !== ((i & 3) === 0)) bad = "sometimes " + i;
  }
  out.push(label + ": " + bad);
}
check("born");
for (let i = 0; i < 4000; i++) { kept[i].push({ v: -1 }); keptParts[i].push(-1, -2, -3); keptWide[i].unshift({ v: -9 }); keptWide[i].shift(); keptOnes[i].length = 1; keptSometimes[i].push(0); keptSometimes[i].pop(); if (i % 800 === 0) { churn(1000); fullGC(); } }
check("pushed");
let bad = "";
for (let i = 0; i < 4000 && !bad; i++) { const a = kept[i], p = keptParts[i]; if (a.length !== i % 7 + 1 || a[a.length - 1].v !== -1 || p.length !== i % 9 + 3 || p[p.length - 1] !== -3) bad = "lengths of " + i; }
out.push("lengths: " + bad);
for (let i = 0; i < 4000; i++) { (kept[i] as unknown as Record<string, number>).late = i; (keptOnes[i] as unknown as Record<string, number>).end = i; (keptOnes[i] as unknown as Record<string, number>).x1 = 1; (keptOnes[i] as unknown as Record<string, number>).x2 = 2; (keptOnes[i] as unknown as Record<string, number>).x3 = 3; (keptOnes[i] as unknown as Record<string, number>).x4 = 4; }
fullGC(); churn(3000); edenGC();
bad = "";
for (let i = 0; i < 4000 && !bad; i++) { const o = keptOnes[i] as unknown as Record<string, number>; if ((kept[i] as unknown as Record<string, number>).late !== i || o.end !== i || o.x4 !== 4 || o.pos !== 5 || Object.keys(o).join() !== "0,pos,end,x1,x2,x3,x4") bad = "late names of " + i; }
out.push("late names: " + bad);
const f = ranged([1, 2], 3); Object.freeze(f); let threw = false; try { f.pos = 9; } catch { threw = true; } out.push("frozen: " + threw + " " + f.pos + " " + f.join() + " " + JSON.stringify(f) + " " + Object.keys(f).join());
const d = ranged(["a"], 1); delete (d as Partial<Ranged<string>>).end; d.end = 8; delete (d as Partial<Ranged<string>>).pos; out.push("deleted: " + Object.keys(d).join() + " " + d.end + " " + d.pos);
const g = ranged([1.5, 2.5], 1); g[0] = "x" as unknown as number; g[5] = 1; out.push("changed: " + g.join() + " " + g.pos + " " + g.end + " " + g.length);
const c = structuredClone(ranged([1], 2)); out.push("cloned: " + c.join() + " " + (c as Ranged<number>).pos + " " + { ...ranged([7], 2) }.pos + " " + Object.assign([], ranged([7, 8], 2)).end + " " + ranged([3], 1).concat([4]).length + " " + (ranged([3], 1).slice() as Ranged<number>).pos);
Object.defineProperty(ranged([1], 1), "pos", { get() { return 1; } });
const acc = one([1]); Object.defineProperty(acc, "end", { get() { return "got"; }, enumerable: true, configurable: true }); out.push("accessor: " + acc.end + " " + acc.pos + " " + Object.keys(acc).join());
console.log(out.join("\n"));

// GENERATED: ranged churn one wide sometimes get
// CHECK-LABEL: function {{*}}name="ranged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = GreaterEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b3(v0)
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = PropGet v0 key="length"
// CHECK-NEXT: v6 = Integer integer=4
// CHECK-NEXT: v7 = LessEq v5, v6
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3(v0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = PropGet v0 key="slice"
// CHECK-NEXT: v9 = Call v8, v0 calleeKey="slice" calleeName="elements.slice"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: PropSet v12, v1 key="pos"
// CHECK-NEXT: v14 = PropGet v0 key="length"
// CHECK-NEXT: v15 = Add v1, v14
// CHECK-NEXT: PropSet v12, v15 key="end"
// CHECK-NEXT: v17 = Integer integer=1
// CHECK-NEXT: v18 = BitAnd v1, v17
// CHECK-NEXT: v19 = Integer integer=1
// CHECK-NEXT: v20 = StrictEq v18, v19
// CHECK-NEXT: PropSet v12, v20 key="flag"
// CHECK-NEXT: v22 = Integer
// CHECK-NEXT: PropSet v12, v22 key="bits"
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="churn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v3: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = Less v3, v0
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="ring"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="turn"
// CHECK-NEXT: v10 = ToNumeric v9
// CHECK-NEXT: v11 = Increment v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="turn"
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_2]]
// CHECK-NEXT: v16 = Integer integer=2047
// CHECK-NEXT: v17 = BitAnd v10, v16
// CHECK-NEXT: v18 = NewArray v3, v3 contents=anything
// CHECK-NEXT: ElemSet v7, v17, v18
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="ring"
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="turn"
// CHECK-NEXT: v24 = ToNumeric v23
// CHECK-NEXT: v25 = Increment v24
// CHECK-NEXT: v26 = Convert v25 declared={type=number}
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="turn"
// CHECK-NEXT: PutModuleVariable v26 variable=[[g_2]]
// CHECK-NEXT: v30 = Integer integer=2047
// CHECK-NEXT: v31 = BitAnd v24, v30
// CHECK-NEXT: v32 = NewObject -, v3, v3, v3, v3, v3, v3 layout=[[L_3]] fields=[0, 1, 2, 3, 4, 5]
// CHECK-NEXT: v33 = FinishObject v32
// CHECK-NEXT: ElemSet v21, v31, v33
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v36 = CheckInitialized v35 name="ring"
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="turn"
// CHECK-NEXT: v39 = ToNumeric v38
// CHECK-NEXT: v40 = Increment v39
// CHECK-NEXT: v41 = Convert v40 declared={type=number}
// CHECK-NEXT: v42 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v43 = CheckInitialized v42 name="turn"
// CHECK-NEXT: PutModuleVariable v41 variable=[[g_2]]
// CHECK-NEXT: v45 = Integer integer=2047
// CHECK-NEXT: v46 = BitAnd v39, v45
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v48 = Convert v3 declared={type=number}
// CHECK-NEXT: v49 = NewObject -, v48 layout=[[L_5]] fields=[0]
// CHECK-NEXT: v50 = FinishObject v49
// CHECK-NEXT: v51 = NewArray v50 contents=undefined|null|[[L_5]]
// CHECK-NEXT: v52 = Call v47, -, v51, v3 calleeName="ranged"
// CHECK-NEXT: ElemSet v36, v46, v52
// CHECK-NEXT: v54 = Increment v3
// CHECK-NEXT: v55 = Convert v54 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v55)
// CHECK-NEXT: b3():
// CHECK-NEXT: v56 = Undefined
// CHECK-NEXT: Return v56
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="one"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = PropGet v0 key="slice"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="slice" calleeName="elements.slice"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer integer=5
// CHECK-NEXT: PropSet v3, v4 key="pos"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="wide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="slice"
// CHECK-NEXT: v3 = Call v2, v0 calleeKey="slice" calleeName="elements.slice"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v4, v1 key="pos"
// CHECK-NEXT: PropSet v4, v1 key="end"
// CHECK-NEXT: v7 = Boolean boolean=true
// CHECK-NEXT: PropSet v4, v7 key="flag"
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: PropSet v4, v9 key="bits"
// CHECK-NEXT: PropSet v4, v1 key="a"
// CHECK-NEXT: v12 = String string="b"
// CHECK-NEXT: v13 = Add v12, v1
// CHECK-NEXT: PropSet v4, v13 key="b"
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = ElemGet v0, v15
// CHECK-NEXT: PropSet v4, v16 key="c"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sometimes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}, {type=boolean}] results=[{type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: boolean):
// CHECK-NEXT: v2 = PropGet v0 key="slice"
// CHECK-NEXT: v3 = Call v2, v0 calleeKey="slice" calleeName="elements.slice"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = ToBoolean v1
// CHECK-NEXT: Branch v5 -> taken b1(| 0), notTaken b2()
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: PropSet v4, v7 key="pos"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="got"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
