// RUN: lower
// OPTIONS: builtin-modules

// An interface merged into a generic class promises a member of its type parameter.
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

interface Box<T> {
  spare: T;
  spares: T[];
}
class Box<T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  either(): T {
    return this.spare ?? this.value;
  }
  swap(): void {
    const held = this.value;
    this.value = this.spare;
    this.spare = held;
  }
}

function spareOf<T>(box: Box<T>): T {
  return box.spare;
}

function spareNumber(box: Box<number>): number {
  return box.spare + 1;
}

function spareText(box: Box<string>): number {
  return box.spare.length;
}

const numbers = new Box(1.5);
const texts = new Box("text");
const lists = new Box([1, 2]);
const points = new Box({ x: 1 });

show("of number", () => [numbers.spare, spareOf(numbers), numbers.spare + 1, spareNumber(numbers)]);
show("of string", () => [texts.spare, spareOf(texts), texts.spare + "!"]);
show("of string: length", () => spareText(texts));
show("of a list", () => [lists.spare, spareOf(lists)]);
show("of a list: length", () => lists.spare.length);
show("of an object", () => [points.spare, spareOf(points)]);
show("of an object: member", () => points.spare.x);
show("the list of them", () => [numbers.spares, texts.spares]);
show("either", () => [numbers.either(), texts.either(), lists.either()]);
show("keys", () => [Object.keys(numbers), Object.keys(texts)]);

numbers.swap();
show("swapped: value", () => numbers.value);
show("swapped: value plus one", () => numbers.value + 1);
show("swapped: spare", () => [numbers.spare, spareNumber(numbers)]);
show("swapped: keys", () => Object.keys(numbers));
show("swapped: JSON", () => JSON.stringify(numbers));

texts.swap();
show("swapped text: value", () => texts.value);
show("swapped text: length of the value", () => texts.value.length);
show("swapped text: spare", () => [texts.spare, spareText(texts)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += spareNumber(numbers);
show("2000 where it is", () => sum);
show("one where it is not", () => spareNumber(new Box(2)));

// GENERATED: spareNumber show Box
// CHECK-LABEL: function {{*}}name="spareNumber"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="spare"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=": threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Box"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_11]] site=[[w_12]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_13]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|[[L_11]] site=[[w_14]]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v4, v6 key="value"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
