// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
import assert, { ok } from "node:assert";
class Patched extends Error {}
assert.AssertionError = Patched;
const rest = await import("./rest.mjs");
ok(true);
console.log(rest.held() === Patched, rest.held().name, typeof rest.tracker());

// FILE: rest.mjs
import { AssertionError, CallTracker } from "node:assert";
export const held = () => AssertionError;
export const tracker = () => CallTracker;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Error" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v3 = ResolveHeritage v2
// CHECK-NEXT: v4 = NewClosure function=[[f_1]]
// CHECK-NEXT: v5 = NewClass v4, v2, v3 layout=[[L_2]]
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_3]]
// CHECK-NEXT: v7 = FinishClass v5 layout=[[L_2]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v9 = Convert v7 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v10 = Builtin builtin=NodeAssert
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(NodeAssert) flags=[IsExpected]}
// CHECK-NEXT: PropSet v11, v9 key="AssertionError"
// CHECK-NEXT: v13 = ImportModule module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v14 = Await v13
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="ok"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(NodeAssertOk) flags=[IsExpected]}
// CHECK-NEXT: v18 = Boolean boolean=true
// CHECK-NEXT: v19 = Call v17, -, v18 calleeName="ok"
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="console" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v23 = PropGet v22 key="log"
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v14 key="held"
// CHECK-NEXT: v26 = Call v25, v14 calleeKey="held" calleeName="rest.held"
// CHECK-NEXT: v27 = StrictEq v26, v9
// CHECK-NEXT: v28 = PropGet v14 key="held"
// CHECK-NEXT: v29 = Call v28, v14 calleeKey="held" calleeName="rest.held"
// CHECK-NEXT: v30 = PropGet v29 key="name"
// CHECK-NEXT: v31 = PropGet v14 key="tracker"
// CHECK-NEXT: v32 = Call v31, v14 calleeKey="tracker" calleeName="rest.tracker"
// CHECK-NEXT: v33 = TypeOf v32
// CHECK-NEXT: v34 = Call v24, v22, v27, v30, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Patched"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
