// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// The application says "sideEffects": false, and lib/index.ts is a barrel written in TypeScript. The program asks it for one function, which is in used.ts, and of types.ts for types alone: some by `import type`, some by a plain import that is only used as a type. So nothing asks the barrel for a value of types.ts: the file is not compiled, the barrel does not export its names, and each type still has what the compiler makes of it. Every file prints when it is evaluated. `bun run` evaluates types.ts; `bun build --compile` does not.
import { used, Box, Color, Units, type Base, type Callback, type Pair, type Shape, type guard, type table } from "./lib";

const shape: Shape = { size: 2, grow(by) { return { ...this, size: this.size + by }; }, inner: { depth: 1 } };
const callback: Callback = value => "v" + value;
const pair: Pair<number> = { first: 1, second: 2 };
function width(box: Box | null): number {
  return box === null ? 0 : box.width + box.area();
}
function made<T>(base: Base<T> | undefined): T | undefined {
  return base?.make();
}
function color(value: Color | undefined): string {
  return String(value);
}
const meter: Units.Meter = { meters: 3 };
const copy: typeof table = { a: 4, b: "five" };
const test: typeof guard = ((value: unknown) => value !== null) as typeof guard;
console.log(used(shape), shape.grow(1).size, shape.inner?.depth, callback(1), pair.first + pair.second, width(null), made(undefined), color(undefined), meter.meters, copy.a, copy.b, test(shape));

// FILE: lib/index.ts
export { used } from "./used";
export { unused, Box, Base, Color, Units, table, guard, type Shape, type Callback, type Pair } from "./types";

// FILE: lib/types.ts
console.log("types.ts is evaluated");
export interface Shape {
  size: number;
  grow(by: number): Shape;
  readonly inner?: { depth: number };
}
export type Callback = (value: number) => string;
export type Pair<T> = { first: T; second: T };
export class Box {
  static count = 0;
  constructor(public width: number) {}
  area(): number {
    return this.width * this.width;
  }
}
export abstract class Base<T> {
  abstract make(): T;
}
export enum Color {
  Red,
  Green,
}
export namespace Units {
  export interface Meter {
    meters: number;
  }
}
export function unused(): number {
  return 1;
}
export const table = { a: 1, b: "two" };
export function guard(value: unknown): value is Shape {
  return typeof value === "object";
}

// FILE: lib/used.ts
import type { Shape } from "./types";

console.log("used.ts is evaluated");
export function used(shape: Shape): number {
  return shape.size * 10;
}

// FILE: package.json
{ "name": "application", "sideEffects": false }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: width made color grow test
// CHECK-LABEL: function {{*}}name="width"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = PropGet v5 key="width"
// CHECK-NEXT: v7 = PropGet v5 key="area"
// CHECK-NEXT: v8 = Call v7, v5 calleeKey="area" calleeName="box.area"
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[OmitsNull]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="make"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="make" calleeName="base?.make"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="color"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|i32}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|i32):
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="String"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="grow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: v2 = NewObject layout=[[L_3]]
// CHECK-NEXT: CopyDataProperties v2, v0
// CHECK-NEXT: v4 = PropGet v0 key="size"
// CHECK-NEXT: v5 = Add v4, v1
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: PropDefine v2, v6 key="size"
// CHECK-NEXT: v8 = FinishObject v2
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="test"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
