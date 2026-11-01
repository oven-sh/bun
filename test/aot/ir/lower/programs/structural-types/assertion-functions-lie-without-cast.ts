// RUN: lower
// OPTIONS: builtin-modules

// Assertion functions that lie without a cast.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

class Animal {
  name = "animal";
}

class Dog extends Animal {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

class Cat extends Animal {
  lives = "nine";
}

function assertDog(a: Animal): asserts a is Dog {}

function assertNumber(v: number | string | null): asserts v is number {
  if (v === null) throw new RangeError("null");
}

function assertDefined<T>(v: T | undefined | null): asserts v is T {}

function assertTrue(condition: boolean): asserts condition {}

function assertList(v: unknown): asserts v is number[] {}

function legsOf(a: Animal): number {
  assertDog(a);
  return a.legs + 1;
}

function barkOf(a: Animal): number {
  assertDog(a);
  return a.bark();
}

function half(v: number | string | null): number {
  assertNumber(v);
  return v / 2;
}

function added(v: number | string | null): number {
  assertNumber(v);
  return v + 1;
}

function defined(v: number | undefined | null): number {
  assertDefined(v);
  return v + 1;
}

function checked(v: number | string): number {
  assertTrue(typeof v === "number");
  return v + 1;
}

function total(v: unknown): number {
  assertList(v);
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  return sum;
}

class Guarded {
  value: number | string = 1;
  assertNumeric(): asserts this is { value: number } {}
  next(): number {
    this.assertNumeric();
    return this.value + 1;
  }
}

attempt("honest", () => [legsOf(new Dog()), barkOf(new Dog()), half(4), added(1), defined(1), checked(1), total([1, 2]), new Guarded().next()]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += legsOf(new Dog()) + barkOf(new Dog()) + half(i) + added(i) + defined(i) + checked(i) + total([i]) + new Guarded().next();
console.log("2000 honest rounds", warm);

attempt("a cat: a field", () => legsOf(new Cat()));
attempt("a cat: a method", () => barkOf(new Cat()));
attempt("a string: half", () => half("8"));
attempt("a string: added", () => added("8"));
attempt("null throws what the function throws", () => half(null));
attempt("undefined", () => defined(undefined));
attempt("null", () => defined(null));
attempt("a condition that was false", () => checked("8"));
for (const [name, value] of [["a string", "12"], ["an array of strings", ["1", "2"]], ["an array-like", { length: 2, 0: 1, 1: 2 }], ["a set", new Set([1])], ["a number", 5], ["null", null], ["holes", new Array<number>(2)], ["a typed array", new Uint8Array([1, 2])]] satisfies [string, unknown][]) {
  attempt("taken for a list: " + name, () => total(value));
}
attempt("this is asserted", () => {
  const g = new Guarded();
  g.value = "text";
  return g.next();
});
attempt("asserted and then kept in a typed local, a field and an element", () => {
  const a: Animal = new Cat();
  assertDog(a);
  const local: Dog = a;
  const holder: { dog: Dog } = { dog: a };
  const list: Dog[] = [a];
  return [local.legs, holder.dog.legs, list[0].legs, local.name];
});
attempt("asserted once, used in a loop", () => {
  const values: (number | string)[] = [1, 2, "3", 4];
  let sum = 0;
  for (const v of values) {
    assertNumber(v);
    sum += v;
  }
  return sum;
});
attempt("honest again", () => [legsOf(new Dog()), barkOf(new Dog()), half(4), added(1), defined(1), checked(1), total([1, 2])]);

// GENERATED: assertNumber half total Dog bark
// CHECK-LABEL: function {{*}}name="assertNumber"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string site=[[w_1]] flags=[OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="RangeError" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="null"
// CHECK-NEXT: v7 = Construct v5, -, v6 calleeName="RangeError"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|RangeError flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Throw v8
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="half"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string site=[[w_2]] flags=[OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="assertNumber"
// CHECK-NEXT: v3 = Convert v0 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Div v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="assertList"
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_7]]}
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Jump -> next b2(v4, v6)
// CHECK-NEXT: b2(v7: number, v8: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v10 = Convert v8 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v11 = Convert v0 declared={type=undefined|null|Array<number>} illTypedCause=Assertion
// CHECK-NEXT: v12 = PropGet v11 key="length"
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_9]]} illTypedCause=Assertion
// CHECK-NEXT: v14 = Less v10, v13
// CHECK-NEXT: Branch v14 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v16 = Convert v15 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v17 = ElemGet v11, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_10]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v19 = Add v7, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Increment v16
// CHECK-NEXT: v22 = Convert v21 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Jump -> next b2(v20, v22)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v24 = Convert v7 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_12]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_13]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_12]] site=[[w_14]]} results=[{type=number site=[[w_15]]}] {
// CHECK-NEXT: b0(v0: [[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="legs"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
