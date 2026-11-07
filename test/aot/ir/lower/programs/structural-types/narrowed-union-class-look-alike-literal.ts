// RUN: lower
// OPTIONS: builtin-modules

// Narrowed a union of a class and a look alike literal.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "bigint") return "bigint " + String(value);
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(text).join(", ") + "]";
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

class Dog {
  name = "rex";
  legs = 4;
  speak(): string {
    return this.name + " barks";
  }
}

type Puppet = { name: string; strings: number; speak(): string };

function lookAlike(): Dog {
  return {
    name: "toy",
    legs: 0,
    speak() {
      return this.name + " squeaks";
    },
  };
}

function puppet(): Puppet {
  return { name: "punch", strings: 9, speak: () => "punch talks" };
}

function dogWithStrings(): Dog {
  return Object.assign(new Dog(), { strings: "attached" });
}

function byInstanceof(x: Dog | Puppet): unknown {
  if (x instanceof Dog) return ["a dog", x.legs, x.legs * 2, x.speak()];
  return ["a puppet", x.strings, x.strings * 2, x.speak()];
}

function byIn(x: Dog | Puppet): unknown {
  if ("strings" in x) return ["a puppet", x.strings, x.strings * 2, x.speak()];
  return ["a dog", x.legs, x.legs * 2, x.speak()];
}

function onlyDogs(x: Dog): unknown {
  if (x instanceof Dog) return ["a dog", x.legs, x.speak()];
  return ["typed never", typeof x];
}

function byConstructor(x: Dog | Puppet): unknown {
  if (x.constructor === Dog) return ["a dog", x.legs, x.speak()];
  return ["something else", x.name, x.speak()];
}

const values: [string, () => Dog | Puppet][] = [
  ["a dog", () => new Dog()],
  ["a puppet", puppet],
  ["a literal typed as a dog", lookAlike],
  ["a dog with strings attached", dogWithStrings],
];

for (let i = 0; i < 2000; i++) {
  byInstanceof(i % 2 === 0 ? new Dog() : puppet());
  byIn(i % 2 === 0 ? new Dog() : puppet());
  onlyDogs(new Dog());
}
for (const [name, make] of values) {
  attempt(name + " by instanceof", () => byInstanceof(make()));
  attempt(name + " by in", () => byIn(make()));
  attempt(name + " by its constructor", () => byConstructor(make()));
}
attempt("a dog where only dogs are allowed", () => onlyDogs(new Dog()));
attempt("a literal where only dogs are allowed", () => onlyDogs(lookAlike()));
attempt("in one array", () => [new Dog(), lookAlike(), puppet(), dogWithStrings()].map(byInstanceof));

// GENERATED: puppet dogWithStrings onlyDogs byConstructor Dog
// CHECK-LABEL: function {{*}}name="puppet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="punch"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = Integer integer=9
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = NewClosure function=[[f_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = NewObject -, v1, v3, v5 layout=[[L_1]] fields=[0, 2, 1]
// CHECK-NEXT: v7 = FinishObject v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="dogWithStrings"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Dog"
// CHECK-NEXT: v4 = Construct v3 calleeName="Dog"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_6]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v6 = Data data=[[d_11]]
// CHECK-NEXT: v7 = Call v1, v0, v5, v6 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|[[L_12]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="onlyDogs"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Dog"
// CHECK-NEXT: v3 = InstanceOf v0, v2 writtenExpression="x instanceof Dog"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = String string="a dog"
// CHECK-NEXT: v7 = PropGet v0 key="legs"
// CHECK-NEXT: v8 = PropGet v0 key="speak"
// CHECK-NEXT: v9 = Call v8, v0 calleeKey="speak" calleeName="x.speak"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = NewArray v6, v7, v10 contents=anything
// CHECK-NEXT: Return v11
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v13 = String string="typed never"
// CHECK-NEXT: v14 = TypeOf v0
// CHECK-NEXT: v15 = NewArray v13, v14 contents=anything
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="byConstructor"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]]|[[L_1]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="constructor"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="Dog"
// CHECK-NEXT: v4 = StrictEq v1, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = String string="a dog"
// CHECK-NEXT: v6 = Convert v0 declared={type=undefined|null|[[L_6]]} illTypedCause=Assertion
// CHECK-NEXT: v7 = PropGet v6 key="legs"
// CHECK-NEXT: v8 = PropGet v6 key="speak"
// CHECK-NEXT: v9 = Call v8, v6 calleeKey="speak" calleeName="x.speak"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = NewArray v5, v7, v10 contents=anything
// CHECK-NEXT: Return v11
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = String string="something else"
// CHECK-NEXT: v13 = PropGet v0 key="name"
// CHECK-NEXT: v14 = PropGet v0 key="speak"
// CHECK-NEXT: v15 = Call v14, v0 calleeKey="speak" calleeName="x.speak"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v17 = NewArray v12, v13, v16 contents=anything
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_6]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_6]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_19]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
