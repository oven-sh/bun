// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 5

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

// GENERATED: attempt
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=" threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
