// RUN: lower
// DIAGNOSTIC: TS2339 row000.ts:2
// DIAGNOSTIC: TS2339 row001.ts:2
// DIAGNOSTIC: TS2339 row002.ts:2
// DIAGNOSTIC: TS2339 row003.ts:2
// DIAGNOSTIC: TS2339 row004.ts:2
// DIAGNOSTIC: TS2339 row005.ts:2
// DIAGNOSTIC: TS2339 row006.ts:2
// DIAGNOSTIC: TS2339 row007.ts:2
// DIAGNOSTIC: TS2339 row008.ts:2
// DIAGNOSTIC: TS2339 row009.ts:2
// DIAGNOSTIC: TS2339 row010.ts:2
// DIAGNOSTIC: TS2339 row011.ts:2
// DIAGNOSTIC: TS2339 row012.ts:2
// DIAGNOSTIC: TS2339 row013.ts:2
// DIAGNOSTIC: TS2339 row014.ts:2
// DIAGNOSTIC: TS2339 row015.ts:2
// DIAGNOSTIC: TS2339 row016.ts:2
// DIAGNOSTIC: TS2339 row017.ts:2
// DIAGNOSTIC: TS2339 row018.ts:2
// DIAGNOSTIC: TS2339 row019.ts:2
// DIAGNOSTIC: TS2339 row020.ts:2
// DIAGNOSTIC: TS2339 row021.ts:2
// DIAGNOSTIC: TS2339 row022.ts:2
// DIAGNOSTIC: TS2339 row023.ts:2
// DIAGNOSTIC: TS2339 row024.ts:2
// DIAGNOSTIC: TS2339 row025.ts:2
// DIAGNOSTIC: TS2339 row026.ts:2
// DIAGNOSTIC: TS2339 row027.ts:2
// DIAGNOSTIC: TS2339 row028.ts:2
// DIAGNOSTIC: TS2339 row029.ts:2
// DIAGNOSTIC: TS2339 row030.ts:2
// DIAGNOSTIC: TS2339 row031.ts:2
// DIAGNOSTIC: TS2339 row032.ts:2
// DIAGNOSTIC: TS2339 row033.ts:2
// DIAGNOSTIC: TS2339 row034.ts:2
// DIAGNOSTIC: TS2339 row035.ts:2
// DIAGNOSTIC: TS2339 row036.ts:2
// DIAGNOSTIC: TS2339 row037.ts:2
// DIAGNOSTIC: TS2339 row038.ts:2
// DIAGNOSTIC: TS2339 row039.ts:2
// DIAGNOSTIC: TS2339 row040.ts:2
// DIAGNOSTIC: TS2339 row040.ts:3
// DIAGNOSTIC: TS2339 row040.ts:4
// DIAGNOSTIC: TS2339 row041.ts:2
// DIAGNOSTIC: TS2339 row042.ts:2
// DIAGNOSTIC: TS2339 row043.ts:2
// DIAGNOSTIC: TS2339 row044.ts:2
// DIAGNOSTIC: TS2339 row045.ts:2
// DIAGNOSTIC: TS2339 row046.ts:2
// DIAGNOSTIC: TS2339 row047.ts:2
// DIAGNOSTIC: TS2339 row048.ts:2
// DIAGNOSTIC: TS2339 row049.ts:2
// DIAGNOSTIC: TS2871 row005.ts:1
// DIAGNOSTIC: TS2871 row006.ts:1

// The place runs, and right beside it is what a constant cuts out of the program.

// FILE: main.ts
import "./row000.ts";
import "./row001.ts";
import "./row002.ts";
import "./row003.ts";
import "./row004.ts";
import "./row005.ts";
import "./row006.ts";
import "./row007.ts";
import "./row008.ts";
import "./row009.ts";
import "./row010.ts";
import "./row011.ts";
import "./row012.ts";
import "./row013.ts";
import "./row014.ts";
import "./row015.ts";
import "./row016.ts";
import "./row017.ts";
import "./row018.ts";
import "./row019.ts";
import "./row020.ts";
import "./row021.ts";
import "./row022.ts";
import "./row023.ts";
import "./row024.ts";
import "./row025.ts";
import "./row026.ts";
import "./row027.ts";
import "./row028.ts";
import "./row029.ts";
import "./row030.ts";
import "./row031.ts";
import "./row032.ts";
import "./row033.ts";
import "./row034.ts";
import "./row035.ts";
import "./row036.ts";
import "./row037.ts";
import "./row038.ts";
import "./row039.ts";
import "./row040.ts";
import "./row041.ts";
import "./row042.ts";
import "./row043.ts";
import "./row044.ts";
import "./row045.ts";
import "./row046.ts";
import "./row047.ts";
import "./row048.ts";
import "./row049.ts";

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"target":"esnext","module":"preserve","moduleResolution":"bundler","allowImportingTsExtensions":true,"noEmit":true,"types":[]},"files":["main.ts","globals.d.ts"]}

// FILE: globals.d.ts
declare const process: { env: Record<string, string | undefined>; platform: string };
declare const Bun: object;
interface ImportMeta { url: string; main: boolean; env?: Record<string, string | undefined> }

// FILE: row000.ts
if (false) { console.log(0); } else { console.log((1 as number)
.nope); }
export {};

// FILE: row001.ts
console.log(false ? 1 : (1 as number)
.nope);
export {};

// FILE: row002.ts
console.log(true ? (1 as number)
.nope : 1);
export {};

// FILE: row003.ts
console.log(true && (1 as number)
.nope);
export {};

