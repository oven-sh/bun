// RUN: lower
// OPTIONS: builtin-modules

// Type parameters bounded by themselves and by this.
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

interface Ordered<T> {
  compare(other: T): number;
}

class Meters implements Ordered<Meters> {
  constructor(public amount: number) {}
  compare(other: Meters): number {
    return this.amount - other.amount;
  }
}

class Words implements Ordered<Words> {
  constructor(public text: string) {}
  compare(other: Words): number {
    return this.text.length - other.text.length;
  }
}

function largest<T extends Ordered<T>>(list: T[]): T {
  let best = list[0];
  for (let i = 1; i < list.length; i++) if (list[i].compare(best) > 0) best = list[i];
  return best;
}

function sorted<T extends Ordered<T>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.compare(b));
}

class Point {
  x = 1;
  same(other: this): boolean {
    return this.x === other.x;
  }
  copy(): this {
    return this;
  }
}

class Point3 extends Point {
  z = 3;
  same(other: this): boolean {
    return super.same(other) && this.z.toFixed(0) === other.z.toFixed(0);
  }
}

class Chain {
  steps: string[] = [];
  add(step: string): this {
    this.steps.push(step);
    return this;
  }
}

class LoudChain extends Chain {
  shout(): this {
    this.steps = this.steps.map(s => s.toUpperCase());
    return this;
  }
}

attempt("honest", () => [largest([new Meters(1), new Meters(3), new Meters(2)]).amount, largest([new Words("a"), new Words("abc")]).text, sorted([new Meters(2), new Meters(1)]).map(m => m.amount), new Point().same(new Point()), new Point3().same(new Point3()), new LoudChain().add("a").shout().add("b").steps]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += largest([new Meters(i), new Meters(1)]).amount + largest([new Words("a"), new Words("ab")]).text.length + (new Point3().same(new Point3()) ? 1 : 0);
console.log("2000 honest rounds", warm);

attempt("meters and words in one list of things that compare with anything", () => {
  const meters: Ordered<Meters>[] = [new Meters(1)];
  const loose: Ordered<never>[] = [new Meters(1), new Words("abc")];
  return [meters.length, loose.length];
});
attempt("a method parameter is compared both ways", () => {
  const asMeters: Ordered<Meters> = new Meters(1);
  const wide: Ordered<Meters | Words> = asMeters;
  return wide.compare(new Words("abc"));
});
attempt("a method parameter is compared both ways: words get meters", () => {
  const asWords: Ordered<Words> = new Words("abc");
  const wide: Ordered<Meters | Words> = asWords;
  return wide.compare(new Meters(1));
});
attempt("a parameter of type this: the base is given to the subclass", () => {
  const p: Point = new Point3();
  return p.same(new Point());
});
attempt("a parameter of type this: honest through the base type", () => {
  const p: Point = new Point3();
  return p.same(new Point3());
});
attempt("an empty list", () => largest<Meters>([]));
attempt("an empty list, then a field", () => largest<Meters>([]).amount);
attempt("a literal that compares", () => {
  const literal: Ordered<Meters> & { amount: number } = { amount: 100, compare: () => 1 };
  const list: (Ordered<Meters> & { amount: number })[] = [new Meters(5), literal];
  let best = list[0];
  for (const item of list) if (item.compare(new Meters(0)) > 0) best = item;
  return best.amount;
});
attempt("compare answers something odd", () => {
  class Odd implements Ordered<Odd> {
    constructor(public n: number) {}
    compare(other: Odd): number {
      return this.n === other.n ? -0 : NaN;
    }
  }
  return [largest([new Odd(1), new Odd(2)]).n, sorted([new Odd(2), new Odd(1)]).map(o => o.n)];
});
attempt("this as a result, taken off the object", () => {
  const add = new Chain().add;
  return add("lost");
});
attempt("honest again", () => [largest([new Meters(1), new Meters(3)]).amount, new Point3().same(new Point3())]);

// GENERATED: sorted Meters same Point3
// CHECK-LABEL: function {{*}}name="sorted"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|[[L_1]]> flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Array<undefined|null|[[L_1]]> flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|[[L_1]]>):
// CHECK-NEXT: v1 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v1, v0
// CHECK-NEXT: v3 = PropGet v1 key="sort"
// CHECK-NEXT: v4 = NewClosure function=[[f_2]]
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="sort" calleeName="sort"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|Array<undefined|null|[[L_1]]> flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|Array<undefined|null|[[L_1]]> flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Meters"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: PropSet v4, v1 key="amount"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b1(| 0), notTaken b2(v4)
// CHECK-NEXT: b1(v9):
// CHECK-NEXT: Jump -> next b2(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_5]]} parameters=[{type=undefined|null|[[L_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: [[L_5]], v1: undefined|null|[[L_5]]):
// CHECK-NEXT: v2 = PropGet v0 key="x"
// CHECK-NEXT: v3 = PropGet v1 key="x"
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point3"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_8]]} parameters=[{type=undefined|null|[[L_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: [[L_8]], v1: undefined|null|[[L_8]]):
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v3 = GetSuperBase v2 homeKind=ClassPrototype
// CHECK-NEXT: v4 = SuperGet v3, v0 key="same"
// CHECK-NEXT: v5 = Call v4, v0, v1 calleeName="super.same"
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: v8 = PropGet v0 key="z"
// CHECK-NEXT: v9 = PropGet v8 key="toFixed"
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="toFixed" calleeName="this.z.toFixed"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = PropGet v1 key="z"
// CHECK-NEXT: v14 = PropGet v13 key="toFixed"
// CHECK-NEXT: v15 = Integer
// CHECK-NEXT: v16 = Call v14, v13, v15 calleeKey="toFixed" calleeName="other.z.toFixed"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v18 = StrictEq v12, v17
// CHECK-NEXT: Jump -> next b3(v18)
// CHECK-NEXT: b2(v19):
// CHECK-NEXT: Jump -> next b3(v19)
// CHECK-NEXT: b3(v20):
// CHECK-NEXT: v21 = Convert v20 declared={type=boolean}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
