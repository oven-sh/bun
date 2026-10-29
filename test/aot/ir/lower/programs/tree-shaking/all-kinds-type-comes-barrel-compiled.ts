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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: Jump -> next b6(v3)
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v5 = PropGet v4 key="width"
// CHECK-NEXT: v6 = PropGet v4 key="area"
// CHECK-NEXT: v7 = Call v6, v4 calleeKey="area" calleeName="box.area"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v9 = Add v5, v8
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="made"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull]}] results=[{type=undefined|null|[[L_7]] site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b5(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_7]] site=[[w_8]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v4
// CHECK-NEXT: b5(v5):
// CHECK-NEXT: v6 = PropGet v5 key="make"
// CHECK-NEXT: v7 = Call v6, v5 calleeKey="make" calleeName="base?.make"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|[[L_7]] flags=[IsExpected]}}, {declared={type=undefined|null|[[L_7]] site=[[w_8]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="color"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|i32 site=[[w_9]]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="String"
// CHECK-NEXT: ReturnCall v2 casts=[{declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="grow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_12]]}] results=[{type=undefined|null|[[L_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_15]]] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_13]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = NewObject layout=[[L_13]]
// CHECK-NEXT: CopyDataProperties v3, v2
// CHECK-NEXT: v5 = Convert v0 declared={type=undefined|null|[[L_13]]} illTypedCause=Assertion
// CHECK-NEXT: v6 = PropGet v5 key="size"
// CHECK-NEXT: v7 = Add v6, v1
// CHECK-NEXT: v8 = Convert v7 declared={type=number}
// CHECK-NEXT: PropDefine v3, v8 key="size"
// CHECK-NEXT: v10 = FinishObject v3
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_13]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="test"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=boolean site=[[w_16]]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=null
// CHECK-NEXT: v2 = LogicalNot v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_16]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
