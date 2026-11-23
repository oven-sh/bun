// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2
// CHECK-LABEL: function {{*}}name="nobodyCallsThis"
// CHECK-LABEL: function {{*}}name="width"
// CHECK-LABEL: function {{*}}name="made"
// CHECK-LABEL: function {{*}}name="color"
// CHECK-LABEL: function {{*}}name="grow"
// CHECK-LABEL: function {{*}}name="test"

// FILE: main.ts
// The application says "sideEffects": false, and of types.ts the program uses only types: an interface with a method, a function type, a generic alias, classes, an enum, a namespace, the types of a value and of a guard. The file is not in the executable; each type still has what the compiler makes for it.
import { unused, type Base, type Box, type Callback, type Color, type Pair, type Shape, type Units, type guard, type table } from "./types";

function nobodyCallsThis(): number {
  return unused();
}

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
console.log(shape.grow(1).size, shape.inner?.depth, callback(1), pair.first + pair.second, width(null), made(undefined), color(undefined), meter.meters, copy.a, copy.b, test(shape));

// FILE: package.json
{ "name": "application", "sideEffects": false }

// FILE: types.ts
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

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
