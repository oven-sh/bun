// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// In an ES module `require`, `module`, `exports`, `__filename` and `__dirname` are ordinary names if the file declares them. The calls here mean the file's own functions and load nothing.
import { viaParameter } from "./parameters.js";

function require(name) { return "my require of " + name; }
const module = { exports: "my module.exports", require: name => "my module.require of " + name };
const exports = { value: "my exports" };
const __filename = "my __filename";
const __dirname = "my __dirname";

console.log(require("./not-a-file.js"), require("node:fs"));
console.log(module.exports, module.require("./not-a-file.js"), exports.value, __filename, __dirname);
console.log(viaParameter(name => "a parameter named require got " + name));

// FILE: parameters.js
export function viaParameter(require) {
  return require("./not-a-file-either.js");
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = String string="my module.exports"
// CHECK-NEXT: v3 = NewClosure function=[[f_2]]
// CHECK-NEXT: v4 = NewObject -, v2, v3 layout=[[L_3]] fields=[0, 1]
// CHECK-NEXT: v5 = FinishObject v4
// CHECK-NEXT: v6 = Data data=[[d_4]]
// CHECK-NEXT: v7 = String string="my __filename"
// CHECK-NEXT: v8 = String string="my __dirname"
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="console" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v12 = PropGet v11 key="log"
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v14 = String string="./not-a-file.js"
// CHECK-NEXT: v15 = Call v1, -, v14 calleeName="require"
// CHECK-NEXT: v16 = String string="node:fs"
// CHECK-NEXT: v17 = Call v1, -, v16 calleeName="require"
// CHECK-NEXT: v18 = Call v13, v11, v15, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v5 key="exports"
// CHECK-NEXT: v25 = PropGet v5 key="require"
// CHECK-NEXT: v26 = String string="./not-a-file.js"
// CHECK-NEXT: v27 = Call v25, v5, v26 calleeKey="require" calleeName="module.require"
// CHECK-NEXT: v28 = PropGet v6 key="value"
// CHECK-NEXT: v29 = Call v23, v21, v24, v27, v28, v7, v8 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v36 = CheckInitialized v35 name="viaParameter"
// CHECK-NEXT: v37 = NewClosure function=[[f_6]]
// CHECK-NEXT: v38 = Call v36, -, v37 calleeName="viaParameter"
// CHECK-NEXT: v39 = Call v34, v32, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Undefined
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = String string="my require of "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="my module.require of "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = String string="a parameter named require got "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
