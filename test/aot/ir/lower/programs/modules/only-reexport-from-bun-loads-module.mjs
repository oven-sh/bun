// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 8

// FILE: main.mjs
// Microtasks of the program count the steps in which each file is loaded. A file that imports from "bun" loads no module for it; the first file that re-exports from "bun" waits for the loader to load that module, and later ones find it loaded.
globalThis.jobs = 0;
let counts = true;
(function count() {
  if (!counts || globalThis.jobs > 2000) return;
  globalThis.jobs++;
  Promise.resolve().then(count);
})();
globalThis.tell = (...what) => console.log(...what, "after", globalThis.jobs - globalThis.start);
const load = async (what, start) => {
  const from = (globalThis.start = globalThis.jobs);
  const loaded = await start();
  console.log(what, "is imported after", globalThis.jobs - from);
  return loaded;
};
await load("names", () => import("./imports-names.mjs"));
await load("the namespace and the default export", () => import("./imports-namespace.mjs"));
await load("nothing", () => import("./imports-nothing.mjs"));
const star = await load("the first re-export", () => import("./exports-star.mjs"));
const named = await load("the second re-export", () => import("./exports-names.mjs"));
const namespace = await load("a re-exported namespace", () => import("./exports-namespace.mjs"));
await load("names again", () => import("./imports-names-again.mjs"));
console.log(star.version === Bun.version, named.version === Bun.version, namespace.all.version === Bun.version, namespace.all === Bun);
counts = false;

// FILE: exports-names.mjs
export { version, argv } from "bun";
tell("exports-names begins");

// FILE: exports-namespace.mjs
export * as all from "bun";
tell("exports-namespace begins");

// FILE: exports-star.mjs
export * from "bun";
tell("exports-star begins");

// FILE: imports-names-again.mjs
import { version } from "bun";
tell("imports-names-again begins", typeof version);

// FILE: imports-names.mjs
import { version, argv } from "bun";
tell("imports-names begins", typeof version, typeof argv);

// FILE: imports-namespace.mjs
import * as all from "bun";
import bun from "bun";
tell("imports-namespace begins", all === bun);

// FILE: imports-nothing.mjs
import "bun";
tell("imports-nothing begins");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: count load
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="counts"
// CHECK-NEXT: v3 = Convert v2 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b5(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="globalThis" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="jobs"
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Integer integer=2000
// CHECK-NEXT: v12 = Greater v10, v11
// CHECK-NEXT: Branch v12 -> taken b6(), notTaken b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="globalThis" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="jobs"
// CHECK-NEXT: v17 = Increment v16
// CHECK-NEXT: PropSet v15, v17 key="jobs"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="Promise" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="resolve"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v24 = Call v23, v21 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="then"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v27, v25, v0 calleeKey="then" calleeName="then"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: b5(v30):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="globalThis" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="globalThis" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="jobs"
// CHECK-NEXT: PropSet v4, v8 key="start"
// CHECK-NEXT: v10 = Convert v8 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v1 calleeName="start"
// CHECK-NEXT: v12 = Await v11, v0, v1
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = String string="is imported after"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="globalThis" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="jobs"
// CHECK-NEXT: v23 = Convert v22 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v24 = Sub v23, v10
// CHECK-NEXT: v25 = Call v17, v15, v0, v18, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