// FILE: row004.ts
console.log(false || (1 as number)
.nope);
export {};

// FILE: row005.ts
console.log(null ?? (1 as number)
.nope);
export {};

// FILE: row006.ts
console.log(undefined ?? (1 as number)
.nope);
export {};

// FILE: row007.ts
if (true) console.log((1 as number)
.nope);
export {};

// FILE: row008.ts
if (false) { console.log(0); } console.log((1 as number)
.nope);
export {};

// FILE: row009.ts
for (; false; ) { console.log(0); } console.log((1 as number)
.nope);
export {};

// FILE: row010.ts
while (false) { console.log(0); } console.log((1 as number)
.nope);
export {};

// FILE: row011.ts
const DEBUG = false; if (!DEBUG) console.log((1 as number)
.nope);
export {};

// FILE: row012.ts
const DEBUG = false; if (DEBUG) { console.log(0); } else console.log((1 as number)
.nope);
export {};

// FILE: row013.ts
const DEBUG = false; console.log(DEBUG ? 0 : (1 as number)
.nope);
export {};

// FILE: row014.ts
const DEBUG = false; function f() { if (DEBUG) return 0; return (1 as number)
.nope; } console.log(f());
export {};

// FILE: row015.ts
const MODE: string = "a"; if (MODE === "a") console.log((1 as number)
.nope);
export {};

// FILE: row016.ts
const MODE = "a"; if (MODE === "a") console.log((1 as number)
.nope);
export {};

// FILE: row017.ts
const MODE = "a"; switch (MODE) { case "a": console.log((1 as number)
.nope); }
export {};

// FILE: row018.ts
const MODE = "a"; console.log(MODE !== "a" ? 0 : (1 as number)
.nope);
export {};

// FILE: row019.ts
if (typeof window === "undefined") console.log((1 as number)
.nope);
export {};

// FILE: row020.ts
if (typeof window !== "undefined") { console.log(0); } else { console.log((1 as number)
.nope); }
export {};

// FILE: row021.ts
if (typeof Bun !== "undefined") console.log((1 as number)
.nope);
export {};

// FILE: row022.ts
if (process.env.NODE_ENV !== "production") console.log((1 as number)
.nope);
export {};

// FILE: row023.ts
if (process.env.NODE_ENV === "production") { console.log(0); } else { console.log((1 as number)
.nope); }
export {};

// FILE: row024.ts
if (process.platform !== "win32") console.log((1 as number)
.nope);
export {};

// FILE: row025.ts
if (true) { function g() { return (1 as number)
.nope; } console.log(g()); }
export {};

// FILE: row026.ts
function f() { return g(); function g() { return (1 as number)
.nope; } } console.log(f());
export {};

// FILE: row027.ts
function f() { if (false) { return 0; } return (1 as number)
.nope; } console.log(f());
export {};

// FILE: row028.ts
function f() { try { return 1; } finally { console.log((1 as number)
.nope); } } console.log(f());
export {};

// FILE: row029.ts
function f(a: boolean) { if (a) return 1; return (1 as number)
.nope; } console.log(f(false));
export {};

// FILE: row030.ts
function f() { for (;;) { break; } return (1 as number)
.nope; } console.log(f());
export {};

// FILE: row031.ts
function f() { do { continue; } while (false); return (1 as number)
.nope; } console.log(f());
export {};

// FILE: row032.ts
function f() { l: { break l; } return (1 as number)
.nope; } console.log(f());
export {};

// FILE: row033.ts
function f() { try { throw 1; } catch { return (1 as number)
.nope; } } console.log(f());
export {};

// FILE: row034.ts
function f() { switch (1 as number) { case 1: return (1 as number)
.nope; } return 0; } console.log(f());
export {};

// FILE: row035.ts
enum E { A = 1 } if (E.A === 1) console.log((1 as number)
.nope);
export {};

// FILE: row036.ts
const enum E { A = 1 } if (E.A === 1) console.log((1 as number)
.nope);
export {};

// FILE: row037.ts
const enum E { A = 1 } console.log(E.A === 1 ? (1 as number)
.nope : 0);
export {};

// FILE: row038.ts
console.log(1 + 1 === 2 ? (1 as number)
.nope : 0);
export {};

// FILE: row039.ts
console.log("a".length === 1 ? (1 as number)
.nope : 0);
export {};

// FILE: row040.ts
console.log(!0 && (1 as number)
.nope, !1 || (1 as number)
.nope, !!1 && (1 as number)
.nope);
export {};

// FILE: row041.ts
console.log(void 0 === undefined ? (1 as number)
.nope : 0);
export {};

// FILE: row042.ts
console.log([].length ? 0 : (1 as number)
.nope);
export {};

// FILE: row043.ts
export {}; if (import.meta.env?.X === undefined) console.log((1 as number)
.nope);
export {};

// FILE: row044.ts
const o = { a: false } as const; if (!o.a) console.log((1 as number)
.nope);
export {};

// FILE: row045.ts
const t = [false] as const; if (!t[0]) console.log((1 as number)
.nope);
export {};

// FILE: row046.ts
function never(): never { throw 1; } try { never(); } catch { console.log((1 as number)
.nope); }
export {};

// FILE: row047.ts
function assert(x: unknown): asserts x {} assert(false); console.log((1 as number)
.nope);
export {};

// FILE: row048.ts
let x: 1 | 2 = 1; if (x === 1) console.log((1 as number)
.nope);
export {};

// FILE: row049.ts
declare const D: boolean | undefined; if (typeof D === "undefined") console.log((1 as number)
.nope);
export {};
