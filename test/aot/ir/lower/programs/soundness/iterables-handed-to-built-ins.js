// RUN: lower
// OPTIONS: builtin-modules

function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
let opened = 0, stepped = 0, closed = 0;
function iterable(values) {
  return { [Symbol.iterator]() { opened++; let i = 0; return { next() { stepped++; return i < values.length ? { done: false, value: values[i++] } : { done: true, value: undefined }; }, return() { closed++; return {}; } }; } };
}
function counts() { return opened + "/" + stepped + "/" + closed; }
function kind(v) { return typeof v + " " + String(v); }

async function main() {
  print("Array.from", Array.from(iterable(["a", 1])).map(kind).join("; "), counts());
  print("Array.from mapped", Array.from(iterable([1]), x => "m" + x).map(kind).join("; "), counts());
  print("spread", [...iterable(["b"])].map(kind).join("; "), counts());
  print("call spread", Math.max(...iterable([1, 5])), counts());
  print("new spread", new Array(...iterable(["c", "d"])).length, counts());
  const [first] = iterable(["e", "f"]); print("pattern closes", kind(first), counts());
  const [x, ...rest] = iterable(["g", 2, 3n]); print("pattern rest", kind(x) + "; " + rest.map(kind).join("; "), counts());
  print("Set", [...new Set(iterable(["h", "h", 4]))].map(kind).join("; "), counts());
  print("Map", [...new Map(iterable([["k", "v"], [1, 2]]))].map(e => kind(e[0]) + "=" + kind(e[1])).join("; "), counts());
  try { new Map(iterable([5])); } catch (e) { print("Map closes on a bad entry", e instanceof TypeError, counts()); }
  print("WeakSet", new WeakSet(iterable([{}])) instanceof WeakSet, counts());
  print("fromEntries", JSON.stringify(Object.fromEntries(iterable([["a", "late"], ["b", 2]]))), counts());
  print("groupBy", JSON.stringify(Object.groupBy(iterable([1, 2, 3]), n => (n % 2 ? "odd" : "even"))), counts());
  print("Map.groupBy", Map.groupBy(iterable(["p", "q"]), s => s).size, counts());
  print("all", (await Promise.all(iterable(["i", Promise.resolve(6)]))).map(kind).join("; "), counts());
  print("race", kind(await Promise.race(iterable(["j"]))), counts());
  print("typed array", new Uint8Array(iterable([7, 8])).join(), counts());
  print("typed array from", Float64Array.from(iterable([1.5])).join(), counts());
  print("Iterator.from", Iterator.from(iterable(["l", "m"])).map(s => s + "!").toArray().join(), counts());
  print("flatMap", Iterator.from(iterable([1])).flatMap(() => iterable(["n", "o"])).toArray().join(), counts());
  print("take closes", Iterator.from(iterable([1, 2, 3])).take(1).toArray().join(), counts());
  function* delegate() { const r = yield* iterable(["p"]); return r; }
  print("yield*", [...delegate()].map(kind).join("; "), counts());
  for (const v of iterable(["q", "r"])) { print("break closes", kind(v), counts()); break; }
  try { for (const v of iterable(["s"])) throw "t"; } catch (e) { print("throw closes", kind(e), counts()); }
  outer: for (const a of iterable([1])) for (const b of iterable([2])) continue outer;
  print("continue outer closes", counts());
  print("fromAsync", (await Array.fromAsync(iterable(["u", Promise.resolve("v")]))).map(kind).join("; "), counts());
  for await (const v of iterable([Promise.resolve("w")])) print("for await", kind(v), counts());
  print("union", [...new Set([1]).union({ size: 1, has() { return false; }, keys() { return iterable(["x"])[Symbol.iterator](); } })].map(kind).join("; "), counts());
  print("String.raw", String.raw({ raw: ["y", "z"] }, ...iterable([0])), counts());
  print("concat does not iterate", [].concat(iterable([1])).length, counts());
  print("apply does not iterate", Math.max.apply(null, { length: 1, 0: 9 }), counts());
}
main().catch(e => print("failed", String(e)));

// GENERATED: delegate has next
// CHECK-LABEL: function {{*}}name="delegate"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = Data data=[[d_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v3, -, v5 calleeName="iterable"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v8 = IteratorOpen v7 [isDelegating]
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = IteratorResume v8, v10 [readsValueWhenDone]
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Branch v12 -> taken b5(v13), notTaken b3(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = Yield v14
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Switch v18 cases=[1, 2] -> case b4(v17), case b6(v17), otherwise b2(v17)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = IteratorResume v8, v19 resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v21 = ResultAt v20
// CHECK-NEXT: v22 = ResultAt v20 index=1
// CHECK-NEXT: Branch v21 -> taken b5(v22), notTaken b3(v22)
// CHECK-NEXT: b5(v23):
// CHECK-NEXT: Return v23
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: v25 = IteratorResume v8, v24 resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v26 = ResultAt v25
// CHECK-NEXT: v27 = ResultAt v25 index=1
// CHECK-NEXT: Branch v26 -> taken b7(v27), notTaken b3(v27)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=false flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: v1 = Convert v0 declared={type=false flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_5]] flags=[IsFromCompiler]}, {type=undefined|null|string|Array flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: env [[L_5]], v1: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="stepped"
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="stepped"
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_8]]
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="i"
// CHECK-NEXT: v11 = PropGet v1 key="length"
// CHECK-NEXT: v12 = Convert v11 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v13 = Less v10, v12
// CHECK-NEXT: Branch v13 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v14 = Boolean
// CHECK-NEXT: v15 = Convert v14 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v16 = NewObject layout=[[L_6]]
// CHECK-NEXT: PropDefine v16, v15 key="done"
// CHECK-NEXT: v18 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="i"
// CHECK-NEXT: v20 = ToNumeric v19
// CHECK-NEXT: v21 = Increment v20
// CHECK-NEXT: v22 = Convert v21 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v23 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="i"
// CHECK-NEXT: PutEnvironmentField v0, v22 layout=[[L_5]]
// CHECK-NEXT: v26 = ElemGet v1, v20
// CHECK-NEXT: PropDefine v16, v26 key="value"
// CHECK-NEXT: v28 = FinishObject v16
// CHECK-NEXT: Jump -> next b4(v28)
// CHECK-NEXT: b3():
// CHECK-NEXT: v29 = Data data=[[d_9]]
// CHECK-NEXT: Jump -> next b4(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
