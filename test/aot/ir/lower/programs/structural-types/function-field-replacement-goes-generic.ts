// RUN: lower
// OPTIONS: builtin-modules

// The only function field replacement goes through a generic setter.
function adder(amount: number): (n: number) => number {
  return n => n + amount;
}

function counter(prefix: string, box: { count: number }): (n: number) => number {
  return n => {
    box.count++;
    return prefix.length * 1000 + box.count * 100 + n;
  };
}

class Machine {
  step: (n: number) => number = adder(1);
  name = "machine";
  run(n: number): number {
    return this.step(this.step(n));
  }
}

function stepOf(m: Machine, n: number): number {
  return m.step(n);
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

const m = new Machine();
const other = new Machine();
const first = m.step;
const box = { count: 0 };

function attempt(body: () => number): string {
  try {
    const result: unknown = body();
    return typeof result === "number" ? String(result) : typeof result + " " + String(result);
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error);
  }
}

function report(label: string): void {
  console.log(label + ": " + attempt(() => m.step(1)) + " " + attempt(() => stepOf(m, 1)) + " " + attempt(() => m.run(1)) + " | " + other.step(1) + " " + stepOf(other, 1) + " " + other.run(1) + " | " + box.count + " " + Object.keys(m).join());
}

let sum = 0;
for (let i = 0; i < 2000; i++) sum += m.step(i) + stepOf(m, i) + m.run(i) + stepOf(other, i);
console.log("2000 honest rounds: " + sum);
report("before");
set(m, "step", adder(10));
report("the same definition with another amount");
set(m, "step", counter("abc", box));
report("another definition with other captures");
set(m, "step", Math.abs);
report("a built-in");
set(m, "step", first);
report("the first one again");

export {};

// GENERATED: adder stepOf attempt set Machine
// CHECK-LABEL: function {{*}}name="adder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stepOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_7]]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="step"
// CHECK-NEXT: v3 = Call v2, v0, v1 calleeKey="step" calleeName="m.step"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=number site=[[w_9]]}}, {declared={type=number site=[[w_8]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b8():
// CHECK-NEXT: v1 = Call v0 calleeName="body"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v3 = TypeTest v2 testedType=number
// CHECK-NEXT: Branch v3 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v4) handler=b8():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b8():
// CHECK-NEXT: v5 = Builtin builtin=String
// CHECK-NEXT: v6 = Convert v4 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="String"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b7(v8)
// CHECK-NEXT: b5(v9) handler=b8():
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b8():
// CHECK-NEXT: v10 = TypeOf v9
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Builtin builtin=String
// CHECK-NEXT: v14 = Call v13, -, v9 calleeName="String"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = Add v12, v15
// CHECK-NEXT: Jump -> next b7(v16)
// CHECK-NEXT: b7(v17) handler=b8():
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b8() role=CatchHandler:
// CHECK-NEXT: v19 = CatchValue
// CHECK-NEXT: v20 = String string="threw "
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="Error" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v24 = InstanceOf v19, v23 writtenExpression="error instanceof Error"
// CHECK-NEXT: v25 = ToBoolean v24
// CHECK-NEXT: Branch v25 -> taken b9(| 0), notTaken b11(| 0)
// CHECK-NEXT: b9(v26):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v27 = Convert v19 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="constructor"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|function site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: v30 = PropGet v29 key="name"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b13(v31)
// CHECK-NEXT: b11(v32):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v33 = TypeOf v19
// CHECK-NEXT: Jump -> next b13(v33)
// CHECK-NEXT: b13(v34):
// CHECK-NEXT: v35 = Add v20, v34
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[L_17]] site=[[w_18]]}, {type=undefined|null|[[L_19]] site=[[w_20]]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_17]], v1: undefined|null|[[L_19]], v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Machine"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_21]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
