// RUN: lower
// OPTIONS: builtin-modules

// One generic factory constructs many classes.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Small {
  a: number = 1;
}
class Large {
  a: string = "one";
  b: number = 2;
  c: number[] = [3];
  d: Small = new Small();
}
class Counting {
  static made: number = 0;
  id: number = ++Counting.made;
}
class Private {
  #secret: number = 5;
  reveal(): number {
    return this.#secret;
  }
}
abstract class Shape {
  abstract area(): number;
  describe(): string {
    return this.constructor.name + " " + this.area();
  }
}
class Square extends Shape {
  side: number = 2;
  area(): number {
    return this.side * this.side;
  }
}
class Circle extends Shape {
  radius: number = 1;
  area(): number {
    return 3 * this.radius;
  }
}

function build<T>(C: new () => T): T {
  return new C();
}
function buildMany<T>(C: new () => T, count: number): T[] {
  const list: T[] = [];
  for (let i = 0; i < count; i++) list.push(new C());
  return list;
}
function nameOf(C: abstract new () => Shape): string {
  return C.name + " " + C.length + " " + typeof C.prototype.describe;
}
function buildWith<A extends unknown[], T>(C: new (...args: A) => T, ...args: A): T {
  return new C(...args);
}

show("small", () => build(Small));
show("large", () => build(Large));
show("large b + 1", () => build(Large).b + 1);
show("small a + 1", () => build(Small).a + 1);
show("large a + 1", () => build(Large).a + 1);
show("counting", () => build(Counting).id);
show("counting again", () => build(Counting).id);
show("private", () => build(Private).reveal());
show("square", () => build(Square).describe());
show("circle", () => build(Circle).describe());
show("Date is a date", () => build(Date) instanceof Date);
show("Map", () => build(Map).size);
show("Array", () => build(Array).length);
show("Object", () => Object.keys(build(Object)).length);
show("Error", () => build(Error).message);
show("a set of numbers", () => build(Set<number>).add(1).size);
show("an anonymous class", () => build(class { z = 26; }).z);
show("abstract name", () => nameOf(Shape));
show("concrete name", () => nameOf(Square));
show("many", () => buildMany(Counting, 3).map(c => c.id).join());
show("with arguments: Map", () => buildWith(Map<string, number>, [["a", 1]]).get("a"));
show("with arguments: Array", () => buildWith(Array<number>, 3).length);
show("with arguments: Date", () => buildWith(Date, 0).getTime());

const shapes: (new () => Shape)[] = [Square, Circle, Square];
show("from an array of classes", () => shapes.map(C => new C().describe()).join());

let sum = 0;
for (let i = 0; i < 2000; i++) sum += build(Small).a;
show("2000 small ones", () => sum);
show("then a large one", () => build(Large).a);
show("then a small one", () => build(Small).a);

// GENERATED: buildWith show reveal Square
// CHECK-LABEL: function {{*}}name="buildWith"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|[[L_3]] site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v2, v1
// CHECK-NEXT: v4 = ConstructList v0, -, v2 calleeName="C"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]] site=[[w_5]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_7]]):
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
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
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
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_11]]} illTypedCause=Assertion
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
// CHECK-LABEL: function {{*}}name="reveal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_12]] site=[[w_13]]} results=[{type=number site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: [[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_12]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_14]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_17]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_18]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
