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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
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
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="readLater"
// CHECK-NEXT: v19 = Call v18 calleeName="readLater"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v21 = Call v12, v10, v16, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="console" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="log"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v27 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v28 = CheckInitialized v27 name="before"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="after"
// CHECK-NEXT: v31 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v32 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v34 = CheckInitialized v33 name="inAFunction"
// CHECK-NEXT: v35 = Call v26, v24, v28, v30, v31, v32, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Builtin builtin=GlobalThis
// CHECK-NEXT: v37 = PropGet v36 key="console" [isFreeName]
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="log"
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="early"
// CHECK-NEXT: v43 = Call v40, v38, v42 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v44 = Builtin builtin=GlobalThis
// CHECK-NEXT: v45 = PropGet v44 key="console" [isFreeName]
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="log"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v50 = CheckInitialized v49 name="later"
// CHECK-NEXT: v51 = Call v48, v46, v50 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v52 = Builtin builtin=GlobalThis
// CHECK-NEXT: v53 = PropGet v52 key="console" [isFreeName]
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v55 = PropGet v54 key="log"
// CHECK-NEXT: v56 = Convert v55 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v57 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v58 = CheckInitialized v57 name="first"
// CHECK-NEXT: v59 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v60 = CheckInitialized v59 name="laterInTheCycle"
// CHECK-NEXT: v61 = Call v60 calleeName="laterInTheCycle"
// CHECK-NEXT: v62 = Convert v61 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v63 = Call v56, v54, v58, v62 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v64 = Undefined
// CHECK-NEXT: Return v64
// CHECK-NEXT: }
