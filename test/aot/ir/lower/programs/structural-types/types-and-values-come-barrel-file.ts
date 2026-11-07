// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5
// CHECK-LABEL: function {{*}}name="attempt"

// FILE: main.ts
// Types and values come through one barrel file.
import * as barrel from "./barrel";
import { Alone, Color, Level, Name, OnlyTypes, Pair, Shape, Square, WithValues } from "./barrel";
import * as local from "./through-a-local-name";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
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

const shape: Shape = new Square();
const name: Name = "n";
const alone: Alone = { n: 1 };
const pair: Pair = [1, 2];
const inner: OnlyTypes.Inner = { depth: 1 };

attempt("what the barrel holds", () => Object.keys(barrel).sort());
attempt("what the other file holds", () => Object.keys(local).sort());
attempt("values", () => [shape.sides, name, alone.n, pair[0] + pair[1], inner.depth, Color.Green, Color[1], Level.High, WithValues.depth]);
attempt("names that are only types, asked for at run time", () => ["Shape" in barrel, "Alone" in barrel, "OnlyTypes" in barrel, "Level" in barrel, "default" in local, Reflect.get(barrel, "Shape"), Reflect.get(local, "default")]);
attempt("the same class through both", () => [local.Square === Square, new local.Square() instanceof barrel.Square]);

// FILE: barrel.ts
console.log("barrel ran");

export { Square, Color, WithValues } from "./shapes";
export * from "./only-types";
export * from "./shapes";

// FILE: only-types.ts
console.log("only-types ran");

export interface Alone {
  n: number;
}

export type Pair = [number, number];

// FILE: shapes.ts
console.log("shapes ran");

export interface Shape {
  sides: number;
}

export type Name = string;

export class Square implements Shape {
  sides = 4;
}

export enum Color {
  Red,
  Green,
}

export const enum Level {
  Low = 1,
  High = 2,
}

export namespace OnlyTypes {
  export interface Inner {
    depth: number;
  }
}

export namespace WithValues {
  export const depth = 3;
}

// FILE: through-a-local-name.ts
console.log("through-a-local-name ran");

import { Square } from "./shapes";

export { Square };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "isolatedModules": false }, "files": [] }
