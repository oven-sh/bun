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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = Data data=[[d_2]]
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="iterable"
// CHECK-NEXT: v6 = IteratorOpen v5 [isDelegating]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Jump -> next b1(v7)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = IteratorResume v6, v8 [readsValueWhenDone]
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b4(v11), notTaken b2(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v14 = Yield v12
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Switch v16 cases=[1, 2] -> case b3(v15), case b5(v15), otherwise b1(v15)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: v18 = IteratorResume v6, v17 resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v19 = ResultAt v18
// CHECK-NEXT: v20 = ResultAt v18 index=1
// CHECK-NEXT: Branch v19 -> taken b4(v20), notTaken b2(v20)
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: Return v21
// CHECK-NEXT: b5(v22):
// CHECK-NEXT: v23 = IteratorResume v6, v22 resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v24 = ResultAt v23
// CHECK-NEXT: v25 = ResultAt v23 index=1
// CHECK-NEXT: Branch v24 -> taken b6(v25), notTaken b2(v25)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_3]] flags=[IsFromCompiler]}, {type=undefined|null|Array flags=[IsExpected] variableName="values"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_3]], v1: undefined|null|Array):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="stepped"
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="stepped"
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_4]]
// CHECK-NEXT: v9 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="i"
// CHECK-NEXT: v11 = PropGet v1 key="length"
// CHECK-NEXT: v12 = Less v10, v11
// CHECK-NEXT: Branch v12 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v13 = Boolean
// CHECK-NEXT: v14 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="i"
// CHECK-NEXT: v16 = ToNumeric v15
// CHECK-NEXT: v17 = Increment v16
// CHECK-NEXT: v18 = Convert v17 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v19 = GetEnvironmentField v0 layout=[[L_3]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="i"
// CHECK-NEXT: PutEnvironmentField v0, v18 layout=[[L_3]]
// CHECK-NEXT: v22 = ElemGet v1, v16
// CHECK-NEXT: v23 = NewObject -, v13, v22 layout=[[L_5]] fields=[0, 1]
// CHECK-NEXT: v24 = FinishObject v23
// CHECK-NEXT: Jump -> next b3(v24)
// CHECK-NEXT: b2():
// CHECK-NEXT: v25 = Data data=[[d_6]]
// CHECK-NEXT: Jump -> next b3(v25)
// CHECK-NEXT: b3(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
