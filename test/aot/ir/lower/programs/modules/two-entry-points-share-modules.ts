// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.ts worker.ts
// STATISTIC: SourceFilesChecked = 6
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
import type { Shape } from "./shapes";
import { log, name as nameOfFirst } from "./first";
import { Worker } from "node:worker_threads";
import { total } from "./third";

const late = () => import("./second");
const shape: Shape = { kind: "square", side: 2 };
log("main", nameOfFirst, total(shape.side), typeof late);
const worker = new Worker("./worker.ts");
worker.on("message", async (lines: string[]) => {
  for (const line of lines) console.log(line);
  const second = await late();
  log("main", second.name, second.area(shape));
  for (const line of (await import("./first")).lines) console.log(line);
});

// FILE: first.ts
export const lines: string[] = [];
export function log(...parts: unknown[]): void {
  lines.push(parts.join(" "));
}
export const name = "first";
log("first is evaluated");

// FILE: fourth.cjs
exports.fourth = 4;

// FILE: second.ts
import { log } from "./first";
import { describe, type Shape } from "./shapes";
export const name = "second";
export function area(shape: Shape): number {
  log("area of", describe(shape));
  return shape.kind === "square" ? shape.side * shape.side : Math.PI * shape.radius * shape.radius;
}
log("second is evaluated");

// FILE: shapes.ts
import { log } from "./first";
export type Shape = { kind: "square"; side: number } | { kind: "circle"; radius: number };
export function describe(shape: Shape): string {
  return shape.kind === "square" ? "a square of " + shape.side : "a circle of " + shape.radius;
}
log("shapes is evaluated");

// FILE: third.ts
import { log } from "./first";
let calls = 0;
export function total(n: number): number {
  return n * 10 + ++calls;
}
log("third is evaluated");

// FILE: worker.ts
// Two entry points share modules. The build lists main.ts first, so that is what the main thread runs: it imports a few modules statically, reaches others only through types and import(), and starts this file as a Worker, which imports all of them.
import { area, name as nameOfSecond } from "./second";
import { lines, log, name as nameOfFirst } from "./first";
import { total } from "./third";
import { describe } from "./shapes";
import { parentPort } from "node:worker_threads";

const required: { fourth: number } = require("./fourth.cjs");
log("worker", nameOfFirst, nameOfSecond, total(3), area({ kind: "circle", radius: 1 }).toFixed(2), describe({ kind: "square", side: 3 }), required.fourth);
parentPort!.postMessage(lines);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: late
// CHECK-LABEL: function {{*}}name="late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|object> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Promise<undefined|null|object> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
