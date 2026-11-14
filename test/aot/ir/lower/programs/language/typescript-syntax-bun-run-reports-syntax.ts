// RUN: lower
// OPTIONS: builtin-modules
// DIAGNOSTIC: TS1003 4
// DIAGNOSTIC: TS1005 6
// DIAGNOSTIC: TS1009 1
// DIAGNOSTIC: TS1024 1
// DIAGNOSTIC: TS1035 1
// DIAGNOSTIC: TS1044 1
// DIAGNOSTIC: TS1049 1
// DIAGNOSTIC: TS1090 1
// DIAGNOSTIC: TS1098 5
// DIAGNOSTIC: TS1099 2
// DIAGNOSTIC: TS1147 1
// DIAGNOSTIC: TS1164 1
// DIAGNOSTIC: TS1187 1
// DIAGNOSTIC: TS1194 1
// DIAGNOSTIC: TS1206 5
// DIAGNOSTIC: TS1214 1
// DIAGNOSTIC: TS1215 2
// DIAGNOSTIC: TS1231 1
// DIAGNOSTIC: TS1232 1
// DIAGNOSTIC: TS1235 3
// DIAGNOSTIC: TS1242 1
// DIAGNOSTIC: TS1248 1
// DIAGNOSTIC: TS1264 1
// DIAGNOSTIC: TS1274 1
// DIAGNOSTIC: TS1316 1
// DIAGNOSTIC: TS1317 1
// DIAGNOSTIC: TS1319 1
// DIAGNOSTIC: TS1358 1
// DIAGNOSTIC: TS17013 2
// DIAGNOSTIC: TS18024 1
// DIAGNOSTIC: TS2300 4
// DIAGNOSTIC: TS2331 1
// DIAGNOSTIC: TS2332 1
// DIAGNOSTIC: TS2338 1
// DIAGNOSTIC: TS2369 4
// DIAGNOSTIC: TS2398 1
// DIAGNOSTIC: TS2451 4
// DIAGNOSTIC: TS2452 1
// DIAGNOSTIC: TS2480 1
// DIAGNOSTIC: TS2670 1
// DIAGNOSTIC: TS2730 2

// FILE: typescript-syntax-bun-run-reports-syntax.ts
// @ts-nocheck
// Typescript syntax that bun run reports as a syntax error.
export { if };
export { "a" };
export { this as b };
var c;
export { c as #d };
var arrow1 = (this) => 1;
var arrow2 = (a, this: any) => 1;
class Setter { set x(this) {} }
function f1(public a) {}
var f2 = (readonly a) => 1;
class M1 { m(private a) {} }
class M2 { static constructor(public a) {} }
class P1 { constructor(public ...a) {} }
class P2 { constructor(public { a }) {} }
class P3 { constructor(static a) {} }
class P4 { constructor(public constructor) {} }
public var v1;
abstract function f3() {}
readonly class C1 {}
@dec var v2;
@dec function f4() {}
class D1 { @dec constructor() {} }
class D2 { @dec static {} }
function f5(@dec a) {}
class K1 { const x = 1; }
class K2 { in x; }
{ namespace N1 {} }
function f6() { namespace N2 { var a = 1; } }
label1: namespace N3 {}
if (1) import i1 = require("node:fs");
{ export = 1; }
function f7() { export as namespace X; }
module "m1" {}
global {}
namespace N4 { import a from "x"; }
namespace N5 { export * from "x"; }
namespace N6 { export default 1; }
enum E1 { 1 }
enum E2 { [k] }
enum E3 { #a }
enum E4 { A, A }
enum E5 { A } let E5;
var E6; enum E6 { A }
namespace N7 { var a = 1; } let N7;
namespace N8 { var a = 1; } class N8 {}
namespace N9 { export var a = 1; } function N9() {}
import i2 = require("node:fs"); import i2 = require("node:fs");
import i3 = require("node:fs"); let i3;
import let = require("node:fs");
namespace N10 { this; }
enum E7 { A = this }
namespace N11 { new.target; }
enum E8 { A = new.target }
enum eval {}
namespace arguments { var a = 1; }
let x1!;
function g1<>() {}
class G2<> {}
var g3 = class <> {};
class G4 { m<>() {} }
var g5 = { m<>() {} };
class G6 extends Array<> {}
class G7 extends Array<number,> {}
var g8: any; g8?.<>();
declare g9;
declare g10 = 1;
declare {}
declare 1;
declare if (1) {}
declare global;
class S1 { m() { enum E9 { A = super.x } } }
var t1: any = {}; t1?.b!`x`;
function dec(...a) {}
console.log("ran");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
