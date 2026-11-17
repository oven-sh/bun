// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="attempt"

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
