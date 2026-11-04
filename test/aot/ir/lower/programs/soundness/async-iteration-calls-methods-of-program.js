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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|number|string> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|number|string>):
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_1]]
// CHECK-NEXT: v2 = NewObject layout=[[L_2]]
// CHECK-NEXT: PropDefine v2, v1 key=@@asyncIterator
// CHECK-NEXT: v4 = FinishObject v2
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fromSync"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = String string="g"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="thenable"
// CHECK-NEXT: v6 = String string="h"
// CHECK-NEXT: v7 = NewArray v5, v6 contents=anything
// CHECK-NEXT: v8 = IteratorOpen v7 iteratorKind=Async [isDelegating]
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Jump -> next b1(v9)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: v11 = IteratorResume v8, v10 iteratorKind=Async [readsValueWhenDone]
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Branch v12 -> taken b4(v13), notTaken b2(v13)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v16 = Yield v14
// CHECK-NEXT: v17 = ResultAt v16
// CHECK-NEXT: v18 = ResultAt v16 index=1
// CHECK-NEXT: Switch v18 cases=[1, 2] -> case b3(v17), case b5(v17), otherwise b1(v17)
// CHECK-NEXT: b3(v19):
// CHECK-NEXT: v20 = IteratorResume v8, v19 iteratorKind=Async resumeMode=Throw [readsValueWhenDone]
// CHECK-NEXT: v21 = ResultAt v20
// CHECK-NEXT: v22 = ResultAt v20 index=1
// CHECK-NEXT: Branch v21 -> taken b4(v22), notTaken b2(v22)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: b5(v25):
// CHECK-NEXT: v26 = IteratorResume v8, v25 iteratorKind=Async resumeMode=Return [readsValueWhenDone]
// CHECK-NEXT: v27 = ResultAt v26
// CHECK-NEXT: v28 = ResultAt v26 index=1
// CHECK-NEXT: Branch v27 -> taken b6(v28), notTaken b2(v28)
// CHECK-NEXT: b6(v29):
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = String string="O"
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="note"
// CHECK-NEXT: v3 = NewClosure function=[[f_5]]
// CHECK-NEXT: v4 = NewClosure function=[[f_6]]
// CHECK-NEXT: v5 = NewObject -, v3, v4 layout=[[L_7]] fields=[0, 1]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="throw"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = String string="x"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="note"
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = String string="thrown "
// CHECK-NEXT: v7 = Add v6, v0
// CHECK-NEXT: v8 = NewObject -, v5, v7 layout=[[L_8]] fields=[0, 1]
// CHECK-NEXT: v9 = FinishObject v8
// CHECK-NEXT: v10 = Call v4, -, v9 calleeName="thenable"
// CHECK-NEXT: ReturnCall v10
// CHECK-NEXT: }
