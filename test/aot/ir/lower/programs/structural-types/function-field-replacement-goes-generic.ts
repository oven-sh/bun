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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="stepOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]], v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="step"
// CHECK-NEXT: v3 = Call v2, v0, v1 calleeKey="step" calleeName="m.step"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b5():
// CHECK-NEXT: v1 = Call v0 calleeName="body"
// CHECK-NEXT: v2 = TypeTest v1 testedType=number
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v3) handler=b5():
// CHECK-NEXT: v4 = NarrowByTest v1, v3
// CHECK-NEXT: v5 = Builtin builtin=String
// CHECK-NEXT: v6 = Call v5, -, v4 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: Jump -> next b4(v7)
// CHECK-NEXT: b3(v8) handler=b5():
// CHECK-NEXT: v9 = NarrowByTest v1, v8
// CHECK-NEXT: v10 = TypeOf v9
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = Builtin builtin=String
// CHECK-NEXT: v14 = Call v13, -, v9 calleeName="String"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = Add v12, v15
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b4(v17) handler=b5():
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v19 = CatchValue
// CHECK-NEXT: v20 = String string="threw "
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="Error" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v24 = InstanceOf v19, v23
// CHECK-NEXT: v25 = ToBoolean v24
// CHECK-NEXT: Branch v25 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: v27 = PropGet v19 key="constructor"
// CHECK-NEXT: v28 = PropGet v27 key="name"
// CHECK-NEXT: Jump -> next b8(v28)
// CHECK-NEXT: b7(v29):
// CHECK-NEXT: v30 = TypeOf v19
// CHECK-NEXT: Jump -> next b8(v30)
// CHECK-NEXT: b8(v31):
// CHECK-NEXT: v32 = Add v20, v31
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|number|string|symbol flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol, v2: anything):
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Machine"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_5]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
