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
