// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 1
// CHECK-LABEL: function {{*}}name="evalInTyped"
// CHECK-LABEL: function {{*}}name="evalOfAwaited"

// FILE: main.ts
// A required module where it is seldom written: seen by a direct eval, across yields and awaits, in a switch, a loop, a field, a default, an assignment, before its constant is initialized; copies that are exported.
import * as loose from "./loose.js";
import { constant, twice, word, atLoad } from "./copies";
import * as copies from "./copies";
type Lib = typeof import("./lib");
async function waits() { const m = require("./lib") as Lib; await null; const { twice } = m; await null; return m.constant + twice(1) + (await import("./lib")).constant; }
function evalInTyped() { const m = require("./lib") as Lib; return eval("m.constant + 1"); }
async function evalOfAwaited() { const m = await import("./lib"); const { word } = await import("./lib"); return eval("m.constant + word"); }
console.log(loose.viaEval(), loose.viaEvalOfACopy(), loose.viaFunction(), [...loose.yields()].join(), loose.inASwitch(1), loose.inASwitch(2), loose.assigned(), loose.byDefault(), new loose.Fields().read(), loose.early(), loose.inALoop(), loose.labelled());
console.log(constant, twice(constant), word, atLoad, Object.keys(copies).join(), copies.twice(2), (() => word)());
console.log(await waits(), evalInTyped(), await evalOfAwaited());

// FILE: copies.ts
export const { constant, twice, word } = require("./lib") as typeof import("./lib");
export const { counter: atLoad } = require("./lib");

// FILE: lib.ts
export const constant = 10;
export function twice(n: number): number { return n * 2; }
export let counter = 0;
export function bump(): void { counter++; }
export const word = "abc";

// FILE: loose.js
export function viaEval() { const m = require("./lib.ts"); return eval("m.constant + m.twice(1)"); }
export function viaEvalOfACopy() { const { twice, constant } = require("./lib.ts"); return eval("twice(constant)"); }
export function viaFunction() { const m = require("./lib.ts"); return new Function("m", "return m.constant")(m); }
export function* yields() { const m = require("./lib.ts"); yield m.constant; const { twice } = m; yield twice(3); yield Object.keys(m).length; }
export function inASwitch(k) { switch (k) { case 1: { const m = require("./lib.ts"); return m.word; } default: return "none"; } }
export function assigned() { let a, t; ({ constant: a, twice: t } = require("./lib.ts")); return t(a); }
export function byDefault(m = require("./lib.ts")) { return m.constant; }
export class Fields { lib = require("./lib.ts"); static held = require("./lib.ts"); read() { return this.lib.constant + Fields.held.constant; } }
export function early() { try { return typeof m + m.constant; } catch (e) { return e.constructor.name; } const m = require("./lib.ts"); }
export function inALoop() { let s = 0; for (let i = 0; i < 3; i++) { const m = require("./lib.ts"); s += m.constant; (() => { s += m.twice(i); })(); } return s; }
export function labelled() { const m = require("./lib.ts"); const o = { m }; return o.m.constant + [m][0].constant + (m, m).constant + (true && m).constant + (m ?? 0).constant; }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
