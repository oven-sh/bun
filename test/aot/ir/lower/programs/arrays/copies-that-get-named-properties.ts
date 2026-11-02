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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_3]]}] results=[{type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="length"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_5]]} illTypedCause=Assertion
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = GreaterEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = PropGet v0 key="length"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v8 = Integer integer=4
// CHECK-NEXT: v9 = LessEq v7, v8
// CHECK-NEXT: Branch v9 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = PropGet v0 key="slice"
// CHECK-NEXT: v11 = Call v10, v0 calleeKey="slice" calleeName="elements.slice"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b5(v12)
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5(v0)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Array<undefined|null|[[L_1]]> site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v15 = Convert v1 declared={type=number site=[[w_9]]}
// CHECK-NEXT: PropSet v14, v15 key="pos"
// CHECK-NEXT: v17 = PropGet v0 key="length"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = Add v1, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=number site=[[w_11]]}
// CHECK-NEXT: PropSet v14, v20 key="end"
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = BitAnd v1, v22
// CHECK-NEXT: v24 = Integer integer=1
// CHECK-NEXT: v25 = StrictEq v23, v24
// CHECK-NEXT: v26 = Convert v25 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: PropSet v14, v26 key="flag"
// CHECK-NEXT: v28 = Integer
// CHECK-NEXT: v29 = Convert v28 declared={type=number site=[[w_13]]}
// CHECK-NEXT: PropSet v14, v29 key="bits"
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="churn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_14]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v3: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = Less v3, v0
// CHECK-NEXT: Branch v5 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v6, v7):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="ring"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="turn"
// CHECK-NEXT: v12 = ToNumeric v11
// CHECK-NEXT: v13 = Increment v12
// CHECK-NEXT: v14 = Convert v13 declared={type=number site=[[w_18]]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="turn"
// CHECK-NEXT: PutModuleVariable v14 variable=[[g_17]]
// CHECK-NEXT: v18 = Integer integer=2047
// CHECK-NEXT: v19 = BitAnd v12, v18
// CHECK-NEXT: v20 = NewArray v6, v6 contents=anything
// CHECK-NEXT: ElemSet v9, v19, v20
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v23 = CheckInitialized v22 name="ring"
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="turn"
// CHECK-NEXT: v26 = ToNumeric v25
// CHECK-NEXT: v27 = Increment v26
// CHECK-NEXT: v28 = Convert v27 declared={type=number site=[[w_18]]}
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="turn"
// CHECK-NEXT: PutModuleVariable v28 variable=[[g_17]]
// CHECK-NEXT: v32 = Integer integer=2047
// CHECK-NEXT: v33 = BitAnd v26, v32
// CHECK-NEXT: v34 = Convert v6 declared={type=number}
// CHECK-NEXT: v35 = Convert v6 declared={type=number}
// CHECK-NEXT: v36 = Convert v6 declared={type=number}
// CHECK-NEXT: v37 = Convert v6 declared={type=number}
// CHECK-NEXT: v38 = Convert v6 declared={type=number}
// CHECK-NEXT: v39 = Convert v6 declared={type=number}
// CHECK-NEXT: v40 = NewObject -, v34, v35, v36, v37, v38, v39 layout=[[L_19]] fields=[0, 1, 2, 3, 4, 5]
// CHECK-NEXT: v41 = FinishObject v40
// CHECK-NEXT: ElemSet v23, v33, v41
// CHECK-NEXT: v43 = GetModuleVariable variable=[[g_16]]
// CHECK-NEXT: v44 = CheckInitialized v43 name="ring"
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v46 = CheckInitialized v45 name="turn"
// CHECK-NEXT: v47 = ToNumeric v46
// CHECK-NEXT: v48 = Increment v47
// CHECK-NEXT: v49 = Convert v48 declared={type=number site=[[w_18]]}
// CHECK-NEXT: v50 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v51 = CheckInitialized v50 name="turn"
// CHECK-NEXT: PutModuleVariable v49 variable=[[g_17]]
// CHECK-NEXT: v53 = Integer integer=2047
// CHECK-NEXT: v54 = BitAnd v47, v53
// CHECK-NEXT: v55 = GetModuleVariable variable=[[g_20]]
// CHECK-NEXT: v56 = Convert v6 declared={type=number}
// CHECK-NEXT: v57 = NewObject -, v56 layout=[[L_21]] fields=[0]
// CHECK-NEXT: v58 = FinishObject v57
// CHECK-NEXT: v59 = NewArray v58 contents=undefined|null|[[L_21]]
// CHECK-NEXT: v60 = Call v55, -, v59, v6 calleeName="ranged"
// CHECK-NEXT: v61 = Convert v60 declared={type=undefined|null|Array<undefined|null|[[L_21]]> site=[[w_22]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: ElemSet v44, v54, v61
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v63 = Increment v6
// CHECK-NEXT: v64 = Convert v63 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Jump -> next b2(v64)
// CHECK-NEXT: b6(v65, v66):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v67 = Undefined
// CHECK-NEXT: Return v67
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="one"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_23]]> site=[[w_24]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|[[L_23]]> site=[[w_25]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_23]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="slice"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="slice" calleeName="elements.slice"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<undefined|null|[[L_23]]> site=[[w_26]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Integer integer=5
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_27]]}
// CHECK-NEXT: PropSet v3, v5 key="pos"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="wide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_28]]> site=[[w_29]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_30]]}] results=[{type=undefined|null|Array<undefined|null|[[L_28]]> site=[[w_31]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_28]]>, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="slice"
// CHECK-NEXT: v3 = Call v2, v0 calleeKey="slice" calleeName="elements.slice"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|[[L_28]]> site=[[w_32]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = Convert v1 declared={type=number site=[[w_33]]}
// CHECK-NEXT: PropSet v4, v5 key="pos"
// CHECK-NEXT: v7 = Convert v1 declared={type=number site=[[w_34]]}
// CHECK-NEXT: PropSet v4, v7 key="end"
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = Convert v9 declared={type=boolean site=[[w_35]]}
// CHECK-NEXT: PropSet v4, v10 key="flag"
// CHECK-NEXT: v12 = Integer integer=1
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_36]]}
// CHECK-NEXT: PropSet v4, v13 key="bits"
// CHECK-NEXT: v15 = Convert v1 declared={type=number site=[[w_37]]}
// CHECK-NEXT: PropSet v4, v15 key="a"
// CHECK-NEXT: v17 = String string="b"
// CHECK-NEXT: v18 = Add v17, v1
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string site=[[w_38]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v4, v19 key="b"
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = ElemGet v0, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[L_28]] site=[[w_39]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_40]] site=[[w_41]]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v4, v24 key="c"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sometimes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_42]]> site=[[w_43]] flags=[OmitsNull, OmitsUndefined]}, {type=boolean site=[[w_44]]}] results=[{type=undefined|null|Array<undefined|null|[[L_42]]> site=[[w_45]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_42]]>, v1: boolean):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="slice"
// CHECK-NEXT: v3 = Call v2, v0 calleeKey="slice" calleeName="elements.slice"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|[[L_42]]> site=[[w_46]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = ToBoolean v1
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_47]]}
// CHECK-NEXT: PropSet v4, v8 key="pos"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_48]]}] functionTypes={{*}}[[f_49]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_48]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_50]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_51]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="got"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_50]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
