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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: function):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="counts"
// CHECK-NEXT: v3 = ToBoolean v2
// CHECK-NEXT: Branch v3 -> taken b1(| 0), notTaken b3()
// CHECK-NEXT: b1(v4):
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="globalThis" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="jobs"
// CHECK-NEXT: v9 = Integer integer=2000
// CHECK-NEXT: v10 = Greater v8, v9
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="globalThis" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="jobs"
// CHECK-NEXT: v15 = Increment v14
// CHECK-NEXT: PropSet v13, v15 key="jobs"
// CHECK-NEXT: v17 = Builtin builtin=GlobalThis
// CHECK-NEXT: v18 = PropGet v17 key="Promise" [isFreeName]
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="resolve"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(PromiseResolve) flags=[IsExpected]}
// CHECK-NEXT: v22 = Call v21, v19 calleeKey="resolve" calleeName="Promise.resolve"
// CHECK-NEXT: v23 = PropGet v22 key="then"
// CHECK-NEXT: v24 = Call v23, v22, v0 calleeKey="then" calleeName="then"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: Return v25
// CHECK-NEXT: b3():
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="load"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync] length=2 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="globalThis" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="globalThis" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="jobs"
// CHECK-NEXT: PropSet v4, v8 key="start"
// CHECK-NEXT: v10 = Call v1 calleeName="start"
// CHECK-NEXT: v11 = Await v10, v0, v1
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="is imported after"
// CHECK-NEXT: v18 = Builtin builtin=GlobalThis
// CHECK-NEXT: v19 = PropGet v18 key="globalThis" [isFreeName]
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="jobs"
// CHECK-NEXT: v22 = Sub v21, v8
// CHECK-NEXT: v23 = Call v16, v14, v0, v17, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
