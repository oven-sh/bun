// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="show"
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK-LABEL: function {{*}}name="get"

// FILE: main.mjs
// A getter that the program put on process runs where a statement exports its name from node process.
const holder = process;
const log = [];
globalThis.note = text => log.push(text);
const show = what => { console.log(what + ":", log.join(" ") || "nothing"); log.length = 0; };
const attempt = async (what, run) => { try { console.log(what, await run()); } catch (error) { console.log(what, "throws", error.name, String(error.message).slice(0, 70)); } show(what); };

Object.defineProperty(holder, "custom", { get() { note("get"); return 1; }, enumerable: true, configurable: true });
let file;
try { file = await import("./reads.mjs"); show("import"); } catch (error) { console.log("import throws", error.name, String(error.message).slice(0, 90)); show("import"); }
if (file) {
await attempt("read", () => file.custom + file.custom);
}

// FILE: reads.mjs
export { custom } from "node:process"; note("starts");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
