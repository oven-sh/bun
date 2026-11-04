// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// tsconfig.json turns unused locals into errors. Each constant, class and enum here is used, but only by an exported declaration that nobody imports and that is left out. A build that does not look at what it leaves out must not call them unused.
import { helper } from "./lib";

const inner = 1;
const list = [inner];
class Base {}
enum Kind { A }
const arrow = () => helper();
export const unusedExport = { list, Base, kind: Kind.A, arrow };
export class UnusedClass extends Base { static kind = Kind.A; }

console.log("built and ran");

// FILE: lib.ts
export const helper = () => "helper";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "strict": true, "noUnusedLocals": true } }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = NewClosure function=[[f_1]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_2]]
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_3]]
// CHECK-NEXT: v4 = FinishClass v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v6 = Convert v4 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = NewArray v7 contents=anything
// CHECK-NEXT: v9 = NewClosure function=[[f_4]]
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = NewObject -, v8, v6, v10, v9 layout=[[L_5]] fields=[3, 0, 2, 1]
// CHECK-NEXT: v12 = FinishObject v11
// CHECK-NEXT: PutModuleVariable v12 variable=[[g_6]]
// CHECK-NEXT: v14 = ResolveHeritage v6
// CHECK-NEXT: v15 = NewClosure function=[[f_7]]
// CHECK-NEXT: v16 = NewClass v15, v6, v14 layout=[[L_8]]
// CHECK-NEXT: PutModuleVariable v16 variable=[[g_9]]
// CHECK-NEXT: v18 = FinishClass v16 layout=[[L_8]]
// CHECK-NEXT: v19 = Convert v18 declared={type=[[f_7]] flags=[IsFromCompiler]}
// CHECK-NEXT: v20 = Convert v18 declared={type=function flags=[IsFromCompiler]}
// CHECK-NEXT: v21 = CallDirect v20 function=[[f_10]]
// CHECK-NEXT: v22 = Convert v18 declared={type=[[f_7]] flags=[IsFromCompiler]}
// CHECK-NEXT: PutModuleVariable v22 variable=[[g_11]]
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = String string="built and ran"
// CHECK-NEXT: v30 = Call v28, v26, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="helper"
// CHECK-NEXT: v2 = Call v1 calleeName="helper"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="UnusedClass"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} kind=Initializer flags=[HasThis, IsChecked, IsHiddenInStackTraces] thisType={type=function flags=[IsFromCompiler]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: v1 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: PropDefine v1, v2 key="kind"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_12]]]
