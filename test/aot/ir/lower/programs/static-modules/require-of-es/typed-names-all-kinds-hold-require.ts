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
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="exported"
// CHECK-NEXT: v9 = PropGet v8 key="f"
// CHECK-NEXT: v10 = Call v9, v8 calleeKey="f" calleeName="exported.f"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="viaClosure"
// CHECK-NEXT: v13 = Call v12 calleeName="viaClosure"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="viaVar"
// CHECK-NEXT: v16 = Call v15 calleeName="viaVar"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="viaLet"
// CHECK-NEXT: v19 = Call v18 calleeName="viaLet"
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="viaCommonJs"
// CHECK-NEXT: v22 = Call v21 calleeName="viaCommonJs"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="viaEquals"
// CHECK-NEXT: v25 = Call v24 calleeName="viaEquals"
// CHECK-NEXT: v26 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v27 = CheckInitialized v26 name="viaClass"
// CHECK-NEXT: v28 = Call v27 calleeName="viaClass"
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="viaPattern"
// CHECK-NEXT: v31 = Call v30 calleeName="viaPattern"
// CHECK-NEXT: v32 = Call v6, v4, v10, v13, v16, v19, v22, v25, v28, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = Builtin builtin=GlobalThis
// CHECK-NEXT: v34 = PropGet v33 key="console" [isFreeName]
// CHECK-NEXT: v35 = Convert v34 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="log"
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v38 = Call v1 calleeName="late"
// CHECK-NEXT: v39 = Call v37, v35, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: RecordRequire module=[[m_10]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_10]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_10]] referrer=[[m_0]]
// CHECK-NEXT: v3 = Boolean boolean=true
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="f"
// CHECK-NEXT: v6 = ModuleNamespace module=[[m_10]]
// CHECK-NEXT: v7 = Call v5, v6 calleeName="f"
// CHECK-NEXT: EvaluateModule module=[[m_12]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = Call v10, v11 calleeName="g"
// CHECK-NEXT: v13 = Add v7, v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
