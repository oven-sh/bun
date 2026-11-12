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
