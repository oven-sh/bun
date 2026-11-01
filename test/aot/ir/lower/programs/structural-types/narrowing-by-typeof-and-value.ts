// RUN: lower
// OPTIONS: builtin-modules

// Narrowing by typeof and a value that is both.
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

class Dog {
  legs = 4;
  bark(): number {
    return this.legs * 2;
  }
}

type Handler = (() => number) | Dog;

function use(h: Handler): number {
  return typeof h === "function" ? h() : h.bark();
}

function legs(h: Handler): number {
  if (typeof h === "object") return h.legs;
  return h() + 100;
}

function size(v: string | string[]): number {
  return typeof v === "string" ? v.length * 10 : v.length;
}

function head(v: string | string[]): string {
  if (typeof v === "string") return v.charAt(0);
  return v[0];
}

function number(v: number | { valueOf(): number }): number {
  return typeof v === "number" ? v + 1 : v.valueOf() + 2;
}

function text(v: string | { toString(): string }): string {
  return typeof v === "string" ? v + "!" : v.toString() + "?";
}

function orNull(v: Dog | null): string {
  return typeof v === "object" ? (v === null ? "null" : "dog " + v.legs) : "never";
}

attempt("honest use", () => [use(() => 1), use(new Dog())]);
attempt("honest legs", () => [legs(() => 1), legs(new Dog())]);
attempt("honest size", () => [size("ab"), size(["a", "b", "c"])]);
attempt("honest head", () => [head("ab"), head(["cd"])]);
attempt("honest number", () => [number(1), number({ valueOf: () => 1 })]);
attempt("honest text", () => [text("a"), text({ toString: () => "b" })]);
attempt("honest orNull", () => [orNull(null), orNull(new Dog())]);
let warm = 0;
const dog = new Dog();
const five = () => 5;
for (let i = 0; i < 2000; i++) warm += use(i & 1 ? dog : five) + legs(i & 1 ? dog : five) + size(i & 1 ? "ab" : ["a"]) + number(i) + text("a").length;
console.log("2000 honest rounds", warm);

attempt("a callable dog: use", () => {
  const both: Dog = Object.assign(() => 77, new Dog(), { bark: () => 88 });
  return use(both);
});
attempt("a callable dog: legs", () => {
  const both: Dog = Object.assign(() => 77, new Dog(), { bark: () => 88 });
  return legs(both);
});
attempt("a class is a function", () => {
  class Made {
    static legs = 3;
    static bark(): number {
      return 9;
    }
  }
  const d: Dog = Made;
  return [legs(d)];
});
attempt("a class is a function: use", () => {
  class Made {
    static legs = 3;
    static bark(): number {
      return 9;
    }
  }
  const d: Dog = Made;
  return use(d);
});
attempt("an array subclass under string[]", () => {
  class Words extends Array<string> {
    get first(): string {
      return this[0];
    }
  }
  const words = new Words();
  words.push("x", "y");
  return [size(words), head(words)];
});
attempt("the test kept in a variable", () => {
  const check = (v: number | string): number => {
    const isNumber = typeof v === "number";
    if (isNumber) return v + 1;
    return v.length;
  };
  return [check(1), check("abc")];
});
attempt("typeof in a switch", () => {
  const check = (v: number | string | boolean | undefined | bigint | symbol | null | (() => void) | Dog): string => {
    switch (typeof v) {
      case "number":
        return "number " + (v + 1);
      case "string":
        return "string " + v.length;
      case "boolean":
        return "boolean " + !v;
      case "undefined":
        return "undefined";
      case "bigint":
        return "bigint " + (v + 1n);
      case "symbol":
        return "symbol " + v.description;
      case "function":
        return "function " + v.length;
      case "object":
        return v === null ? "null" : "dog " + v.legs;
    }
  };
  return [check(1), check("a"), check(true), check(undefined), check(1n), check(Symbol("s")), check(() => {}), check(null), check(new Dog()), check(-0), check(NaN)];
});
attempt("honest again", () => [use(() => 1), use(new Dog()), legs(new Dog()), size("ab"), head(["cd"]), number(1), text("a"), orNull(null)]);

// GENERATED: head text Dog five Words first
// CHECK-LABEL: function {{*}}name="head"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array<undefined|null|string> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v4 = PropGet v3 key="charAt"
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Call v4, v3, v5 calleeKey="charAt" calleeName="v.charAt"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string>} illTypedCause=Assertion
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="text"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|boolean|number|string|symbol|bigint|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|boolean|number|string|symbol|bigint|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=string
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v4 = String string="!"
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = PropGet v6 key="toString"
// CHECK-NEXT: v8 = Call v7, v6 calleeKey="toString" calleeName="v.toString"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v10 = String string="?"
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b6(v12):
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_9]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_9]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_10]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="five"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=number site=[[w_11]]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Words"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_13]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="first"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_13]] site=[[w_14]]} results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
