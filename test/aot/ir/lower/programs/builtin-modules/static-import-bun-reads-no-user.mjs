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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string=":"
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="log"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeKey="join" calleeName="log.join"
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v14):
// CHECK-NEXT: Jump -> next b3(v14)
// CHECK-NEXT: b2(v15):
// CHECK-NEXT: v16 = String string="nothing"
// CHECK-NEXT: Jump -> next b3(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: v18 = Call v5, v3, v7, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v20 = CheckInitialized v19 name="log"
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: PropSet v20, v21 key="length"
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=anything variableName="key"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="log"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = PropGet v0 key="length"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
