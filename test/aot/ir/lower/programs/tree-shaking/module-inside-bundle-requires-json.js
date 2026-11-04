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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Builtin builtin=ObjectGetOwnPropertyNames
// CHECK-NEXT: PutModuleVariable v4 variable=[[g_3]]
// CHECK-NEXT: v6 = NewClosure function=[[f_4]]
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="console" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v10 = PropGet v9 key="log"
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare]
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v14 = Call v11, v9, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inner.js"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=CommonJsModule flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_6]]
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = RequireModule module=[[m_7]] referrer=[[m_0]] specifier="./data.json"
// CHECK-NEXT: v5 = PropGet v4 key="version"
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_6]]
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__commonJS"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}, {type=undefined|null|[[L_8]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: undefined|null|[[L_8]]):
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v3 = NewClosure v2, v0 function=[[f_10]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="__require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] captures=[{type=env [[L_9]] flags=[IsFromCompiler]}, {type=undefined|null|object flags=[IsExpected] variableName="cb"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_9]], v1: undefined|null|object):
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b1(| 0)
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v6 = Call v5, -, v1 calleeName="__getOwnPropNames"
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = ElemGet v6, v7
// CHECK-NEXT: v9 = ElemGet v1, v8
// CHECK-NEXT: v10 = Data data=[[d_11]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: PutEnvironmentField v0, v11 layout=[[L_9]]
// CHECK-NEXT: v13 = PropGet v10 key="exports"
// CHECK-NEXT: v14 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v15 = Call v9, -, v13, v14
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = GetEnvironmentField v0 layout=[[L_9]]
// CHECK-NEXT: v17 = PropGet v16 key="exports"
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
