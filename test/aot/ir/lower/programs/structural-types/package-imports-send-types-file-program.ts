// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// STATISTIC: SourceFilesInferred = 2

// FILE: main.ts
// Package imports send the types to one file and the program to another.
import { host, port, retries, timeout } from "#config";
import { name as first } from "#many/first";
import { name as second } from "#many/second";
import { built, Square } from "#shapes";
import { plusOne } from "#typed";

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

attempt("a number", () => [port, typeof port, port + 1, plusOne(port)]);
attempt("a text", () => [host, typeof host, host + "!"]);
attempt("the length of a text", () => host.length);
attempt("a list", () => [retries.length, retries[0], typeof retries]);
attempt("a list, mapped", () => retries.map(plusOne));
attempt("a result", () => [typeof timeout(), timeout() + 1, plusOne(timeout()), timeout() * 2]);
attempt("which build", () => [built, built === "default"]);
attempt("a class", () => {
  const s = new Square(3);
  return [s.side, typeof s.side, s.side + 1, s.area(), Object.keys(s).join()];
});
attempt("typed sources", () => [plusOne(1), first, second]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + new Square(i).area();
console.log("2000 rounds: " + warm);

// FILE: package.json
{
  "name": "split-app",
  "type": "module",
  "imports": {
    "#config": {
      "types": "./types/config.d.ts",
      "default": "./src/config.js"
    },
    "#shapes": {
      "types": "./types/shapes.d.ts",
      "bun": "./src/shapes-for-bun.js",
      "default": "./src/shapes.js"
    },
    "#typed": "./src/typed.ts",
    "#many/*": "./src/many/*.ts"
  }
}

// FILE: src/config.js
export const port = "8080";
export const host = null;
export const retries = "1,2";
export function timeout() {
  return { valueOf: () => 30 };
}

// FILE: src/many/first.ts
export const name: string = "first";

// FILE: src/many/second.ts
export const name: string = "second";

// FILE: src/shapes-for-bun.js
export class Square {
  constructor(side) {
    this.cached = side * side;
    this.side = String(side);
  }
  area() {
    return this.cached;
  }
}
export const built = "bun";

// FILE: src/shapes.js
export class Square {
  constructor(side) {
    this.side = side;
  }
  area() {
    return this.side * this.side;
  }
}
export const built = "default";

// FILE: src/typed.ts
export function plusOne(n: number): number {
  return n + 1;
}

// FILE: types/config.d.ts
export declare const port: number;
export declare const host: string;
export declare const retries: readonly number[];
export declare function timeout(): number;

// FILE: types/shapes.d.ts
export declare class Square {
  side: number;
  constructor(side: number);
  area(): number;
}
export declare const built: "default";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }

// GENERATED: attempt
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
