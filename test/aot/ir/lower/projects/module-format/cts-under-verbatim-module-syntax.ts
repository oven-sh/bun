// RUN: lower
// DIAGNOSTIC: TS1287 lib.cts:1
// DIAGNOSTIC: TS1287 lib.cts:2

// FILE: main.ts
import { A, n } from "./lib.cts";
declare const console: { log(...values: unknown[]): void };
console.log(new A().v, n);

// FILE: lib.cts
export class A { v = 1 }
export const n = 2;

// FILE: tsconfig.json
{"compilerOptions":{"verbatimModuleSyntax":true,"module":"preserve","allowImportingTsExtensions":true,"noEmit":true}}
