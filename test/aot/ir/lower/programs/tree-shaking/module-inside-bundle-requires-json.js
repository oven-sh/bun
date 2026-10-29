// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.js
// A module inside a bundle requires a json file.
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) =>
  function __require() {
    return (mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports);
  };
var require_inner = __commonJS({
  "inner.js"(exports, module) {
    module.exports = require("./data.json").version;
  },
});
console.log(require_inner());

// FILE: data.json
{ "version": "1.2.3", "nested": { "port": 80, "deep": { "on": true, "off": null } }, "list": [1, 2, 3] }

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
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Builtin builtin=ObjectGetOwnPropertyNames
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v6 = NewClosure v5 function=[[f_4]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="console" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="log"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare]
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v15 = Call v12, v10, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inner.js"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=CommonJsModule flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_7]]
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = RequireModule module=[[m_8]] referrer=[[m_0]] specifier="./data.json"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="version"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PutModuleVariable v7 variable=[[g_7]]
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 captures=[{type=undefined|null|[[f_3]]|builtin(ObjectGetOwnPropertyNames) flags=[IsExpected]}] thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|[[L_9]] flags=[IsExpected]}] results=[{type=undefined|null|[[f_10]] flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_3]]|builtin(ObjectGetOwnPropertyNames), v1: undefined|null|object, v2: undefined|null|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = NewObject -, v2 layout=[[L_11]] fields=[0]
// CHECK-NEXT: v4 = NewClosure v3, v0, v1 function=[[f_12]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] captures=[{type=env [[L_11]] flags=[IsFromCompiler]}, {type=undefined|null|[[f_3]]|builtin(ObjectGetOwnPropertyNames) flags=[IsExpected]}, {type=undefined|null|object flags=[IsExpected]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: env [[L_11]], v1: undefined|null|[[f_3]]|builtin(ObjectGetOwnPropertyNames), v2: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v7 = Call v1, -, v2 calleeName="__getOwnPropNames"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v9 = Integer
// CHECK-NEXT: v10 = ElemGet v8, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = ElemGet v2, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v14 = Data data=[[d_13]]
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v15 layout=[[L_11]]
// CHECK-NEXT: v17 = PropGet v14 key="exports"
// CHECK-NEXT: v18 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v19 = Call v13, -, v17, v18
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = GetEnvironmentField v0 layout=[[L_11]]
// CHECK-NEXT: v21 = PropGet v20 key="exports"
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] builtinMembers=[ObjectGetOwnPropertyNames]
