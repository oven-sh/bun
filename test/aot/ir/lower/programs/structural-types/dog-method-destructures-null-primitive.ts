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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="others"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="name"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="name"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v7 = NewObject layout=[[L_6]]
// CHECK-NEXT: CopyDataProperties v7, v4 excludedKeys=["name"]
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = TypeOf v6
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = Builtin builtin=Object
// CHECK-NEXT: v15 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v16 = Call v15, v14, v10 calleeName="Object.keys"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Array<undefined|null|string> site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = PropGet v17 key="join"
// CHECK-NEXT: v19 = String string="+"
// CHECK-NEXT: v20 = Call v18, v17, v19 calleeKey="join" calleeName="join"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v22 = Add v13, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="list"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_2]]> site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_2]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b7():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_2]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b7():
// CHECK-NEXT: v6 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[L_2]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b7():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v11 = TypeOf v5
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: v14 = TypeOf v9
// CHECK-NEXT: v15 = Add v13, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: b7() role=IterationCleanup subject=v1:
// CHECK-NEXT: v17 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_13]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
