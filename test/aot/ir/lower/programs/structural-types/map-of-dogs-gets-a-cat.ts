// RUN: lower
// OPTIONS: builtin-modules

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Animal {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

class Dog extends Animal {
  legs = 4;
  tag = "dog tag";
  owner = { id: 7 };
  bark(): string {
    return this.name + " barks on " + this.legs;
  }
}

class Cat extends Animal {
  lives = "nine";
  indoor = true;
  purr(): string {
    return this.name + " purrs";
  }
}

function legsOf(dogs: Map<string, Dog>, name: string): number {
  const dog = dogs.get(name);
  return dog === undefined ? -1 : dog.legs + 1;
}

function barkOf(dogs: Map<string, Dog>, name: string): string {
  return dogs.get(name)?.bark() ?? "nobody";
}

function totalLegs(dogs: Map<string, Dog>): number {
  let total = 0;
  for (const dog of dogs.values()) total += dog.legs;
  return total;
}

function totalByEntries(dogs: Map<string, Dog>): string {
  let text = "";
  for (const [name, dog] of dogs) text += name + "=" + dog.legs + ";";
  return text;
}

function totalByForEach(dogs: Map<string, Dog>): number {
  let total = 0;
  dogs.forEach(dog => {
    total += dog.legs;
  });
  return total;
}

function add(animals: Map<string, Animal>, animal: Animal): void {
  animals.set(animal.name, animal);
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Map([["a", new Dog("a")], ["b", new Dog("b")]]);
  warm += legsOf(honest, "a") + barkOf(honest, "b").length + totalLegs(honest) + totalByEntries(honest).length + totalByForEach(honest);
}
console.log("after 2000 honest maps", warm);

const dogs = new Map<string, Dog>([["rex", new Dog("rex")]]);
const animals: Map<string, Animal> = dogs;
animals.set("tom", new Cat("tom"));
add(dogs, new Cat("kit"));
dogs.set("fido", new Dog("fido"));

for (const name of ["rex", "tom", "kit", "fido", "nobody"]) {
  attempt(name + ": legs + 1", () => legsOf(dogs, name));
  attempt(name + ": bark", () => barkOf(dogs, name));
}
attempt("total legs", () => totalLegs(dogs));
attempt("by entries", () => totalByEntries(dogs));
attempt("by forEach", () => totalByForEach(dogs));
attempt("values spread", () => [...dogs.values()].map(dog => dog.legs));
attempt("an old dog replaced by a cat", () => {
  animals.set("rex", new Cat("rex"));
  return [legsOf(dogs, "rex"), dogs.get("rex")?.tag, dogs.size];
});

attempt("dogs as keys", () => {
  const ages = new Map<Dog, number>([[new Dog("rex"), 3]]);
  const wide: Map<Animal, number> = ages;
  wide.set(new Cat("tom"), 5);
  let total = 0;
  for (const [dog, age] of ages) total += dog.legs * age;
  return [total, [...ages.keys()].map(dog => typeof dog.legs)];
});
attempt("numbers as values get a string", () => {
  const counts = new Map<string, number>([["a", 1]]);
  const wide: Map<string, number | string> = counts;
  wide.set("b", "two");
  let total = 0;
  for (const count of counts.values()) total += count;
  return [total, (counts.get("b") ?? 0) * 2, typeof counts.get("b")];
});
attempt("a readonly map changes under its reader", () => {
  const counts = new Map<string, number>([["a", 1]]);
  const view: ReadonlyMap<string, number> = counts;
  const before = [view.size, view.get("a")];
  counts.set("a", 2).set("b", 3);
  return [...before, view.size, view.get("a")];
});
attempt("a map of arrays of dogs", () => {
  const packs = new Map<string, Dog[]>([["home", [new Dog("rex")]]]);
  const wide: Map<string, Animal[]> = packs;
  wide.get("home")?.push(new Cat("tom"));
  wide.set("away", [new Cat("kit")]);
  return [...packs.values()].map(pack => pack.map(dog => dog.legs));
});

// GENERATED: totalLegs totalByForEach Animal Dog purr
// CHECK-LABEL: function {{*}}name="totalLegs"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, undefined|null|[[L_1]]> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, undefined|null|[[L_1]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v3 = PropGet v0 key="values"
// CHECK-NEXT: v4 = Call v3, v0 calleeKey="values" calleeName="dogs.values"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_5]]|Generator flags=[IsExpected]}
// CHECK-NEXT: v6 = IteratorOpen v5
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v7: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v6
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Convert v7 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v13 = Convert v11 declared={type=undefined|null|[[L_1]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v14 = PropGet v13 key="legs"
// CHECK-NEXT: v15 = Add v7, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v16)
// CHECK-NEXT: b7() role=IterationCleanup subject=v6:
// CHECK-NEXT: v17 = CatchException
// CHECK-NEXT: IteratorClose v6 completion=Throw
// CHECK-NEXT: Rethrow v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="totalByForEach"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Map<undefined|null|string, undefined|null|[[L_1]]> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Map<undefined|null|string, undefined|null|[[L_1]]>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewObject layout=[[L_9]]
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_10]]}
// CHECK-NEXT: PutEnvironmentField v1, v3 layout=[[L_9]]
// CHECK-NEXT: v5 = PropGet v0 key="forEach"
// CHECK-NEXT: v6 = NewClosure v1 function=[[f_11]]
// CHECK-NEXT: v7 = Call v5, v0, v6 calleeKey="forEach" calleeName="dogs.forEach"
// CHECK-NEXT: v8 = GetEnvironmentField v1 layout=[[L_9]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="total"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Animal"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_14]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_14]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_15]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v4, v6 key="name"
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
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_18]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="purr"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_19]] site=[[w_20]]} results=[{type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_19]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="name"
// CHECK-NEXT: v2 = String string=" purrs"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
