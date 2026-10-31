import { createRequire } from "node:module";
console.log("import.meta.require", JSON.stringify(import.meta.require("./import-meta-require.rc")));
console.log("made in a module", JSON.stringify(createRequire(import.meta.url)("./made-in-a-module.tmpl")));
