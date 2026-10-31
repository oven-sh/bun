// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A user-defined accessor on Bun runs each time a file reads it through the namespace or default import of "bun", and not while that file loads.
const log = [];
const show = what => {
  console.log(what + ":", log.join(" ") || "nothing");
  log.length = 0;
};
globalThis.noteStart = () => log.push("the file starts");
for (const key of ["custom", "other"])
  Object.defineProperty(Bun, key, {
    get() {
      log.push(key);
      return key.length;
    },
    enumerable: true,
    configurable: true,
  });
const file = await import("./imports-bun.mjs");
show("import of the file");
console.log(file.read(), file.read());
show("two calls that read the imports");
console.log(require("bun") === Bun);
show("require");
const loaded = await import("bun");
show("import of bun");
console.log(loaded.custom, loaded.other, loaded.custom);
show("reads of its exports");
console.log((await import("bun")) === loaded);
show("import of bun again");

// FILE: imports-bun.mjs
import * as all from "bun";
import bun from "bun";
noteStart();
export const read = () => [all.custom, all.other, bun.custom].join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show get
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=":"
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="log"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Call v11, v9, v12 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v16):
// CHECK-NEXT: Jump -> next b5(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v18 = String string="nothing"
// CHECK-NEXT: Jump -> next b5(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = Call v5, v3, v7, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="log"
// CHECK-NEXT: v23 = Integer
// CHECK-NEXT: v24 = Convert v23 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v22, v24 key="length"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=undefined|null|string flags=[IsExpected]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = PropGet v0 key="length"
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
