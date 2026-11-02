// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 3

// FILE: main.ts
// The project sets no "jsx", "module": "esnext", an old target and "importHelpers" without tslib. tsc refuses the import of a .tsx file (TS6142), each tag (TS17004), `import = require` (TS1202), `export =` (TS1203) and the rest element (TS2354): rules about what tsc would write. Plain Bun runs the program, and so does a build.
import api = require("./lay");
import { view } from "./view";
function others(o: { a: number; b: number; c: number }) { const { a, ...rest } = o; return rest; }
console.log(api(), view, others({ a: 1, b: 2, c: 3 }));

// FILE: lay.ts
function api(): number { return 1; }
export = api;

// FILE: view.tsx
/** @jsxRuntime classic */
/** @jsx h */
declare global { namespace JSX { interface IntrinsicElements { box: { size: number } } interface Element { tag: string; props: object } } }
function h(tag: string, props: object | null): JSX.Element { return { tag, props: props ?? {} }; }
export const view = <box size={3} />;

// FILE: tsconfig.json
{ "compilerOptions": { "strict": true, "target": "es2017", "module": "esnext", "moduleResolution": "bundler", "importHelpers": true, "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true } }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = Convert v3 declared={type=undefined|null|[[f_4]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Call v9 calleeName="api"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="view"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_7]]} illTypedCause=Assertion
// CHECK-NEXT: v15 = Data data=[[d_8]]
// CHECK-NEXT: v16 = Call v1, -, v15 calleeName="others"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = Call v8, v6, v11, v14, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="others"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_9]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="a"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="a"
// CHECK-NEXT: v6 = Convert v5 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v7 = NewObject layout=[[L_9]]
// CHECK-NEXT: CopyDataProperties v7, v4 excludedKeys=["a"]
// CHECK-NEXT: v9 = FinishObject v7
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_9]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
