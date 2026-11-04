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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}, {type=Array flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]], v1: Array):
// CHECK-NEXT: v2 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v2, v1
// CHECK-NEXT: v4 = ConstructList v0, -, v2 calleeName="C"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=": threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reveal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_4]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_4]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_4]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
