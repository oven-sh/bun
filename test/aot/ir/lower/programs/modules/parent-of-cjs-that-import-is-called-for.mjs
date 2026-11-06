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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Promise<undefined|null|[[L_2]]> flags=[IsExpected]}
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: RecordRequire module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="asked"
// CHECK-NEXT: v12 = Await v1
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="parent"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Call v15, v13 calleeKey="parent" calleeName="parent"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v10, v8, v11, v17 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v19 = ImportModule module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|Promise<undefined|null|[[L_6]]> flags=[IsExpected]}
// CHECK-NEXT: v21 = Await v20
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v23 = ImportModule module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Promise<undefined|null|[[L_8]]> flags=[IsExpected]}
// CHECK-NEXT: v25 = Await v24
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v27 = Builtin builtin=GlobalThis
// CHECK-NEXT: v28 = PropGet v27 key="console" [isFreeName]
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="log"
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v32 = String string="imported earlier"
// CHECK-NEXT: v33 = PropGet v22 key="early"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v22 key="parent"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v37 = Call v36, v22 calleeKey="parent" calleeName="earlier.parent"
// CHECK-NEXT: v38 = Convert v37 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v26 key="children"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v41 = Call v40, v26 calleeKey="children" calleeName="later.children"
// CHECK-NEXT: v42 = Call v31, v29, v32, v34, v38, v41 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v43 = ImportModule module=[[m_11]] referrer=[[m_0]]
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|Promise<undefined|null|[[L_12]]> flags=[IsExpected]}
// CHECK-NEXT: v45 = Await v44
// CHECK-NEXT: v46 = ImportModule module=[[m_13]] referrer=[[m_0]]
// CHECK-NEXT: v47 = Convert v46 declared={type=undefined|null|Promise<undefined|null|[[L_6]]> flags=[IsExpected]}
// CHECK-NEXT: v48 = Await v47
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v50 = Builtin builtin=GlobalThis
// CHECK-NEXT: v51 = PropGet v50 key="console" [isFreeName]
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v52 key="log"
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v55 = String string="imported later"
// CHECK-NEXT: v56 = PropGet v49 key="early"
// CHECK-NEXT: v57 = Convert v56 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v58 = PropGet v49 key="parent"
// CHECK-NEXT: v59 = Convert v58 declared={type=undefined|null|[[f_14]] flags=[IsExpected]}
// CHECK-NEXT: v60 = Call v59, v49 calleeKey="parent" calleeName="kept.parent"
// CHECK-NEXT: v61 = Convert v60 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v62 = Call v54, v52, v55, v57, v61 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v63 = ImportModule module=[[m_15]] referrer=[[m_0]]
// CHECK-NEXT: v64 = Convert v63 declared={type=undefined|null|Promise<undefined|null|object> flags=[IsExpected]}
// CHECK-NEXT: v65 = Await v64
// CHECK-NEXT: v66 = Builtin builtin=GlobalThis
// CHECK-NEXT: v67 = PropGet v66 key="console" [isFreeName]
// CHECK-NEXT: v68 = Convert v67 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v69 = PropGet v68 key="log"
// CHECK-NEXT: v70 = Convert v69 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v71 = String string="main"
// CHECK-NEXT: v72 = Call v70, v68, v71 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v73 = Undefined
// CHECK-NEXT: Return v73
// CHECK-NEXT: }
