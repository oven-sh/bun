// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.ts
// Strings, record types, unions, classes, module variables and functions that several files mention are the same thing in each of them.
import { Circle, Shape, Square, area, describe, kinds, register, registry, total } from "./shapes";
import { Tagged, byTag, countOf, label, tags } from "./tags";
import { Ring, ringsMade, shrink } from "./rings";
import { basename } from "node:path";

type Either = Tagged | Shape | null;

function name(value: Either): string {
  if (value === null) return "nothing";
  if (value instanceof Shape) return describe(value);
  return label(value);
}

const shapes: Shape[] = [new Circle(2), new Square(3), new Ring(5, 1)];
for (const shape of shapes) register(shape);
console.log(shapes.map(name).join(" | "));
console.log(registry.size, total(), kinds.join(","));
console.log(area(shrink(new Ring(4, 2))).toFixed(3), ringsMade());

const tagged: Tagged[] = [
  { tag: "circle", weight: 1 },
  { tag: "square", weight: 2, note: "flat" },
  { tag: "circle", weight: 3 },
];
for (const one of tagged) byTag(one);
console.log(countOf("circle"), countOf("square"), countOf("ring"), tags().join(","));
console.log([null, tagged[1], shapes[2]].map(name).join(" | "));
console.log(basename("/a/b/shared.ts"), [...registry.keys()].sort().join(","));

// FILE: rings.ts
import { Circle, Shape } from "./shapes";
import type { Tagged } from "./tags";

let made = 0;

export class Ring extends Circle {
  override readonly kind: string = "ring";
  constructor(
    radius: number,
    public hole: number,
  ) {
    super(radius);
    made++;
  }
  override area(): number {
    return super.area() - Math.PI * this.hole * this.hole;
  }
  tagged(): Tagged {
    return { tag: this.kind, weight: this.radius - this.hole };
  }
}

export function shrink(shape: Ring | null | Shape): Shape {
  if (shape instanceof Ring) return new Ring(shape.radius - 1, shape.hole - 1);
  return shape ?? new Circle(0);
}

export function ringsMade(): number {
  return made;
}

// FILE: shapes.ts
import { basename } from "node:path";

export abstract class Shape {
  abstract readonly kind: string;
  abstract area(): number;
  toString(): string {
    return `${this.kind}:${this.area().toFixed(2)}`;
  }
}

export class Circle extends Shape {
  readonly kind: string = "circle";
  constructor(public radius: number) {
    super();
  }
  area(): number {
    return Math.PI * this.radius * this.radius;
  }
}

export class Square extends Shape {
  readonly kind: string = "square";
  constructor(public side: number) {
    super();
  }
  area(): number {
    return this.side * this.side;
  }
}

export const registry = new Map<string, Shape[]>();
export const kinds: string[] = [];
let sum = 0;

export function register(shape: Shape): void {
  const known = registry.get(shape.kind);
  if (known) known.push(shape);
  else {
    registry.set(shape.kind, [shape]);
    kinds.push(basename("/kinds/" + shape.kind));
  }
  sum += shape.area();
}

export function total(): string {
  return sum.toFixed(2);
}

export function area(shape: Shape): number {
  return shape.area();
}

export const describe = (shape: Shape): string => shape.toString();

// FILE: tags.ts
import { kinds } from "./shapes";

export interface Tagged {
  tag: string;
  weight: number;
  note?: string;
}

const counts = new Map<string, number>();

export function byTag(one: Tagged): void {
  counts.set(one.tag, (counts.get(one.tag) ?? 0) + one.weight);
}

export function countOf(tag: string): number {
  return counts.get(tag) ?? 0;
}

export function label(one: Tagged | null): string {
  return one === null ? "nothing" : `${one.tag}*${one.weight}${one.note ? "(" + one.note + ")" : ""}`;
}

export function tags(): string[] {
  return kinds.filter(kind => counts.has(kind));
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: name
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[L_2]] site=[[w_3]] flags=[OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = String string="nothing"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="Shape"
// CHECK-NEXT: v8 = InstanceOf v5, v7 writtenExpression="value instanceof Shape"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="describe"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_8]]} illTypedCause=Assertion
// CHECK-NEXT: v14 = Convert v5 declared={type=undefined|null|[[L_1]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Call v13, -, v14 calleeName="describe"
// CHECK-NEXT: ReturnCall v15 casts=[{declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: b8(v16):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="label"
// CHECK-NEXT: v19 = Convert v5 declared={type=undefined|null|[[L_2]]} illTypedCause=Assertion
// CHECK-NEXT: v20 = Call v18, -, v19 calleeName="label"
// CHECK-NEXT: ReturnCall v20 casts=[{declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
