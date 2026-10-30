// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
/// <reference path="./gadgets.d.ts" />
import { count, half, label, Lamp, ready, settings, sizes } from "gadgets";

function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function lengthOf(s: string): number {
  return s.length;
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + lengthOf("ab") + total([i, 1]);
show("2000 honest rounds", () => warm);

show("the number is text", () => [count, typeof count, count + 1, plusOne(count), count * 2]);
show("the text is a number", () => [label, typeof label, label + "!", lengthOf(label)]);
show("the text in capitals", () => label.toUpperCase());
show("the list is an array-like", () => [sizes.length, sizes[0], total(sizes), Array.isArray(sizes)]);
show("a method of the list", () => sizes.map(plusOne));
show("the list iterated", () => [...sizes]);
show("the boolean is text", () => [ready, ready ? "yes" : "no", ready === true, ready === false, !ready]);
show("the function answers text", () => [half(4), typeof half(4), plusOne(half(4))]);
show("a member is null and another is not there", () => [settings.depth, settings.depth + 1, settings.width, settings.width + 1]);
show("the class makes another member", () => {
  const lamp = new Lamp(60);
  return [lamp.watts, plusOne(lamp.watts), Object.keys(lamp)];
});
show("its method answers text", () => [new Lamp(60).brighter(), plusOne(new Lamp(60).brighter())]);
show("extended", () => {
  class Bright extends Lamp {
    extra: number = 1;
    both(): number {
      return this.watts + this.extra;
    }
  }
  const bright = new Bright(40);
  return [bright.both(), bright.brighter(), Object.keys(bright)];
});
show("honest again", () => [plusOne(1), lengthOf("ab"), total([1, 2])]);

// FILE: gadgets.d.ts
declare module "gadgets" {
  export const count: number;
  export const label: string;
  export const sizes: number[];
  export const ready: boolean;
  export function half(n: number): number;
  export const settings: { depth: number; width: number };
  export class Lamp {
    watts: number;
    constructor(watts: number);
    brighter(): number;
  }
}

// FILE: node_modules/gadgets/index.js
function Lamp(watts) {
  this.power = String(watts);
}
Lamp.prototype.brighter = function () {
  return this.power + "+";
};

module.exports = {
  count: "3",
  label: 7,
  sizes: { length: 2, 0: 1, 1: 2 },
  ready: "no",
  half: function (n) {
    return n / 2 + " halves";
  },
  settings: { depth: null },
  Lamp: Lamp,
};

// FILE: node_modules/gadgets/package.json
{
  "name": "gadgets",
  "version": "1.0.0",
  "main": "index.js"
}

// FILE: package.json
{
  "name": "a-declared-module-describes-other-types-than-the-package-exports",
  "type": "module"
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: plusOne lengthOf total Bright both
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="lengthOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_5]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v0 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = Less v8, v10
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Convert v12 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v14 = ElemGet v0, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=number site=[[w_12]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v16 = Add v5, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v18 = Increment v13
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Jump -> next b2(v17, v19)
// CHECK-NEXT: b6(v20):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v21 = Convert v5 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Bright"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_13]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_14]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="both"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_13]] site=[[w_15]]} results=[{type=number site=[[w_16]]}] {
// CHECK-NEXT: b0(v0: [[L_13]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="watts"
// CHECK-NEXT: v2 = PropGet v0 key="extra"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_16]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
