// RUN: lower
// OPTIONS: builtin-modules
// ENTRY: main.cjs module.mjs data.json file.cjs
// STATISTIC: SourceFilesInferred = 3
// STATISTIC: SourceFilesData = 1

// FILE: main.cjs
// The children of a file that requires files of three kinds under names made at run time.
const { basename } = require("node:path");
const names = JSON.parse(process.env.NAMES ?? '["./module.mjs", "./data.json", "./file.cjs"]');
for (const name of [...names, ...names, ...names]) {
  require(name);
  console.log(name, module.children.map(child => basename(child.filename)).join());
}

// FILE: data.json
{ "a": 1 }

// FILE: file.cjs
console.log("file: parent", module.parent && module.parent.id);

// FILE: module.mjs
export const one = 1;

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v4 = TypeTest v3 testedType=undefined|null
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = NewRuntimeError runtimeError=NotDestructurable name="basename"
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = PropGet v7 key="basename"
// CHECK-NEXT: PutModuleVariable v8 variable=[[g_4]]
// CHECK-NEXT: v10 = Builtin builtin=JSON
// CHECK-NEXT: v11 = PropGet v10 key="parse"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v13 = Builtin builtin=Process
// CHECK-NEXT: v14 = PropGet v13 key="env"
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="NAMES"
// CHECK-NEXT: v17 = TypeTest v16 testedType=undefined|null
// CHECK-NEXT: Branch v17 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: v19 = String string="[\"./module.mjs\", \"./data.json\", \"./file.cjs\"]"
// CHECK-NEXT: Jump -> next b5(v19)
// CHECK-NEXT: b4(v20):
// CHECK-NEXT: Jump -> next b5(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = Call v12, v10, v21 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: v23 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v23, v22
// CHECK-NEXT: AppendSpread v23, v22
// CHECK-NEXT: AppendSpread v23, v22
// CHECK-NEXT: v27 = IteratorOpen v23
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v29 = IteratorResume v27
// CHECK-NEXT: v30 = ResultAt v29
// CHECK-NEXT: v31 = ResultAt v29 index=1
// CHECK-NEXT: Branch v30 -> taken b7(), notTaken b8()
// CHECK-NEXT: b7():
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: b8():
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9() handler=b10():
// CHECK-NEXT: v33 = RequireDynamic v31 referrer=[[m_0]]
// CHECK-NEXT: v34 = Builtin builtin=GlobalThis
// CHECK-NEXT: v35 = PropGet v34 key="console" [isFreeName]
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v37 = PropGet v36 key="log"
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v39 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v40 = PropGet v39 key="children"
// CHECK-NEXT: v41 = PropGet v40 key="map"
// CHECK-NEXT: v42 = NewClosure function=[[f_5]]
// CHECK-NEXT: v43 = Call v41, v40, v42 calleeKey="map" calleeName="module.children.map"
// CHECK-NEXT: v44 = PropGet v43 key="join"
// CHECK-NEXT: v45 = Call v44, v43 calleeKey="join" calleeName="join"
// CHECK-NEXT: v46 = Call v38, v36, v31, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b10() role=IterationCleanup subject=v27:
// CHECK-NEXT: v47 = CatchException
// CHECK-NEXT: IteratorClose v27 completion=Throw
// CHECK-NEXT: Rethrow v47
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_6]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="basename"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(NodePathBasename) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v0 key="filename"
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="basename"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
