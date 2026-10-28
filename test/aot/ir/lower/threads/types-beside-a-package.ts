// RUN(ONE): link
// ENTRY: app/main.ts
// CWD: app
// DIAGNOSTIC: TS2552 app/main.ts:7
// OPTIONS(ONE): threads=1
// RUN(T2A): link
// OPTIONS(T2A): threads=2
// SAME: ONE T2A
// RUN(T2B): link
// OPTIONS(T2B): threads=2
// SAME: ONE T2B
// RUN(T4A): link
// OPTIONS(T4A): threads=4
// SAME: ONE T4A
// RUN(T8A): link
// OPTIONS(T8A): threads=8
// SAME: ONE T8A
// RUN(T16A): link
// OPTIONS(T16A): threads=16
// SAME: ONE T16A
// RUN(T16B): link
// OPTIONS(T16B): threads=16
// SAME: ONE T16B

// `types` names what the folder of the project holds, and not what lies beside a package. Threads read the packages of both folders in an order that differs from run to run.

// FILE: app/main.ts
import { far } from "./far";
import { near } from "./near";
import type { Listed } from "listed";
declare const console: { log(...values: unknown[]): void };
const listed: Listed = { each: visit => visit(1), last: pick => pick("last") };
const own = { twice: (change: (value: number) => number) => change(change(1)) };
console.log(far(listed, own) + near(listed, own), listed.last(text => text + "!"), declaredIn_app, declaredIn_far, declaredIn_near);

// FILE: app/tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","allowJs":true,"noEmit":true,"skipLibCheck":true,"types":["listed"]},"include":["*.ts"]}

// FILE: app/node_modules/@types/listed/package.json
{"name":"@types/listed","version":"1.0.0","types":"index.d.ts"}

// FILE: app/node_modules/@types/listed/index.d.ts
export interface Listed { each(visit: (value: number) => number): number; last(pick: (text: string) => string): string }
declare global { var declaredIn_app: number; }

// FILE: app/far.ts
import { far0 } from "../far/node_modules/far0/index.js";
import { far1 } from "../far/node_modules/far1/index.js";
import { far2 } from "../far/node_modules/far2/index.js";
import { far3 } from "../far/node_modules/far3/index.js";
import type { Listed } from "listed";
export function far(listed: Listed, own: { twice(change: (value: number) => number): number }): number {
  return far0(listed, own) + far1(listed, own) + far2(listed, own) + far3(listed, own);
}

// FILE: far/node_modules/@types/listed/package.json
{"name":"@types/listed","version":"1.0.1","types":"index.d.ts"}

// FILE: far/node_modules/@types/listed/index.d.ts
export interface Listed { each(visit: (value: number) => number): number; last(pick: (text: string) => string): string }
declare global { var declaredIn_far: number; }

// FILE: far/node_modules/far0/package.json
{"name":"far0","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: far/node_modules/far0/index.js
export function far0(listed, own) { return listed.each(value => value + 0) + own.twice(value => value * 2); }

// FILE: far/node_modules/far0/index.d.ts
export interface Own { twice(change: (value: number) => number): number }
export declare function far0(listed: { each(visit: (value: number) => number): number }, own: Own): number;

// FILE: far/node_modules/far1/package.json
{"name":"far1","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: far/node_modules/far1/index.js
export function far1(listed, own) { return listed.each(value => value + 1) + own.twice(value => value * 2); }

// FILE: far/node_modules/far1/index.d.ts
export interface Own { twice(change: (value: number) => number): number }
export declare function far1(listed: { each(visit: (value: number) => number): number }, own: Own): number;

// FILE: far/node_modules/far2/package.json
{"name":"far2","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: far/node_modules/far2/index.js
export function far2(listed, own) { return listed.each(value => value + 2) + own.twice(value => value * 2); }

// FILE: far/node_modules/far2/index.d.ts
export interface Own { twice(change: (value: number) => number): number }
export declare function far2(listed: { each(visit: (value: number) => number): number }, own: Own): number;

// FILE: far/node_modules/far3/package.json
{"name":"far3","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: far/node_modules/far3/index.js
export function far3(listed, own) { return listed.each(value => value + 3) + own.twice(value => value * 2); }

// FILE: far/node_modules/far3/index.d.ts
export interface Own { twice(change: (value: number) => number): number }
export declare function far3(listed: { each(visit: (value: number) => number): number }, own: Own): number;

// FILE: app/near.ts
import { near0 } from "../near/node_modules/near0/index.js";
import { near1 } from "../near/node_modules/near1/index.js";
import { near2 } from "../near/node_modules/near2/index.js";
import { near3 } from "../near/node_modules/near3/index.js";
import type { Listed } from "listed";
export function near(listed: Listed, own: { twice(change: (value: number) => number): number }): number {
  return near0(listed, own) + near1(listed, own) + near2(listed, own) + near3(listed, own);
}

// FILE: near/node_modules/@types/listed/package.json
{"name":"@types/listed","version":"1.0.2","types":"index.d.ts"}

// FILE: near/node_modules/@types/listed/index.d.ts
export interface Listed { each(visit: (value: number) => number): number; last(pick: (text: string) => string): string }
declare global { var declaredIn_near: number; }

// FILE: near/node_modules/near0/package.json
{"name":"near0","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: near/node_modules/near0/index.js
export function near0(listed, own) { return listed.each(value => value + 0) + own.twice(value => value * 2); }

// FILE: near/node_modules/near0/index.d.ts
export interface Own { twice(change: (value: number) => number): number }
export declare function near0(listed: { each(visit: (value: number) => number): number }, own: Own): number;

// FILE: near/node_modules/near1/package.json
{"name":"near1","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: near/node_modules/near1/index.js
export function near1(listed, own) { return listed.each(value => value + 1) + own.twice(value => value * 2); }

// FILE: near/node_modules/near1/index.d.ts
export interface Own { twice(change: (value: number) => number): number }
export declare function near1(listed: { each(visit: (value: number) => number): number }, own: Own): number;

// FILE: near/node_modules/near2/package.json
{"name":"near2","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: near/node_modules/near2/index.js
export function near2(listed, own) { return listed.each(value => value + 2) + own.twice(value => value * 2); }

// FILE: near/node_modules/near2/index.d.ts
export interface Own { twice(change: (value: number) => number): number }
export declare function near2(listed: { each(visit: (value: number) => number): number }, own: Own): number;

// FILE: near/node_modules/near3/package.json
{"name":"near3","version":"1.0.0","main":"index.js","types":"index.d.ts"}

// FILE: near/node_modules/near3/index.js
export function near3(listed, own) { return listed.each(value => value + 3) + own.twice(value => value * 2); }

// FILE: near/node_modules/near3/index.d.ts
export interface Own { twice(change: (value: number) => number): number }
export declare function near3(listed: { each(visit: (value: number) => number): number }, own: Own): number;
