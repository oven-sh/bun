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
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v3 calleeName="api"
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="view"
// CHECK-NEXT: v12 = Data data=[[d_5]]
// CHECK-NEXT: v13 = Call v1, -, v12 calleeName="others"
// CHECK-NEXT: v14 = Call v8, v6, v9, v11, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="others"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="a"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="a"
// CHECK-NEXT: v6 = NewObject layout=[[L_7]]
// CHECK-NEXT: CopyDataProperties v6, v4 excludedKeys=["a"]
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
