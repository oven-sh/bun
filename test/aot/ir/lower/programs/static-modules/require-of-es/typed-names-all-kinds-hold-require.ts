// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Typed names of every kind hold what require answers.
import { exported, viaClosure, viaVar, viaLet, viaCommonJs, viaEquals, viaClass, viaPattern } from "./user.ts";
console.log(exported.f(), viaClosure(), viaVar(), viaLet(), viaCommonJs(), viaEquals(), viaClass(), viaPattern());
function late() {
  return require("./m.ts").f() + require("./c.cjs").g();
}
console.log(late());

// FILE: c.cjs
exports.g = function () {
  return 2;
};

// FILE: m.ts
export function f() {
  return 1;
}

// FILE: user.ts
import equals = require("./m.ts");
type M = { f: typeof import("./m.ts").f };
export const exported: M = require("./m.ts");
function outer() {
  const inner: M = require("./m.ts");
  return () => inner.f();
}
export const viaClosure = outer();
var held: M = require("./m.ts");
export function viaVar() {
  return held.f();
}
let changing: typeof import("./m.ts") = require("./m.ts");
export function viaLet() {
  return changing.f();
}
const old: { g(): number } = require("./c.cjs");
export function viaCommonJs() {
  return old.g();
}
export function viaEquals() {
  return equals.f();
}
class Keeps {
  static kept: M = require("./m.ts");
  own: M = require("./m.ts");
}
export function viaClass() {
  return Keeps.kept.f() + new Keeps().own.f();
}
const { f: taken }: M = require("./m.ts");
export function viaPattern() {
  return taken();
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="exported"
// CHECK-NEXT: v9 = PropGet v8 key="f"
// CHECK-NEXT: v10 = Call v9, v8 calleeKey="f" calleeName="exported.f"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="viaClosure"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_5]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Call v14 calleeName="viaClosure"
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_6]]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="viaVar"
// CHECK-NEXT: v19 = Call v18 calleeName="viaVar"
// CHECK-NEXT: v20 = Convert v19 declared={type=number site=[[w_8]]}
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="viaLet"
// CHECK-NEXT: v23 = Call v22 calleeName="viaLet"
// CHECK-NEXT: v24 = Convert v23 declared={type=number site=[[w_10]]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="viaCommonJs"
// CHECK-NEXT: v27 = Call v26 calleeName="viaCommonJs"
// CHECK-NEXT: v28 = Convert v27 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="viaEquals"
// CHECK-NEXT: v31 = Call v30 calleeName="viaEquals"
// CHECK-NEXT: v32 = Convert v31 declared={type=number site=[[w_14]]}
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_15]]
// CHECK-NEXT: v34 = CheckInitialized v33 name="viaClass"
// CHECK-NEXT: v35 = Call v34 calleeName="viaClass"
// CHECK-NEXT: v36 = Convert v35 declared={type=number site=[[w_16]]}
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="viaPattern"
// CHECK-NEXT: v39 = Call v38 calleeName="viaPattern"
// CHECK-NEXT: v40 = Convert v39 declared={type=number site=[[w_18]]}
// CHECK-NEXT: v41 = Call v6, v4, v11, v16, v20, v24, v28, v32, v36, v40 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v42 = Builtin builtin=GlobalThis
// CHECK-NEXT: v43 = PropGet v42 key="console" [isFreeName]
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v45 = PropGet v44 key="log"
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v47 = Call v1 calleeName="late"
// CHECK-NEXT: v48 = Call v46, v44, v47 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v49 = Undefined
// CHECK-NEXT: Return v49
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: RecordRequire module=[[m_19]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_19]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_19]] referrer=[[m_0]]
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_20]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="f"
// CHECK-NEXT: v6 = ModuleNamespace module=[[m_19]]
// CHECK-NEXT: v7 = Call v5, v6 calleeName="f"
// CHECK-NEXT: EvaluateModule module=[[m_21]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_22]]
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = Call v10, v11 calleeName="g"
// CHECK-NEXT: v13 = Add v7, v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
