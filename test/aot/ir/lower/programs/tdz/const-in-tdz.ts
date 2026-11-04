// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 6
// STATISTIC: SourceFilesInferred = 2
// STATISTIC: SourceFilesDemoted = 1

// FILE: main.ts
// Modules in an import cycle read each other's constants while those are still in their temporal dead zone.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
import { seen, readLater } from "./files/a";
import { late } from "./files/b";
import { before, after, inAFunction } from "./files/own";
import cjs from "./files/cjs.cjs";
import { early, later } from "./files/conditions";
import { first } from "./files/cycle_a";
import { later as laterInTheCycle } from "./files/cycle_b";
console.log(seen); console.log(late(), readLater());
console.log(before, after, cjs.before, cjs.after, inAFunction);
console.log(early); console.log(later);
console.log(first, laterInTheCycle());

// FILE: files/a.ts
import { early, viaNamespace } from "./b";
export const number = 37, text = "text", flag = true, nothing = null, sum = 1 + 2;
export function readLater(): string { return [number, text, flag, nothing, sum].join(); }
export const seen: string = early + " | " + viaNamespace;

// FILE: files/b.ts
import { number, text, flag, nothing, sum, readLater } from "./a";
import * as a from "./a";
function probe(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
export const early: string = [probe(() => number), probe(() => text), probe(() => flag), probe(() => nothing), probe(() => sum), probe(readLater)].join();
export const viaNamespace: string = [probe(() => a.number), probe(() => [a][0].text)].join();
export function late(): string { return [number, text, flag, nothing, sum].join(); }

// FILE: files/cjs.cjs
function probe(f) { try { return String(f()); } catch (e) { return e.constructor.name; } }
function hoisted() { return LIMIT * 2; }
exports.before = probe(hoisted);
const LIMIT = 21;
exports.after = probe(hoisted);

// FILE: files/conditions.ts
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
function value(): boolean { return K; }
function inIf(): string { if (K) return "then"; return "else"; }
function inCond(): string { return K ? "yes" : "no"; }
function inAnd(): unknown { return K && "right"; }
function inOr(): unknown { return Z || "right"; }
function inNot(): boolean { return !K; }
function inEq(): boolean { return N === 1; }
function inWhile(): string { while (K) return "looped"; return "not"; }
function inNested(): string { return (K && N === 1) ? "both" : "not both"; }
const all = [value, inIf, inCond, inAnd, inOr, inNot, inEq, inWhile, inNested];
export const early: string = all.map(attempt).join();
const K = true, N = 1, Z = 0;
export const later: string = all.map(attempt).join();

// FILE: files/cycle_a.ts
import { early } from "./cycle_b";
export function asked(): string { return FLAG ? "on" : "off"; }
export function askedIf(): string { if (FLAG) return "then"; return "else"; }
export function askedValue(): boolean { return FLAG; }
export const first: string = early;
export const FLAG = false;

// FILE: files/cycle_b.ts
import { asked, askedIf, askedValue } from "./cycle_a";
function attempt(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
export const early: string = [asked, askedIf, askedValue].map(attempt).join();
export function later(): string { return [asked, askedIf, askedValue].map(attempt).join(); }

// FILE: files/own.ts
function probe(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
function hoisted(): number { return LIMIT * 2; }
export const before: string = probe(hoisted);
const LIMIT = 21;
export const after: string = probe(hoisted);
function inner(): string {
  const read = () => local;
  const first = probe(read);
  const local = "set";
  return first + " " + probe(read);
}
export const inAFunction: string = inner();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="seen"
// CHECK-NEXT: v7 = Call v4, v2, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v14 = CheckInitialized v13 name="late"
// CHECK-NEXT: v15 = Call v14 calleeName="late"
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v17 = CheckInitialized v16 name="readLater"
// CHECK-NEXT: v18 = Call v17 calleeName="readLater"
// CHECK-NEXT: v19 = Call v12, v10, v15, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="before"
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="after"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v32 = CheckInitialized v31 name="inAFunction"
// CHECK-NEXT: v33 = Call v24, v22, v26, v28, v29, v30, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v34 = Builtin builtin=GlobalThis
// CHECK-NEXT: v35 = PropGet v34 key="console" [isFreeName]
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="log"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v39 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v40 = CheckInitialized v39 name="early"
// CHECK-NEXT: v41 = Call v38, v36, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v42 = Builtin builtin=GlobalThis
// CHECK-NEXT: v43 = PropGet v42 key="console" [isFreeName]
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v45 = PropGet v44 key="log"
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v47 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v48 = CheckInitialized v47 name="later"
// CHECK-NEXT: v49 = Call v46, v44, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Builtin builtin=GlobalThis
// CHECK-NEXT: v51 = PropGet v50 key="console" [isFreeName]
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v52 key="log"
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v55 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v56 = CheckInitialized v55 name="first"
// CHECK-NEXT: v57 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v58 = CheckInitialized v57 name="laterInTheCycle"
// CHECK-NEXT: v59 = Call v58 calleeName="laterInTheCycle"
// CHECK-NEXT: v60 = Call v54, v52, v56, v59 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v61 = Undefined
// CHECK-NEXT: Return v61
// CHECK-NEXT: }
