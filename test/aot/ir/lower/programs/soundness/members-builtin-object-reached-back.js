// RUN: lower
// OPTIONS: builtin-modules

// Nothing names a function of node:path here. The object that holds them goes into native code and comes back as a value nobody knows,
// and its own values are read there: by Object.values, Object.entries, a spread and Object.assign. They have to be in the executable.
import * as path from "node:path";

function callAll(label, values) {
  const found = [];
  for (const value of values) {
    if (typeof value !== "function") continue;
    try {
      found.push(JSON.stringify(value("/some/where/file.txt")));
    } catch (error) {
      found.push(error.constructor.name);
    }
  }
  console.log(label, found.join(" "));
}

const target = new EventTarget();
target.addEventListener("values", event => callAll("values", Object.values(event.detail)));
target.addEventListener("entries", event => callAll("entries", Object.entries(event.detail).map(entry => entry[1])));
target.addEventListener("spread", event => {
  const copy = { ...event.detail };
  const values = [];
  for (const key in copy) values.push(copy[key]);
  callAll("spread", values);
});
target.addEventListener("assign", event => {
  const copy = Object.assign({}, event.detail);
  const values = [];
  for (const key in copy) values.push(copy[key]);
  callAll("assign", values);
});

for (const type of ["values", "entries", "spread", "assign"]) target.dispatchEvent(new CustomEvent(type, { detail: path.posix }));

// GENERATED: callAll
// CHECK-LABEL: function {{*}}name="callAll"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|Array<undefined|null|function> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|Array<undefined|null|function>):
// CHECK-NEXT: v2 = Data data=[[d_1]]
// CHECK-NEXT: v3 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v5 = IteratorResume v3
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Branch v6 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v2 key="join"
// CHECK-NEXT: v14 = String string=" "
// CHECK-NEXT: v15 = Call v13, v2, v14 calleeKey="join" calleeName="found.join"
// CHECK-NEXT: v16 = Call v12, v10, v0, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: v18 = Convert v7 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v19 = TypeTest v18 testedType=function
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v20) handler=b10():
// CHECK-NEXT: v21 = NarrowByTest v18, v20
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: v22 = PropGet v2 key="push"
// CHECK-NEXT: v23 = Builtin builtin=JSON
// CHECK-NEXT: v24 = PropGet v23 key="stringify"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v26 = String string="/some/where/file.txt"
// CHECK-NEXT: v27 = Call v21, -, v26 calleeName="value"
// CHECK-NEXT: v28 = Call v25, v23, v27 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v29 = Call v22, v2, v28 calleeKey="push" calleeName="found.push"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b7() role=CatchHandler handler=b10():
// CHECK-NEXT: v30 = CatchValue
// CHECK-NEXT: v31 = PropGet v2 key="push"
// CHECK-NEXT: v32 = PropGet v30 key="constructor"
// CHECK-NEXT: v33 = PropGet v32 key="name"
// CHECK-NEXT: v34 = Call v31, v2, v33 calleeKey="push" calleeName="found.push"
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b9(v35) handler=b10():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b10() role=IterationCleanup subject=v3:
// CHECK-NEXT: v36 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v36
// CHECK-NEXT: }
