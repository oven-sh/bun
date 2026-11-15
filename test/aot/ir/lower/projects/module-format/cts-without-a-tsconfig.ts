// RUN: lower

// Without a tsconfig.json a .cts file may export in the ordinary way.

// FILE: main.ts
import { A, n } from "./lib.cts";
declare const console: { log(...values: unknown[]): void };
console.log(new A().v, n);

// FILE: lib.cts
export class A { v = 1 }
export const n = 2;
