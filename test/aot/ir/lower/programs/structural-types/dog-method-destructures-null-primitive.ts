// RUN: lower
// OPTIONS: builtin-modules

// A dog method destructures null or a primitive.
class Person {
  first: string;
  constructor(first: string) {
    this.first = first;
  }
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs: number = 4;
  tag: string = "rex-tag";
  owner: Person = new Person("ann");
  tricks: string[] = ["sit", "roll"];
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives: string = "nine";
  weight: number = 3.5;
  toys: number[] = [7, 8, 9];
  enemy: Person = new Person("bob");
  purr(): string {
    return this.name + " purrs";
  }
}

class Spider extends Animal {
  legs: string = "eight";
  tag: number = 88;
}

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

type Wide = Animal | null | undefined | string | number;

interface Keeper {
  parts(a: Wide): string;
  nested(a: Wide): string;
  withDefaults(a: Wide): string;
  nothing(a: Wide): string;
  others(a: Wide): string;
  inBody(a: Wide): string;
  list(a: Wide[]): string;
}

class DogKeeper implements Keeper {
  parts({ legs, tag }: Dog): string {
    return typeof legs + " " + typeof tag;
  }
  nested({ owner: { first } }: Dog): string {
    return typeof first;
  }
  withDefaults({ legs = -1, name = "no name" }: Dog): string {
    return legs + " " + name;
  }
  nothing({}: Dog): string {
    return "took nothing";
  }
  others({ name, ...rest }: Dog): string {
    return typeof name + " " + Object.keys(rest).join("+");
  }
  inBody(d: Dog): string {
    const { legs } = d;
    return typeof legs;
  }
  list([first, second]: Dog[]): string {
    return typeof first + " " + typeof second;
  }
}

const keeper: Keeper = new DogKeeper();
const values: [string, Wide][] = [
  ["dog", new Dog("rex")],
  ["null", null],
  ["undefined", undefined],
  ["string", "text"],
  ["number", 5],
  ["cat", new Cat("tom")],
];
for (const [label, value] of values) {
  show(label + " parts", () => keeper.parts(value));
  show(label + " nested", () => keeper.nested(value));
  show(label + " withDefaults", () => keeper.withDefaults(value));
  show(label + " nothing", () => keeper.nothing(value));
  show(label + " others", () => keeper.others(value));
  show(label + " inBody", () => keeper.inBody(value));
}
show("list of two", () => keeper.list([new Dog("a"), null]));
show("list of none", () => keeper.list([]));
show("list of strings", () => keeper.list(["x", 5]));

// GENERATED: DogKeeper others list Dog
// CHECK-LABEL: function {{*}}name="DogKeeper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="others"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="name"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="name"
// CHECK-NEXT: v6 = NewObject layout=[[L_4]]
// CHECK-NEXT: CopyDataProperties v6, v4 excludedKeys=["name"]
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: v9 = TypeOf v5
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Builtin builtin=Object
// CHECK-NEXT: v13 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v14 = Call v13, v12, v8 calleeName="Object.keys"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v16 = PropGet v15 key="join"
// CHECK-NEXT: v17 = String string="+"
// CHECK-NEXT: v18 = Call v16, v15, v17 calleeKey="join" calleeName="join"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v20 = Add v11, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="list"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_2]]> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_2]]>):
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b3():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: v9 = TypeOf v4
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = TypeOf v7
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: b3() role=IterationCleanup subject=v1:
// CHECK-NEXT: v15 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_7]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
