// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 2

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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v8 = ModuleNamespace module=[[m_2]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|object site=[[w_3]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="eval" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="m.constant + 1"
// CHECK-NEXT: v15 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v16 = StrictEq v13, v15
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: v18 = ModuleNamespace module=[[m_5]]
// CHECK-NEXT: v19 = DirectEval v14, v0, v1, v10, v17, v18, v4 evalScope=e2
// CHECK-NEXT: Jump -> next b4(v19)
// CHECK-NEXT: b3(v20):
// CHECK-NEXT: v21 = Call v20, -, v14 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v21)
// CHECK-NEXT: b4(v22):
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="evalOfAwaited"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: v5 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v6 = Await v5, v4
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|object site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v8 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v9 = Await v8, v4
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|object site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v11 = TypeTest v10 testedType=undefined|null
// CHECK-NEXT: Branch v11 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=NotDestructurable name="word"
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = PropGet v14 key="word"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|"abc" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="eval" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string="m.constant + word"
// CHECK-NEXT: v21 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v22 = StrictEq v19, v21
// CHECK-NEXT: Branch v22 -> taken b5(), notTaken b6(| 0)
// CHECK-NEXT: b5():
// CHECK-NEXT: v23 = ModuleNamespace module=[[m_4]]
// CHECK-NEXT: v24 = ModuleNamespace module=[[m_5]]
// CHECK-NEXT: v25 = DirectEval v20, v0, v1, v7, v16, v23, v24, v4 evalScope=e3
// CHECK-NEXT: Jump -> next b7(v25)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: v27 = Call v26, -, v20 calleeName="eval"
// CHECK-NEXT: Jump -> next b7(v27)
// CHECK-NEXT: b7(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
