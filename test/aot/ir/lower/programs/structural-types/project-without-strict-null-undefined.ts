// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1

// FILE: main.ts
// A project without strict has null and undefined in every type.
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

interface Point {
  x: number;
  y: number;
}

class Dog {
  legs: number = 4;
  name: string;
  friend: Dog;
  bark(): number {
    return this.legs * 2;
  }
}

function half(n: number): number {
  return n / 2;
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

function glued(s: string): string {
  return s + "!";
}

function sum(p: Point): number {
  return p.x + p.y;
}

function total(list: number[]): number {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i];
  return result;
}

function legs(d: Dog): number {
  return d.legs;
}

function run(f: () => number): number {
  return f() + 1;
}

function yes(b: boolean): string {
  return b ? "yes" : "no";
}

function untyped(a, b) {
  return a + b;
}

function find(list: number[], wanted: number): number {
  return list.find(v => v === wanted);
}

function nothing(): number {
  return;
}

attempt("honest", () => [half(3), plusOne(1), size("ab"), glued("a"), sum({ x: 1, y: 2 }), total([1, 2]), legs(new Dog()), run(() => 1), yes(true), untyped(1, 2), find([1, 2], 2)]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += half(i) + plusOne(i) + size("ab") + sum({ x: i, y: 1 }) + total([i]) + legs(new Dog()) + run(() => i) + untyped(i, 1);
console.log("2000 honest rounds", warm);

attempt("null for a number", () => [half(null), plusOne(null)]);
attempt("undefined for a number", () => [half(undefined), plusOne(undefined)]);
attempt("null for a string: length", () => size(null));
attempt("null for a string: glued", () => glued(null));
attempt("undefined for a string: glued", () => glued(undefined));
attempt("null for a point", () => sum(null));
attempt("null inside a point", () => sum({ x: null, y: 2 }));
attempt("undefined inside a point", () => sum({ x: undefined, y: 2 }));
attempt("null for a list", () => total(null));
attempt("null and undefined inside a list", () => [total([1, null, 2]), total([1, undefined, 2])]);
attempt("null for a dog", () => legs(null));
attempt("null for a function", () => run(null));
attempt("a function that returns null", () => run(() => null));
attempt("null and undefined for a boolean", () => [yes(null), yes(undefined)]);
attempt("typed locals", () => {
  const n: number = null;
  let s: string = undefined;
  const list: number[] = [n, n];
  return [n + 1, s + "!", list, typeof n, typeof s];
});
attempt("fields nobody set", () => {
  const d = new Dog();
  return [d.name, typeof d.name, d.friend, Object.keys(d)];
});
attempt("fields nobody set: used", () => new Dog().name.length);
attempt("fields nobody set: a chain", () => new Dog().friend.legs);
attempt("a field set to null", () => {
  const d = new Dog();
  d.legs = null;
  return [d.bark(), d.legs + 1];
});
attempt("nothing found", () => [find([1, 2], 3), find([1, 2], 3) + 1]);
attempt("nothing returned", () => [nothing(), nothing() + 1]);
attempt("untyped parameters", () => [untyped("a", 1), untyped(null, 1), untyped(undefined, 1), untyped([1], [2]), untyped(1n, 2n)]);
attempt("untyped parameters that do not mix", () => untyped(1n, 2));
attempt("a variable without a type or a value", () => {
  let later;
  const before = typeof later;
  later = 5;
  const n: number = later;
  later = "text";
  const s: string = later;
  return [before, n + 1, s.length];
});
attempt("this without a type", () => {
  function whoAmI() {
    return typeof this;
  }
  return [whoAmI(), whoAmI.call(5), whoAmI.call("s"), whoAmI.call(null)];
});
attempt("a caught value", () => {
  try {
    throw null;
  } catch (e) {
    return e.message;
  }
});
attempt("honest again", () => [half(3), plusOne(1), size("ab"), sum({ x: 1, y: 2 }), total([1, 2]), legs(new Dog())]);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": false }, "files": [] }

// GENERATED: half total yes find Dog bark
// CHECK-LABEL: function {{*}}name="half"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Div v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number>}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = PropGet v0 key="length"
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = ElemGet v0, v6
// CHECK-NEXT: v11 = Add v5, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number}
// CHECK-NEXT: v13 = Increment v6
// CHECK-NEXT: v14 = Convert v13 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v12, v14)
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="yes"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=boolean}] results=[{type=undefined|null|string}] {
// CHECK-NEXT: b0(v0: boolean):
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = String string="yes"
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = String string="no"
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="find"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|Array<number>}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>, v1: number):
// CHECK-NEXT: v2 = PropGet v0 key="find"
// CHECK-NEXT: v3 = NewClosure v1 function=[[f_1]]
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="find" calleeName="list.find"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=number}}, {declared={type=number}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Dog"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_3]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="bark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_2]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="legs"
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
