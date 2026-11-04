// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 1

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

// GENERATED: evalInTyped evalOfAwaited
// CHECK-LABEL: function {{*}}name="evalInTyped"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v6 = String string="./lib"
// CHECK-NEXT: v7 = ModuleBuiltin builtin=ModuleRequire module=[[m_0]]
// CHECK-NEXT: v8 = StrictEq v5, v7
// CHECK-NEXT: Branch v8 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v12 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: Jump -> next b3(v12)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: v14 = Call v13, -, v6 calleeName="require"
// CHECK-NEXT: Jump -> next b3(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|object flags=[OmitsNull, OmitsUndefined]} illTypedCause=Assertion
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="eval" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string="m.constant + 1"
// CHECK-NEXT: v21 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v22 = StrictEq v19, v21
// CHECK-NEXT: Branch v22 -> taken b4(), notTaken b5(| 0)
// CHECK-NEXT: b4():
// CHECK-NEXT: v23 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v24 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: v25 = DirectEval v20, v0, v1, v16, v23, v24, v4 evalScope=e2
// CHECK-NEXT: Jump -> next b6(v25)
// CHECK-NEXT: b5(v26):
// CHECK-NEXT: v27 = Call v26, -, v20 calleeName="eval"
// CHECK-NEXT: Jump -> next b6(v27)
// CHECK-NEXT: b6(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="evalOfAwaited"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: v5 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v6 = Await v5, v4
// CHECK-NEXT: v7 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v8 = Await v7, v4
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=NotDestructurable name="word"
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: v13 = PropGet v12 key="word"
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="eval" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="m.constant + word"
// CHECK-NEXT: v18 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v19 = StrictEq v16, v18
// CHECK-NEXT: Branch v19 -> taken b3(), notTaken b4(| 0)
// CHECK-NEXT: b3():
// CHECK-NEXT: v20 = ModuleNamespace module=[[m_3]]
// CHECK-NEXT: v21 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: v22 = DirectEval v17, v0, v1, v6, v13, v20, v21, v4 evalScope=e3
// CHECK-NEXT: Jump -> next b5(v22)
// CHECK-NEXT: b4(v23):
// CHECK-NEXT: v24 = Call v23, -, v17 calleeName="eval"
// CHECK-NEXT: Jump -> next b5(v24)
// CHECK-NEXT: b5(v25):
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
