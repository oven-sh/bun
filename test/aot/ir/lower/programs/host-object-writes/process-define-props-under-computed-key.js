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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|TypeError flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|TypeError):
// CHECK-NEXT: v1 = PropGet v0 key="constructor"
// CHECK-NEXT: v2 = PropGet v1 key="name"
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="TypeError" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v6 = InstanceOf v0, v5
// CHECK-NEXT: v7 = ToBoolean v6
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b3()
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = NewRegExp pattern="compiled"
// CHECK-NEXT: v10 = PropGet v9 key="test"
// CHECK-NEXT: v11 = PropGet v0 key="message"
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeKey="test" calleeName="test"
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b3(), notTaken b2(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: v15 = String string=""
// CHECK-NEXT: Jump -> next b4(v15)
// CHECK-NEXT: b3():
// CHECK-NEXT: v16 = String string=": "
// CHECK-NEXT: v17 = PropGet v0 key="message"
// CHECK-NEXT: v18 = Add v16, v17
// CHECK-NEXT: Jump -> next b4(v18)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = Add v2, v19
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="anew"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = NewObject -, v0, v1, v2, v3 layout=[[L_1]] fields=[2, 3, 1, 0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
