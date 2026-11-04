// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.cjs
// The body of a CommonJS file is a sloppy function: a direct eval and its `arguments` store to `__dirname` too, and a specifier that is
// built from it is then a computed name, which finds entry points alone.
require("./a.js"), require("./other/a.js");
const row = (name, load) => {
  try {
    console.log(name, load());
  } catch (error) {
    console.log(name, "throws", error.code);
  }
};
row("eval", () => require("./by-eval.cjs"));
row("arguments", () => require("./by-arguments.cjs"));

// FILE: a.js
module.exports = "here";

// FILE: by-arguments.cjs
arguments[4] = arguments[4] + "/other";
module.exports = require(__dirname + "/a.js");

// FILE: by-eval.cjs
eval("__dirname = __dirname + \"/other\"");
module.exports = require(__dirname + "/a.js");

// FILE: other/a.js
module.exports = "there";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v11 = NewClosure function=[[f_7]]
// CHECK-NEXT: v12 = String string="eval"
// CHECK-NEXT: v13 = NewClosure function=[[f_8]]
// CHECK-NEXT: v14 = Call v11, -, v12, v13 calleeName="row"
// CHECK-NEXT: v15 = String string="arguments"
// CHECK-NEXT: v16 = NewClosure function=[[f_9]]
// CHECK-NEXT: v17 = Call v11, -, v15, v16 calleeName="row"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Call v1 calleeName="load"
// CHECK-NEXT: v8 = Call v6, v4, v0, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="throws"
// CHECK-NEXT: v16 = PropGet v9 key="code"
// CHECK-NEXT: v17 = Call v14, v12, v0, v15, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: RecordRequire module=[[m_10]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_10]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_10]] referrer=[[m_0]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleObject module=[[m_10]]
// CHECK-NEXT: v4 = PropGet v3 key="exports"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_11]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: v3 = ModuleBuiltin builtin=ModuleObject module=[[m_11]]
// CHECK-NEXT: v4 = PropGet v3 key="exports"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
