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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = RequireModule module=[[m_3]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v5 = TypeTest v4 testedType=undefined|null
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=NotDestructurable name="basename"
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: v9 = PropGet v8 key="basename"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Builtin builtin=JSON
// CHECK-NEXT: v12 = PropGet v11 key="parse"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(JSONParse) flags=[IsExpected]}
// CHECK-NEXT: v14 = Builtin builtin=Process
// CHECK-NEXT: v15 = PropGet v14 key="env"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ProcessEnv) flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="NAMES"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v19 = TypeTest v18 testedType=undefined|null
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v21 = String string="[\"./module.mjs\", \"./data.json\", \"./file.cjs\"]"
// CHECK-NEXT: Jump -> next b8(v21)
// CHECK-NEXT: b7(v22):
// CHECK-NEXT: Jump -> next b8(v22)
// CHECK-NEXT: b8(v23):
// CHECK-NEXT: v24 = Call v13, v11, v23 calleeKey="parse" calleeName="JSON.parse"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: v26 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v26, v25
// CHECK-NEXT: AppendSpread v26, v25
// CHECK-NEXT: AppendSpread v26, v25
// CHECK-NEXT: v30 = Convert v26 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v31 = IteratorOpen v30
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v33 = IteratorResume v31
// CHECK-NEXT: v34 = ResultAt v33
// CHECK-NEXT: v35 = ResultAt v33 index=1
// CHECK-NEXT: Branch v34 -> taken b10(), notTaken b11()
// CHECK-NEXT: b10():
// CHECK-NEXT: v36 = Undefined
// CHECK-NEXT: Return v36
// CHECK-NEXT: b11():
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12() handler=b13():
// CHECK-NEXT: v37 = Convert v35 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v38 = RequireDynamic v37 referrer=[[m_0]]
// CHECK-NEXT: v39 = Builtin builtin=GlobalThis
// CHECK-NEXT: v40 = PropGet v39 key="console" [isFreeName]
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v42 = PropGet v41 key="log"
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v44 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v45 = PropGet v44 key="children"
// CHECK-NEXT: v46 = PropGet v45 key="map"
// CHECK-NEXT: v47 = NewClosure v10 function=[[f_5]]
// CHECK-NEXT: v48 = Call v46, v45, v47 calleeKey="map" calleeName="module.children.map"
// CHECK-NEXT: v49 = PropGet v48 key="join"
// CHECK-NEXT: v50 = Call v49, v48 calleeKey="join" calleeName="join"
// CHECK-NEXT: v51 = Call v43, v41, v37, v50 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b13() role=IterationCleanup subject=v31:
// CHECK-NEXT: v52 = CatchException
// CHECK-NEXT: IteratorClose v31 completion=Throw
// CHECK-NEXT: Rethrow v52
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=1 captures=[{type=undefined|null|[[f_4]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_4]], v1: undefined|null|number|string|symbol|bigint|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=builtin(NodePathBasename) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v1 key="filename"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v2, -, v4 calleeName="basename"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
