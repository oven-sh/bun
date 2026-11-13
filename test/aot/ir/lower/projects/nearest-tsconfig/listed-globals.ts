// RUN: lower
// STATISTIC: SourceFilesDemoted = 0

// What the files that an imported file's tsconfig.json lists declare for every file is declared, though nothing imports them.

// FILE: app/main.ts
import { sum } from "../lib/index";
console.log(sum);

// FILE: app/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true}}

// FILE: lib/tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true},"include":["*.ts"]}

// FILE: lib/index.ts
globalThis.listed = 5;
globalThis.reached = 1;
export const sum: number = listed + reached;

// FILE: lib/nobody-imports-this.ts
declare global {
  var listed: number;
}
export function load() {
  return import("./outside/adds-a-global");
}

// FILE: lib/outside/adds-a-global.ts
declare global {
  var reached: number;
}
export {};
