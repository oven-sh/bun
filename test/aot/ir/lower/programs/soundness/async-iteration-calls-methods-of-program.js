// RUN: lower
// OPTIONS: builtin-modules

// Async iteration calls the methods of the program.
function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
let log = "";
function note(x) { log += x; }
function take() { const l = log; log = ""; return l; }
function thenable(value) { return { then(resolve) { note("t"); resolve(value); } }; }
function kind(v) { return typeof v + " " + String(v); }
function source(values) {
  return {
    [Symbol.asyncIterator]() {
      note("o");
      let i = 0;
      return {
        next(sent) { note("n"); return thenable(i < values.length ? { done: false, value: values[i++] } : { done: true, value: "end" }); },
        return(v) { note("r"); return thenable({ done: true, value: v }); },
        throw(e) { note("x"); return thenable({ done: true, value: "thrown " + e }); },
      };
    },
  };
}

async function main() {
  for await (const v of source(["a", 1])) print("for await", kind(v), take());
  print("after", take());
  for await (const v of source(["b", "c"])) { print("break", kind(v), take()); break; }
  print("after break", take());
  try { for await (const v of source(["d"])) throw "boom"; } catch (e) { print("throw", kind(e), take()); }

  async function* delegate() { const r = yield* source(["e", "f"]); print("delegate ends with", kind(r), take()); return "done"; }
  for await (const v of delegate()) print("yield*", kind(v), take());
  const it = delegate();
  print("first", kind((await it.next()).value), take());
  print("return through yield*", kind((await it.return("early")).value), take());
  const it2 = delegate();
  await it2.next(); take();
  print("throw through yield*", kind((await it2.throw("late")).value), take());

  async function* fromSync() { yield* [thenable("g"), "h"]; }
  for await (const v of fromSync()) print("yield* of a list", kind(v), take());

  const syncWithReturn = { [Symbol.iterator]() { note("O"); return { next() { note("N"); return { done: false, value: thenable("i") }; }, return() { note("R"); return {}; } }; } };
  for await (const v of syncWithReturn) { print("from sync", kind(v), take()); break; }
  print("from sync closed", take());

  const values = await Array.fromAsync(source(["j", 2]));
  print("fromAsync", values.map(kind).join("; "), take());

  const rejecting = { [Symbol.asyncIterator]() { return { next() { return { then(a, b) { note("T"); b("no"); } }; } }; } };
  try { for await (const v of rejecting) print("never"); } catch (e) { print("rejected", kind(e), take()); }

  const notAnObject = { [Symbol.asyncIterator]() { return { next() { return thenable(5); } }; } };
  try { for await (const v of notAnObject) print("never"); } catch (e) { print("bad result", e instanceof TypeError, take()); }
}
main().catch(e => print("failed", String(e)));

// GENERATED: source fromSync [Symbol.iterator] throw
// CHECK-LABEL: function {{*}}name="source"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v2 = NewObject layout=[[L_1]]
// CHECK-NEXT: PropDefine v2, v1 key=@@asyncIterator
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fromSync"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|AsyncGenerator<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = String string="g"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="thenable"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="h"
// CHECK-NEXT: v8 = NewArray v6, v7 contents=undefined|null|string|[[L_4]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<undefined|null|string|[[L_4]]> flags=[IsExpected]}
// CHECK-NEXT: v10 = IteratorOpen v9 iteratorKind=Async [isDelegating]
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = IteratorResume v10, v12 iteratorKind=Async [readsValueWhenDone]
// CHECK-NEXT: v14 = ResultAt v13
// CHECK-NEXT: v15 = ResultAt v13 index=1
// CHECK-NEXT: Branch v14 -> taken b5(v15), notTaken b3(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v18 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = Yield v18
// CHECK-NEXT: v20 = ResultAt v19
// CHECK-NEXT: v21 = ResultAt v19 index=1
// CHECK-NEXT: Switch v21 cases=[1, 2] -> case b4(v20), case b6(v20), otherwise b2(v20)
// CHECK-NEXT: b4(v22):
// CHECK-NEXT: v23 = IteratorResume v10, v22 iteratorKind=Async resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v24 = ResultAt v23
// CHECK-NEXT: v25 = ResultAt v23 index=1
// CHECK-NEXT: Branch v24 -> taken b5(v25), notTaken b3(v25)
// CHECK-NEXT: b5(v26):
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: b6(v28):
// CHECK-NEXT: v29 = IteratorResume v10, v28 iteratorKind=Async resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v30 = ResultAt v29
// CHECK-NEXT: v31 = ResultAt v29 index=1
// CHECK-NEXT: Branch v30 -> taken b7(v31), notTaken b3(v31)
// CHECK-NEXT: b7(v32):
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = String string="O"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="note"
// CHECK-NEXT: v3 = NewClosure function=[[f_7]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v5, v4 key="next"
// CHECK-NEXT: v7 = NewClosure function=[[f_9]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v5, v8 key="return"
// CHECK-NEXT: v10 = FinishObject v5
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="throw"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = String string="x"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="note"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v7 = NewObject layout=[[L_12]]
// CHECK-NEXT: PropDefine v7, v6 key="done"
// CHECK-NEXT: v9 = String string="thrown "
// CHECK-NEXT: v10 = Add v9, v0
// CHECK-NEXT: PropDefine v7, v10 key="value"
// CHECK-NEXT: v12 = FinishObject v7
// CHECK-NEXT: v13 = Call v4, -, v12 calleeName="thenable"
// CHECK-NEXT: ReturnCall v13 casts=[{declared={type=undefined|null|[[L_4]] flags=[IsExpected]}}]
// CHECK-NEXT: }
