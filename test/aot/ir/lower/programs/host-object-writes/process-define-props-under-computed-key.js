// RUN: lower
// OPTIONS: builtin-modules

// One key that Object.defineProperties defines under is computed, so the program does not say which members of process are looked for.
// How a TypeError of the language names what is no function is not what is tested here.
const told = error => error.constructor.name + (error instanceof TypeError && !/compiled/.test(error.message) ? "" : ": " + error.message);
function attempt(what, run) {
  try {
    const answer = run();
    console.log(what, typeof answer === "object" || typeof answer === "function" ? typeof answer : String(answer));
  } catch (error) {
    console.log(what, "threw " + told(error));
  }
}
const anew = value => ({ value, writable: true, enumerable: true, configurable: true });
const name = ["final", "ization"].join("");
attempt("the definition", () => Object.defineProperties(process, { markOfThisProgram: anew(1), [name]: anew(2) }) === process);
attempt("console.log", () => console.log("prints"));

// GENERATED: told anew
// CHECK-LABEL: function {{*}}name="told"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|TypeError flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|TypeError):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="constructor"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="name"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="TypeError" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v8 = InstanceOf v0, v7 writtenExpression="error instanceof TypeError"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b7(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = NewRegExp pattern="compiled"
// CHECK-NEXT: v12 = PropGet v11 key="test"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v0 key="message"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v13, v11, v15 calleeKey="test" calleeName="test"
// CHECK-NEXT: v17 = Convert v16 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v18 = ToBoolean v17
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v21 = String string=""
// CHECK-NEXT: Jump -> next b9(v21)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v23 = String string=": "
// CHECK-NEXT: v24 = PropGet v0 key="message"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v26 = Add v23, v25
// CHECK-NEXT: Jump -> next b9(v26)
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: v28 = Add v4, v27
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="anew"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_3]] flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v4 = NewObject -, v1 layout=[[L_3]] fields=[2]
// CHECK-NEXT: PropDefine v4, v3 key="writable"
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: v7 = Convert v6 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v7 key="enumerable"
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = Convert v9 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v10 key="configurable"
// CHECK-NEXT: v12 = FinishObject v4
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
