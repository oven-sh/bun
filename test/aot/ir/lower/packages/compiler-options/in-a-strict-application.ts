// RUN: lower
// STATISTIC: AotFilesUsed = 6

// The file under a package's aot condition means what the compilerOptions of its package.json say, whatever the application's tsconfig.json says.

// FILE: app.ts
import { byHand } from "by-hand";
import { strict } from "strict";
import { withCheckedIndexes } from "with-checked-indexes";
import { withDom } from "with-dom";
import { withoutDom } from "without-dom";
import { withoutNullChecks } from "without-null-checks";
console.log(byHand(undefined), strict("Ada"), withCheckedIndexes([]), withDom({ tagName: "P" }));
console.log(withoutDom({ label: "a label" }), withoutNullChecks("first"), withoutNullChecks("second"));

// FILE: package.json
{"name":"app","private":true,"type":"module"}

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true,"exactOptionalPropertyTypes":true,"lib":["esnext"]}}

// FILE: node_modules/by-hand/package.json
{"name":"by-hand","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}}}

// FILE: node_modules/by-hand/index.js
const checksNull = true;
export function byHand(name) {
  return (name ?? "nobody") + " " + checksNull;
}

// FILE: node_modules/by-hand/index.aot.ts
type ChecksNull = undefined extends string ? false : true;
const checksNull: ChecksNull = true;
export function byHand(name: string | undefined): string {
  return (name ?? "nobody") + " " + checksNull;
}

// FILE: node_modules/strict/package.json
{"name":"strict","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}},"compilerOptions":{"strict":true}}

// FILE: node_modules/strict/index.aot.ts
type ChecksNull = undefined extends string ? false : true;
const checksNull: ChecksNull = true;
export function strict(name: string | undefined): string {
  return (name ?? "nobody") + " " + checksNull;
}

// FILE: node_modules/strict/index.js
const checksNull = !0;
export function strict(name) {
  return (name ?? "nobody") + " " + checksNull;
}

// FILE: node_modules/without-null-checks/package.json
{"name":"without-null-checks","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}},"compilerOptions":{"strict":true,"strictNullChecks":false}}

// FILE: node_modules/without-null-checks/index.aot.ts
type ChecksNull = undefined extends string ? false : true;
const checksNull: ChecksNull = false;
let last: string = null;
export function withoutNullChecks(name: string): string {
  const before: string = last;
  last = name;
  return before + " " + checksNull;
}

// FILE: node_modules/without-null-checks/index.js
const checksNull = !1;
let last = null;
export function withoutNullChecks(name) {
  const before = last;
  last = name;
  return before + " " + checksNull;
}

// FILE: node_modules/with-dom/package.json
{"name":"with-dom","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}},"compilerOptions":{"strict":true,"lib":["es2022","dom"]}}

// FILE: node_modules/with-dom/index.aot.ts
type HasDocument = typeof globalThis extends { document: unknown } ? true : false;
const hasDocument: HasDocument = true;
export function withDom(node: Pick<HTMLElement, "tagName">): string {
  return node.tagName + " " + hasDocument;
}

// FILE: node_modules/with-dom/index.js
const hasDocument = !0;
export function withDom(node) {
  return node.tagName + " " + hasDocument;
}

// FILE: node_modules/without-dom/package.json
{"name":"without-dom","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}},"compilerOptions":{"strict":true,"lib":["es2022"]}}

// FILE: node_modules/without-dom/index.aot.ts
type HasDocument = typeof globalThis extends { document: unknown } ? true : false;
const hasDocument: HasDocument = false;
interface HTMLElement {
  label: string;
}
export function withoutDom(node: HTMLElement): string {
  return node.label + " " + hasDocument;
}

// FILE: node_modules/without-dom/index.js
const hasDocument = !1;
export function withoutDom(node) {
  return node.label + " " + hasDocument;
}

// FILE: node_modules/with-checked-indexes/package.json
{"name":"with-checked-indexes","version":"1.0.0","type":"module","exports":{".":{"aot":"./index.aot.ts","default":"./index.js"}},"compilerOptions":{"strict":true,"noUncheckedIndexedAccess":true}}

// FILE: node_modules/with-checked-indexes/index.aot.ts
export function withCheckedIndexes(names: string[]): string {
  const first = names[0];
  const mayBeMissing: undefined extends typeof first ? true : false = true;
  return first + " " + mayBeMissing;
}

// FILE: node_modules/with-checked-indexes/index.js
export function withCheckedIndexes(names) {
  const first = names[0];
  const mayBeMissing = !0;
  return first + " " + mayBeMissing;
}
