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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="constructor"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="name"
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="TypeError" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v7 = InstanceOf v0, v6 writtenExpression="error instanceof TypeError"
// CHECK-NEXT: v8 = ToBoolean v7
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b7(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = NewRegExp pattern="compiled"
// CHECK-NEXT: v11 = PropGet v10 key="test"
// CHECK-NEXT: v12 = Convert v0 declared={type=undefined|null|TypeError flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="message"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Call v11, v10, v14 calleeKey="test" calleeName="test"
// CHECK-NEXT: v16 = Convert v15 declared={type=boolean site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v17 = ToBoolean v16
// CHECK-NEXT: Branch v17 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Jump -> next b8(v12)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v20 = String string=""
// CHECK-NEXT: Jump -> next b9(v20)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: Jump -> next b8(v0)
// CHECK-NEXT: b8(v22):
// CHECK-NEXT: v23 = String string=": "
// CHECK-NEXT: v24 = Convert v22 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="message"
// CHECK-NEXT: v26 = Add v23, v25
// CHECK-NEXT: Jump -> next b9(v26)
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: v28 = Add v3, v27
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="anew"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Boolean boolean=true
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean}
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean}
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean}
// CHECK-NEXT: v7 = NewObject -, v0, v2, v4, v6 layout=[[L_7]] fields=[2, 3, 1, 0]
// CHECK-NEXT: v8 = FinishObject v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
