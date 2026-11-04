// RUN: lower

// What verbatimModuleSyntax forbids in a CommonJS file (TS1287) keeps no program from running, so it stops no build: a .cts file exports in the ordinary way.
// CHECK: [[A]] = CheckInitialized {{*}}name="A"
// CHECK-NEXT: Construct [[A]] calleeName="A"
// CHECK: [[n]] = CheckInitialized {{*}}name="n"
// CHECK-NEXT: Call {{*}}, [[n]] calleeKey="log"

// FILE: main.ts
import { A, n } from "./lib.cts";
declare const console: { log(...values: unknown[]): void };
console.log(new A().v, n);

// FILE: lib.cts
export class A { v = 1 }
export const n = 2;

// FILE: tsconfig.json
{"compilerOptions":{"verbatimModuleSyntax":true,"module":"preserve","allowImportingTsExtensions":true,"noEmit":true}}
