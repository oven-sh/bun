// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.cjs
// The fields of a module object are defined anew or stored through another name.
Object.defineProperty(module, "id", { get() { return "from a getter"; } });
Object.defineProperty(module, "loaded", { value: 7 });
console.log(module.id, module.loaded);
const m = module;
m.filename = "through another name";
console.log(module.filename);

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
// CHECK-NEXT: v3 = Builtin builtin=Object
// CHECK-NEXT: v4 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v5 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v6 = String string="id"
// CHECK-NEXT: v7 = NewClosure function=[[f_3]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v9 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v9, v8 key="get"
// CHECK-NEXT: v11 = FinishObject v9
// CHECK-NEXT: v12 = Call v4, v3, v5, v6, v11 calleeName="Object.defineProperty"
// CHECK-NEXT: v13 = Builtin builtin=Object
// CHECK-NEXT: v14 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v15 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v16 = String string="loaded"
// CHECK-NEXT: v17 = Integer integer=7
// CHECK-NEXT: v18 = NewObject -, v17 layout=[[L_5]] fields=[4]
// CHECK-NEXT: v19 = FinishObject v18
// CHECK-NEXT: v20 = Call v14, v13, v15, v16, v19 calleeName="Object.defineProperty"
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="log"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v26 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v27 = PropGet v26 key="id"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ModuleObjectId) flags=[IsExpected]}
// CHECK-NEXT: v29 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v30 = PropGet v29 key="loaded"
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(ModuleObjectLoaded) flags=[IsExpected]}
// CHECK-NEXT: v32 = Call v25, v23, v28, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v35 = String string="through another name"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v34, v36 key="filename" mode=Sloppy
// CHECK-NEXT: v38 = Builtin builtin=GlobalThis
// CHECK-NEXT: v39 = PropGet v38 key="console" [isFreeName]
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v40 key="log"
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v43 = ModuleBuiltin builtin=ModuleObject module=[[m_0]]
// CHECK-NEXT: v44 = PropGet v43 key="filename"
// CHECK-NEXT: v45 = Convert v44 declared={type=builtin(ModuleObjectFilename) flags=[IsExpected]}
// CHECK-NEXT: v46 = Call v42, v40, v45 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v47 = Undefined
// CHECK-NEXT: Return v47
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="from a getter"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
