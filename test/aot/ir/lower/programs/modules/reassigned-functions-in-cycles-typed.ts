// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 7

// FILE: main.ts
// The same as reassigned-functions-in-cycles in TypeScript, where a function's name is stored to through a cast or under @ts-expect-error.
import "./cast-a";
import "./expected-a";
import "./generic-a";

// FILE: cast-a.ts
declare const console: { log(...values: unknown[]): void };
import { seen } from "./cast-b";
export function h(n: number): string { return "h" + n; }
export function setH(v: (n: number) => string): void { (h as any) = v; }
console.log("cast", seen, h(2));

// FILE: cast-b.ts
import { h } from "./cast-a";
export const seen: string = h(1);

// FILE: expected-a.ts
declare const console: { log(...values: unknown[]): void };
import { seen } from "./expected-b";
export function h(n: number): string { return "h" + n; }
// @ts-expect-error
export function setH(v: (n: number) => string): void { h = v; }
console.log("expected", seen, h(2));

// FILE: expected-b.ts
import { h, setH } from "./expected-a";
export const seen: string = h(1);
setH(n => "other" + n);

// FILE: generic-a.ts
declare const console: { log(...values: unknown[]): void };
import { seen } from "./generic-b";
export function first<T>(list: T[]): T | undefined;
export function first<T>(list: T[], otherwise: T): T;
export function first<T>(list: T[], otherwise?: T): T | undefined { return list.length ? list[0] : otherwise; }
export function replace(): void { (first as unknown) = <T>(list: T[]): T | undefined => list[list.length - 1]; }
console.log("generic", seen, first([1, 2]));

// FILE: generic-b.ts
import { first, replace } from "./generic-a";
export const seen: string = String(first([7, 8])) + first<string>([], "none");
replace();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
