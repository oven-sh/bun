// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.cjs
// The id and loaded of a module object are deleted.
delete module.id; delete module.loaded;
console.log(module.id, module.loaded, "id" in module, Object.keys(module).includes("loaded"));
const { id, loaded, filename = "none" } = module;
console.log(id, loaded, typeof filename);

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
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v4 = PropDelete v3 key="id" mode=Sloppy
// CHECK-NEXT: v5 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v6 = PropDelete v5 key="loaded" mode=Sloppy
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v12 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v13 = PropGet v12 key="id"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ModuleObjectId) flags=[IsExpected]}
// CHECK-NEXT: v15 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v16 = PropGet v15 key="loaded"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ModuleObjectLoaded) flags=[IsExpected]}
// CHECK-NEXT: v18 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v19 = PropHas v18 key="id"
// CHECK-NEXT: v20 = Builtin builtin=Object
// CHECK-NEXT: v21 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v22 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v23 = Call v21, v20, v22 calleeName="Object.keys"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="includes"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v27 = String string="loaded"
// CHECK-NEXT: v28 = Call v26, v24, v27 calleeKey="includes" calleeName="includes"
// CHECK-NEXT: v29 = Convert v28 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v30 = Call v11, v9, v14, v17, v19, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v31 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v32 = TypeTest v31 testedType=undefined|null
// CHECK-NEXT: Branch v32 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v33):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v34 = NewRuntimeError runtimeError=NotDestructurable name="id"
// CHECK-NEXT: Throw v34
// CHECK-NEXT: b4(v35):
// CHECK-NEXT: v36 = PropGet v35 key="id"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v35 key="loaded"
// CHECK-NEXT: v39 = Convert v38 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v40 = PropGet v35 key="filename"
// CHECK-NEXT: v41 = TypeTest v40 testedType=undefined
// CHECK-NEXT: Branch v41 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v42):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v43 = String string="none"
// CHECK-NEXT: Jump -> next b8(v43)
// CHECK-NEXT: b7(v44):
// CHECK-NEXT: Jump -> next b8(v44)
// CHECK-NEXT: b8(v45):
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v47 = Builtin builtin=GlobalThis
// CHECK-NEXT: v48 = PropGet v47 key="console" [isFreeName]
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v50 = PropGet v49 key="log"
// CHECK-NEXT: v51 = Convert v50 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v52 = TypeOf v46
// CHECK-NEXT: v53 = Call v51, v49, v37, v39, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: Return v54
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
