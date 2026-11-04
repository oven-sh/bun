// RUN: lower
// OPTIONS: builtin-modules

// The literal that Object.defineProperties takes its keys from stands behind a type assertion.
// How a TypeError of the language names what is no function is not what is tested here.
const told = (error: any) => error.constructor.name + (error instanceof TypeError && !/compiled/.test(error.message) ? "" : ": " + error.message);
function attempt(what: string, run: () => unknown) {
  try {
    const answer = run();
    console.log(what, typeof answer === "object" || typeof answer === "function" ? typeof answer : String(answer));
  } catch (error) {
    console.log(what, "threw " + told(error));
  }
}
const anew = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });
attempt("the definition", () => Object.defineProperties(process, { finalization: anew(1), allowedNodeEnvironmentFlags: anew(2) } as PropertyDescriptorMap) === process);
attempt("console.log", () => console.log("prints"));

// GENERATED: told anew
// CHECK-LABEL: function {{*}}name="told"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
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
// CHECK-NEXT: v13 = Convert v12 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b3(), notTaken b2(| 0)
// CHECK-NEXT: b2(v15):
// CHECK-NEXT: v16 = String string=""
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b3():
// CHECK-NEXT: v17 = String string=": "
// CHECK-NEXT: v18 = PropGet v0 key="message"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: Jump -> next b4(v19)
// CHECK-NEXT: b4(v20):
// CHECK-NEXT: v21 = Add v2, v20
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="anew"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Boolean boolean=true
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = NewObject -, v0, v1, v2, v3 layout=[[L_1]] fields=[2, 3, 1, 0]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
