// RUN: lower
// OPTIONS: builtin-modules

// Members that one later store makes are used before that store.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Dog {
  weight: number;
  sound: string;
  roll(times: number): number;
}
class Dog {
  legs: number = 4;
}
declare namespace Dog {
  let make: (legs: number) => Dog;
  let count: number;
}

function helper(n: number): number {
  return n + 1;
}
declare namespace helper {
  let twice: (n: number) => number;
}

namespace Hooks {
  export let onDone: (n: number) => number;
  export let level: number;
}

let callback: (n: number) => number;
let total: number;

function attempt(run: () => unknown): string {
  try {
    const value = run();
    return typeof value + " " + String(value);
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : error instanceof ReferenceError ? "ReferenceError" : "another error";
  }
}

const dog = new Dog();

function all(): string[] {
  return [
    attempt(() => dog.weight),
    attempt(() => dog.weight + 1),
    attempt(() => dog.sound.length),
    attempt(() => dog.roll(2)),
    attempt(() => Dog.make(3).legs),
    attempt(() => Dog.count + 1),
    attempt(() => helper.twice(2)),
    attempt(() => Hooks.onDone(1)),
    attempt(() => Hooks.level + 1),
    attempt(() => callback(1)),
    attempt(() => total + 1),
  ];
}

function install(): void {
  Dog.prototype.weight = 30;
  Dog.prototype.sound = "woof";
  Dog.prototype.roll = function (this: Dog, times: number): number {
    return this.legs * times;
  };
  Dog.make = legs => {
    const made = new Dog();
    made.legs = legs;
    return made;
  };
  Dog.count = 1;
  helper.twice = n => n * 2;
  Hooks.onDone = n => n + 10;
  Hooks.level = 5;
  callback = n => n + 100;
  total = 7;
}

show("before", () => all());
show("before, again", () => all());
install();
show("after", () => all());

let letters = 0;
for (let i = 0; i < 2000; i++) letters += all().join().length;
show("2000 rounds", () => letters);

// GENERATED: attempt Dog callback
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="run"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = String string=" "
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Builtin builtin=String
// CHECK-NEXT: v6 = Call v5, -, v1 calleeName="String"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Add v4, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v10 = CatchValue
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="TypeError" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(TypeError) flags=[IsExpected]}
// CHECK-NEXT: v14 = InstanceOf v10, v13 writtenExpression="error instanceof TypeError"
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = String string="TypeError"
// CHECK-NEXT: Jump -> next b12(v17)
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="ReferenceError" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ReferenceError) flags=[IsExpected]}
// CHECK-NEXT: v22 = InstanceOf v10, v21 writtenExpression="error instanceof ReferenceError"
// CHECK-NEXT: v23 = ToBoolean v22
// CHECK-NEXT: Branch v23 -> taken b8(| 0), notTaken b10(| 0)
// CHECK-NEXT: b8(v24):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v25 = String string="ReferenceError"
// CHECK-NEXT: Jump -> next b12(v25)
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v27 = String string="another error"
// CHECK-NEXT: Jump -> next b12(v27)
// CHECK-NEXT: b12(v28):
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_7]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callback"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_8]]}] results=[{type=number site=[[w_9]]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=100
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
