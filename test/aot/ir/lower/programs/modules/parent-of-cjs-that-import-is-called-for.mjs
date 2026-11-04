// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 11

// FILE: main.mjs
// The parent of a commonjs file that import is called for.
import "./first.cjs";
const asked = import("./asked.cjs");
import.meta.require("./requires-what-is-asked-for.cjs");
console.log("asked", (await asked).parent());
const earlier = await import("./imported-earlier.cjs");
const later = await import("./requires-what-was-imported.cjs");
console.log("imported earlier", earlier.early, earlier.parent(), later.children());
await import("./requires-what-is-imported-later.cjs");
const kept = await import("./imported-later.cjs");
console.log("imported later", kept.early, kept.parent());
await import("./graph.mjs");
console.log("main");

// FILE: asked.cjs
const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("asked", nameOf(module.parent));
exports.parent = () => nameOf(module.parent);

// FILE: first.cjs
console.log("first");

// FILE: graph.mjs
import "./in-graph-a.cjs";
import "./in-graph-b.cjs";
console.log("graph");

// FILE: imported-earlier.cjs
const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
exports.early = nameOf(module.parent);
exports.parent = () => nameOf(module.parent);

// FILE: imported-later.cjs
const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
exports.early = nameOf(module.parent);
exports.parent = () => nameOf(module.parent);

// FILE: in-graph-a.cjs
const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("a begins", nameOf(module.parent));
require("./in-graph-b.cjs");
console.log("a ends");

// FILE: in-graph-b.cjs
const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
console.log("b", nameOf(module.parent));

// FILE: requires-what-is-asked-for.cjs
console.log("requires what is asked for");
require("./asked.cjs");

// FILE: requires-what-is-imported-later.cjs
require("./imported-later.cjs");

// FILE: requires-what-was-imported.cjs
const nameOf = file => (file ? require("node:path").basename(file.filename) : String(file));
require("./imported-earlier.cjs");
exports.children = () => module.children.map(nameOf).join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="asked"
// CHECK-NEXT: v11 = Await v0
// CHECK-NEXT: v12 = PropGet v11 key="parent"
// CHECK-NEXT: v13 = Call v12, v11 calleeKey="parent" calleeName="(await asked).parent"
// CHECK-NEXT: v14 = Call v9, v7, v10, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = ImportModule module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v16 = Await v15
// CHECK-NEXT: v17 = ImportModule module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v18 = Await v17
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = String string="imported earlier"
// CHECK-NEXT: v25 = PropGet v16 key="early"
// CHECK-NEXT: v26 = PropGet v16 key="parent"
// CHECK-NEXT: v27 = Call v26, v16 calleeKey="parent" calleeName="earlier.parent"
// CHECK-NEXT: v28 = PropGet v18 key="children"
// CHECK-NEXT: v29 = Call v28, v18 calleeKey="children" calleeName="later.children"
// CHECK-NEXT: v30 = Call v23, v21, v24, v25, v27, v29 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v31 = ImportModule module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: v32 = Await v31
// CHECK-NEXT: v33 = ImportModule module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: v34 = Await v33
// CHECK-NEXT: v35 = Builtin builtin=GlobalThis
// CHECK-NEXT: v36 = PropGet v35 key="console" [isFreeName]
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v38 = PropGet v37 key="log"
// CHECK-NEXT: v39 = Convert v38 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v40 = String string="imported later"
// CHECK-NEXT: v41 = PropGet v34 key="early"
// CHECK-NEXT: v42 = PropGet v34 key="parent"
// CHECK-NEXT: v43 = Call v42, v34 calleeKey="parent" calleeName="kept.parent"
// CHECK-NEXT: v44 = Call v39, v37, v40, v41, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v45 = ImportModule module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: v46 = Await v45
// CHECK-NEXT: v47 = Builtin builtin=GlobalThis
// CHECK-NEXT: v48 = PropGet v47 key="console" [isFreeName]
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v50 = PropGet v49 key="log"
// CHECK-NEXT: v51 = Convert v50 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v52 = String string="main"
// CHECK-NEXT: v53 = Call v51, v49, v52 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v54 = Undefined
// CHECK-NEXT: Return v54
// CHECK-NEXT: }
