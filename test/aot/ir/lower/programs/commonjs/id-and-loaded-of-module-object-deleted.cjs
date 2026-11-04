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
// CHECK-NEXT: v24 = PropGet v23 key="includes"
// CHECK-NEXT: v25 = String string="loaded"
// CHECK-NEXT: v26 = Call v24, v23, v25 calleeKey="includes" calleeName="includes"
// CHECK-NEXT: v27 = Call v11, v9, v14, v17, v19, v26 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v28 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v29 = TypeTest v28 testedType=undefined|null
// CHECK-NEXT: Branch v29 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v30):
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=NotDestructurable name="id"
// CHECK-NEXT: Throw v31
// CHECK-NEXT: b2(v32):
// CHECK-NEXT: v33 = PropGet v32 key="id"
// CHECK-NEXT: v34 = PropGet v32 key="loaded"
// CHECK-NEXT: v35 = PropGet v32 key="filename"
// CHECK-NEXT: v36 = TypeTest v35 testedType=undefined
// CHECK-NEXT: Branch v36 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v37):
// CHECK-NEXT: v38 = String string="none"
// CHECK-NEXT: Jump -> next b5(v38)
// CHECK-NEXT: b4(v39):
// CHECK-NEXT: Jump -> next b5(v39)
// CHECK-NEXT: b5(v40):
// CHECK-NEXT: v41 = Builtin builtin=GlobalThis
// CHECK-NEXT: v42 = PropGet v41 key="console" [isFreeName]
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v43 key="log"
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v46 = TypeOf v40
// CHECK-NEXT: v47 = Call v45, v43, v33, v34, v46 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v48 = Undefined
// CHECK-NEXT: Return v48
// CHECK-NEXT: }
