// RUN: lower
// OPTIONS: builtin-modules

// Defensive checks inside a typed method are not folded away.
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

type Anything = number | string | boolean | null | undefined | bigint | symbol | Animal | number[] | (() => number);

interface Wide {
  number(v: Anything): string;
  string(v: Anything): string;
  dog(v: Anything): string;
  array(v: Anything): string;
  func(v: Anything): string;
}

class Careful implements Wide {
  number(n: number): string {
    if (typeof n !== "number") return "not a number: " + typeof n;
    if (n === undefined || n === null) return "nothing";
    if (Number.isNaN(n)) return "NaN";
    if (!Number.isInteger(n)) return "fraction " + n;
    return "whole " + n;
  }
  string(s: string): string {
    if (typeof s !== "string") return "not a string: " + typeof s;
    if (s == null) return "nothing";
    return "string of " + s.length;
  }
  dog(d: Dog): string {
    if (d === null) return "null";
    if (d === undefined) return "undefined";
    if (typeof d !== "object") return "not an object: " + typeof d;
    if (!(d instanceof Animal)) return "not an animal: " + Object.prototype.toString.call(d);
    if (!(d instanceof Dog)) return "an animal but not a dog";
    if (!("legs" in d)) return "a dog without legs";
    if (typeof d.legs !== "number") return "legs are " + typeof d.legs;
    return "dog on " + d.legs;
  }
  array(list: number[]): string {
    if (!Array.isArray(list)) return "not an array: " + typeof list;
    if (list.length === 0) return "empty";
    return "array of " + list.length;
  }
  func(f: () => number): string {
    if (typeof f !== "function") return "not a function: " + typeof f;
    return "function gives " + f();
  }
}

const wide: Wide = new Careful();
const legless = new Dog("legless");
const loose: { legs?: number } = legless;
delete loose.legs;
const wrongLegs = new Dog("wrong");
const wider: { legs: number | string } = wrongLegs;
wider.legs = "four";

const values: [string, Anything][] = [
  ["5", 5],
  ["2.5", 2.5],
  ["NaN", NaN],
  ["'text'", "text"],
  ["''", ""],
  ["true", true],
  ["null", null],
  ["undefined", undefined],
  ["7n", 7n],
  ["symbol", Symbol.iterator],
  ["dog", new Dog("rex")],
  ["cat", new Cat("tom")],
  ["legless dog", legless],
  ["dog with wrong legs", wrongLegs],
  ["literal", { name: "literal" }],
  ["[1]", [1]],
  ["[]", []],
  ["function", () => 3],
];

for (const [label, value] of values) {
  show(label + " as a number", () => wide.number(value));
  show(label + " as a string", () => wide.string(value));
  show(label + " as a dog", () => wide.dog(value));
  show(label + " as an array", () => wide.array(value));
  show(label + " as a function", () => wide.func(value));
}

// GENERATED: Person array Dog purr
// CHECK-LABEL: function {{*}}name="Person"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_2]]
// CHECK-NEXT: PropSet v4, v1 key="first"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="array"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: v1 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v2 = TypeTest v0 testedType=Array
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = Builtin builtin=Array
// CHECK-NEXT: v7 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v8 = Call v7, v6, v5 calleeName="Array.isArray"
// CHECK-NEXT: v9 = Convert v8 declared={type=boolean} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = ToBoolean v9
// CHECK-NEXT: Branch v10 -> taken b3(v4), notTaken b6(| 0)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = NarrowByTest v0, v11
// CHECK-NEXT: v13 = PropGet v12 key="length"
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = StrictEq v13, v14
// CHECK-NEXT: Branch v15 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: v17 = NarrowByField v12, v16 key="length"
// CHECK-NEXT: v18 = String string="empty"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: v21 = NarrowByField v12, v20 key="length"
// CHECK-NEXT: v22 = String string="array of "
// CHECK-NEXT: v23 = PropGet v21 key="length"
// CHECK-NEXT: v24 = Add v22, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: v27 = String string="not an array: "
// CHECK-NEXT: v28 = TypeOf v5
// CHECK-NEXT: v29 = Add v27, v28
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="purr"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_7]]} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: v1 = PropGet v0 key="name"
// CHECK-NEXT: v2 = String string=" purrs"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
