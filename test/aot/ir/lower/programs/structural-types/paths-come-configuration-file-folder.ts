// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Paths come from a configuration file in another folder.
import { bump, count, Token } from "@lib/counter";
import { sum } from "@lib/shapes";
import Pixel from "assigned";
import { make, where } from "fields";
import * as direct from "./lib/counter";
import * as alias from "same-file";
import Required = require("assigned");

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

attempt("one file under three names", () => [bump(), direct.bump(), alias.bump(), count, direct.count, alias.count, direct.Token === Token, alias.Token === Token, new alias.Token() instanceof Token]);
attempt("which build of the package", () => [where, where === "module"]);
attempt("what it makes", () => [make().x, make().x + make().y, sum(make()), Object.keys(make()).join()]);
attempt("required", () => {
  const fields = require("fields");
  const p: { x: number; y: number } = fields.make();
  return [fields.where, sum(p)];
});
attempt("a class assigned to the exports of a typescript file", () => {
  const p = new Pixel(1, 2);
  return [typeof Pixel, Pixel === Required, p.sum(), sum(p), p instanceof Required, Object.keys(p).join()];
});
attempt("a subclass of it", () => {
  class Pixel3 extends Required {
    z = 3;
  }
  const p = new Pixel3(1, 2);
  return [p.sum() + p.z, Object.keys(p).join()];
});
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum({ x: i, y: 1 }) + new Pixel(i, 1).sum() + sum(new Required(i, 1));
console.log("2000 rounds: " + warm);

// FILE: lib/counter.ts
console.log("counter ran");

export let count = 0;

export function bump(): number {
  return ++count;
}

export class Token {
  id = bump();
}

// FILE: lib/shapes.ts
export interface Point {
  x: number;
  y: number;
}

export function sum(p: Point): number {
  return p.x + p.y;
}

// FILE: packages/assigned/index.ts
class Pixel {
  constructor(
    public x: number,
    public y: number,
  ) {}
  sum(): number {
    return this.x + this.y;
  }
}

export = Pixel;

// FILE: packages/assigned/package.json
{ "type": "commonjs" }

// FILE: packages/fields/esm/index.js
export const where = "module";
export function make() {
  return { x: 1, y: 2 };
}

// FILE: packages/fields/lib/index.js
exports.where = "main";
exports.make = function () {
  return { y: "2", x: "1" };
};

// FILE: packages/fields/package.json
{
  "name": "fields",
  "main": "./lib/index.js",
  "module": "./esm/index.js",
  "types": "./types/index.d.ts"
}

// FILE: packages/fields/types/index.d.ts
export declare const where: "module";
export declare function make(): { x: number; y: number };

// FILE: config/base.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "paths": { "@lib/*": [ "../lib/*" ], "fields": [ "../packages/fields" ], "assigned": [ "../packages/assigned/index.ts" ], "same-file": [ "../lib/counter.ts" ] } }, "files": [] }

// FILE: tsconfig.json
{
  "extends": "./config/base.json",
  "compilerOptions": {
    "strict": true
  }
}

// GENERATED: attempt Pixel3
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="show"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Pixel3"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
