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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Error" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v3 = ResolveHeritage v2
// CHECK-NEXT: v4 = NewClosure function=[[f_1]]
// CHECK-NEXT: v5 = NewClass v4, v2, v3 layout=[[L_2]]
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_3]]
// CHECK-NEXT: v7 = FinishClass v5 layout=[[L_2]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = Convert v7 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v10 = Builtin builtin=NodeAssert
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(NodeAssert) flags=[IsExpected]}
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Convert v9 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v13 key="AssertionError"
// CHECK-NEXT: v15 = ImportModule module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Promise<undefined|null|object> flags=[IsExpected]}
// CHECK-NEXT: v17 = Await v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="ok"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(NodeAssertOk) flags=[IsExpected]}
// CHECK-NEXT: v22 = Boolean boolean=true
// CHECK-NEXT: v23 = Call v21, -, v22 calleeName="ok"
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v18 key="held"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v31 = Call v30, v18 calleeKey="held" calleeName="rest.held"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v33 = StrictEq v32, v9
// CHECK-NEXT: v34 = PropGet v18 key="held"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v36 = Call v35, v18 calleeKey="held" calleeName="rest.held"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v37 key="name"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v18 key="tracker"
// CHECK-NEXT: v41 = Convert v40 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v42 = Call v41, v18 calleeKey="tracker" calleeName="rest.tracker"
// CHECK-NEXT: v43 = TypeOf v42
// CHECK-NEXT: v44 = Call v28, v26, v33, v39, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v45 = Undefined
// CHECK-NEXT: Return v45
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Patched"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]]
