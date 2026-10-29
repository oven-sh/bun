// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 7

// FILE: main.ts
// A module imported by a computed name is untyped.
interface Point {
  x: number;
  y: number;
}

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function sum(p: Point): number {
  return p.x + p.y;
}

function plusOne(n: number): number {
  return n + 1;
}

class Holder {
  p: Point;
  n: number;
  constructor(p: Point, n: number) {
    this.p = p;
    this.n = n;
  }
  all(): number {
    return this.p.x + this.p.y + this.n;
  }
}

function load(name: string) {
  return import("./kinds/" + name + ".js");
}

const honest = await load("honest");
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const p: Point = honest.default();
  const n: number = honest.count;
  warm += sum(p) + plusOne(n) + new Holder(p, n).all();
}
console.log("2000 honest rounds: " + warm);

for (const name of ["honest", "swapped", "texts", "partial", "list", "text", "nothing", "honest"]) {
  const kind = await load(name);
  attempt(name + ", a local", () => {
    const p: Point = kind.default();
    return [p.x, p.y, p.x + p.y, Object.keys(p).join()];
  });
  attempt(name + ", a parameter", () => sum(kind.default()));
  attempt(name + ", fields", () => new Holder(kind.default(), kind.count).all());
  attempt(name + ", an element", () => {
    const list: Point[] = [{ x: 1, y: 2 }, kind.default()];
    return list.map(sum);
  });
  attempt(name + ", a function type", () => {
    const make: () => Point = kind.default;
    return sum(make());
  });
  attempt(name + ", a number", () => {
    const n: number = kind.count;
    return [n + 1, plusOne(n), typeof n];
  });
  attempt(name + ", an export that is not there", () => {
    const n: number = kind.absent;
    return [n, n + 1];
  });
}

try {
  await load("absent");
  console.log("a module that is not there was loaded");
} catch (error) {
  console.log("a module that is not there: " + (error instanceof Error ? "an error" : typeof error));
}

export {};

// FILE: kinds/honest.js
export default function make() {
  return { x: 1, y: 2 };
}

export const count = 3;

// FILE: kinds/list.js
export default function make() {
  return [1, 2];
}

export const count = "list";

// FILE: kinds/nothing.js
export default function make() {
  return null;
}

export const count = "nothing";

// FILE: kinds/partial.js
export default function make() {
  return { x: 1 };
}

export const count = "partial";

// FILE: kinds/swapped.js
export default function make() {
  return { y: 2, x: 1 };
}

export const count = "swapped";

// FILE: kinds/text.js
export default function make() {
  return "xy";
}

export const count = "text";

// FILE: kinds/texts.js
export default function make() {
  return { x: "1", y: "2" };
}

export const count = "texts";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: sum plusOne load Holder all
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_5]]}] results=[{type=number site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_6]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="./kinds/"
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = String string=".js"
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: SwitchString v4 strings=["./kinds/honest.js", "./kinds/list.js", "./kinds/nothing.js", "./kinds/partial.js", "./kinds/swapped.js", "./kinds/text.js", "./kinds/texts.js"] -> case b2(), case b3(), case b4(), case b5(), case b6(), case b7(), case b8(), otherwise b9()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = ImportModule module=[[m_8]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v5)
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = ImportModule module=[[m_9]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v6)
// CHECK-NEXT: b4():
// CHECK-NEXT: v7 = ImportModule module=[[m_10]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v7)
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = ImportModule module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v8)
// CHECK-NEXT: b6():
// CHECK-NEXT: v9 = ImportModule module=[[m_12]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v9)
// CHECK-NEXT: b7():
// CHECK-NEXT: v10 = ImportModule module=[[m_13]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v10)
// CHECK-NEXT: b8():
// CHECK-NEXT: v11 = ImportModule module=[[m_14]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v11)
// CHECK-NEXT: b9():
// CHECK-NEXT: v12 = ImportDynamic v4 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v12)
// CHECK-NEXT: b10(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_16]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]], v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_17]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_17]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_17]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_18]]
// CHECK-NEXT: v7 = Convert v1 declared={type=undefined|null|[[L_1]] site=[[w_19]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v5, v7 key="p"
// CHECK-NEXT: v9 = Convert v2 declared={type=number site=[[w_20]]}
// CHECK-NEXT: PropSet v5, v9 key="n"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="all"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_17]] site=[[w_21]]} results=[{type=number site=[[w_22]]}] {
// CHECK-NEXT: b0(v0: [[L_17]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="p"
// CHECK-NEXT: v2 = PropGet v1 key="x"
// CHECK-NEXT: v3 = PropGet v0 key="p"
// CHECK-NEXT: v4 = PropGet v3 key="y"
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = PropGet v0 key="n"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_22]]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
