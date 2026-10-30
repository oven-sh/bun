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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = String string="my module.exports"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v4 = NewObject layout=[[L_2]]
// CHECK-NEXT: PropDefine v4, v3 key="exports"
// CHECK-NEXT: v6 = NewClosure function=[[f_3]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v7 key="require"
// CHECK-NEXT: v9 = FinishObject v4
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Data data=[[d_5]]
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v13 = String string="my __filename"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|"my __filename" flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="my __dirname"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|"my __dirname" flags=[IsExpected]}
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="console" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="log"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v22 = String string="./not-a-file.js"
// CHECK-NEXT: v23 = Call v1, -, v22 calleeName="require"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v25 = String string="node:fs"
// CHECK-NEXT: v26 = Call v1, -, v25 calleeName="require"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v21, v19, v24, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v10 key="exports"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v10 key="require"
// CHECK-NEXT: v37 = Convert v36 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v38 = String string="./not-a-file.js"
// CHECK-NEXT: v39 = Call v37, v10, v38 calleeKey="require" calleeName="module.require"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v12 key="value"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v43 = Call v33, v31, v35, v40, v42, v14, v16 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v44 = Builtin builtin=GlobalThis
// CHECK-NEXT: v45 = PropGet v44 key="console" [isFreeName]
// CHECK-NEXT: v46 = Convert v45 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v47 = PropGet v46 key="log"
// CHECK-NEXT: v48 = Convert v47 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v50 = CheckInitialized v49 name="viaParameter"
// CHECK-NEXT: v51 = NewClosure function=[[f_8]]
// CHECK-NEXT: v52 = Call v50, -, v51 calleeName="viaParameter"
// CHECK-NEXT: v53 = Call v48, v46, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: Return v54
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="my require of "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="require"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="my module.require of "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="a parameter named require got "
// CHECK-NEXT: v2 = Add v1, v0
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
