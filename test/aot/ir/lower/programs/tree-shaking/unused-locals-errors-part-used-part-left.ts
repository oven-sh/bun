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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = NewClosure function=[[f_1]]
// CHECK-NEXT: v2 = NewClass v1 layout=[[L_2]]
// CHECK-NEXT: PutModuleVariable v2 variable=[[g_3]]
// CHECK-NEXT: v4 = FinishClass v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = Convert v4 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Convert v7 declared={type=1 site=[[w_4]]}
// CHECK-NEXT: v9 = NewArray v8 contents=number
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<number> site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = NewClosure function=[[f_6]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Convert v6 declared={type=undefined|null|[[f_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = Convert v14 declared={type=0}
// CHECK-NEXT: v16 = NewObject -, v10, v13, v15, v12 layout=[[L_10]] fields=[3, 0, 2, 1]
// CHECK-NEXT: v17 = FinishObject v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_10]] site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PutModuleVariable v18 variable=[[g_12]]
// CHECK-NEXT: v20 = ResolveHeritage v6
// CHECK-NEXT: v21 = NewClosure function=[[f_13]]
// CHECK-NEXT: v22 = NewClass v21, v6, v20 layout=[[L_14]]
// CHECK-NEXT: PutModuleVariable v22 variable=[[g_15]]
// CHECK-NEXT: v24 = FinishClass v22 layout=[[L_14]]
// CHECK-NEXT: v25 = Convert v24 declared={type=[[f_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v26 = Convert v24 declared={type=function flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v27 = CallDirect v26 function=[[f_16]]
// CHECK-NEXT: v28 = Convert v24 declared={type=[[f_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutModuleVariable v28 variable=[[g_17]]
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = String string="built and ran"
// CHECK-NEXT: v36 = Call v34, v32, v35 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v37 = Undefined
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="helper"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_20]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Call v2 calleeName="helper"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_21]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="UnusedClass"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_14]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_14]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} kind=Initializer flags=[HasThis, IsChecked, IsHiddenInStackTraces] thisType={type=function flags=[IsFromCompiler]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=object flags=[IsFromCompiler, IsClaim]}
// CHECK-NEXT: v2 = Integer
// CHECK-NEXT: v3 = Convert v2 declared={type=0 site=[[w_23]]}
// CHECK-NEXT: PropDefine v1, v3 key="kind"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_9]]]
