// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK-LABEL: function {{*}}name="size"
// CHECK-LABEL: function {{*}}name="attempt"

// FILE: main.ts
import { Box, count, double, name, origin } from "./values.js";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

function plusOne(n: number): number {
  return n + 1;
}

function size(s: string): number {
  return s.length;
}

attempt("which file was loaded", () => origin);
attempt("honest", () => [plusOne(1), size("ab")]);
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab");
console.log("2000 honest rounds", warm);
attempt("count", () => [count, typeof count, plusOne(count), count + 1]);
attempt("name", () => [name, typeof name, name + "!"]);
attempt("name: size", () => size(name));
attempt("double", () => [double(2), plusOne(double(2)), [1, 2].map(double)]);
attempt("a class", () => {
  const b = new Box();
  return [b.value, b.get(), plusOne(b.get()), plusOne(b.value), Object.keys(b)];
});
attempt("honest again", () => [plusOne(1), size("ab")]);

// FILE: values.js
export const count = "one";
export const name = 7;
export function double(n) {
  return String(n) + String(n);
}
export class Box {
  constructor() {
    this.held = "js";
  }
  get() {
    return this.held;
  }
}
export const origin = "values.js";

// FILE: values.ts
export const count: number = 1;
export const name: string = "typescript";
export function double(n: number): number {
  return n * 2;
}
export class Box {
  value = 1;
  get(): number {
    return this.value;
  }
}
export const origin = "values.ts";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true }, "files": [] }
