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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Data data=[[d_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v5 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v5
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v4 key="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v17 = String string=" "
// CHECK-NEXT: v18 = Call v16, v4, v17 calleeKey="join" calleeName="found.join"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v14, v12, v0, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b14():
// CHECK-NEXT: v22 = Convert v9 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v23 = TypeTest v22 testedType=function
// CHECK-NEXT: Branch v23 -> taken b6(| 0), notTaken b12(| 0)
// CHECK-NEXT: b6(v24) handler=b14():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7() handler=b14():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: v25 = PropGet v4 key="push"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Builtin builtin=JSON
// CHECK-NEXT: v28 = PropGet v27 key="stringify"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v30 = String string="/some/where/file.txt"
// CHECK-NEXT: v31 = Call v24, -, v30 calleeName="value"
// CHECK-NEXT: v32 = Call v29, v27, v31 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v26, v4, v33 calleeKey="push" calleeName="found.push"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b14():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b10() role=CatchHandler handler=b14():
// CHECK-NEXT: v35 = CatchValue
// CHECK-NEXT: v36 = PropGet v4 key="push"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v35 key="constructor"
// CHECK-NEXT: v39 = PropGet v38 key="name"
// CHECK-NEXT: v40 = Call v37, v4, v39 calleeKey="push" calleeName="found.push"
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11() handler=b14():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b12(v41) handler=b14():
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13() handler=b14():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b14() role=IterationCleanup subject=v5:
// CHECK-NEXT: v42 = CatchException
// CHECK-NEXT: IteratorClose v5 completion=Throw
// CHECK-NEXT: Rethrow v42
// CHECK-NEXT: }
