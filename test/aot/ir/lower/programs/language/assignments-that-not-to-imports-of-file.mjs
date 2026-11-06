// RUN: lower
// OPTIONS: builtin-modules

// Assignments that a build accepts: to names that hide an import, or written in text made at run time.
import { sep } from "node:path";
const say = (name, make) => {
  let answer;
  try {
    answer = make();
  } catch (error) {
    answer = error.constructor.name + ": " + error.message;
  }
  console.log(name + ": " + String(answer));
};
say("a parameter of the same spelling", () => (sep => (sep = 1))(0));
say("a name of the same spelling in a block", () => {
  let sep = 2;
  sep++;
  return sep;
});
say("evaluated text names the import", () => eval("sep = 4"));
say("evaluated text increments the import", () => eval("sep++"));
say("the import is as it was", () => sep);

// GENERATED: say
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = Call v1 calleeName="make"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = PropGet v6 key="constructor"
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = String string=": "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = PropGet v6 key="message"
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v13)
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=": "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=String
// CHECK-NEXT: v23 = Call v22, -, v14 calleeName="String"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v25 = Add v21, v24
// CHECK-NEXT: v26 = Call v19, v17, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
