// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// `__esModule` stored through a JSDoc cast marks the module, so an interop helper does not box it.
function _interop(obj) { return obj && obj.__esModule ? obj : { default: obj }; }
console.log(_interop(require("./lib")).default.length);

// FILE: lib.js
/** @type {any} */ (exports.__esModule) = true;
exports.default = "d";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v12 = Convert v11 declared={type=[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v14 = PropGet v12 key="__esModule"
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b3(v12), notTaken b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v16 = NewObject -, v12 layout=[[L_7]] fields=[0]
// CHECK-NEXT: v17 = FinishObject v16
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b3(v18):
// CHECK-NEXT: v19 = PropGet v18 key="default"
// CHECK-NEXT: v20 = PropGet v19 key="length"
// CHECK-NEXT: v21 = Call v9, v7, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="_interop"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_8]]):
// CHECK-NEXT: v1 = ToBoolean v0
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2()
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = PropGet v0 key="__esModule"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b3(v0), notTaken b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = NewObject -, v0 layout=[[L_9]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
