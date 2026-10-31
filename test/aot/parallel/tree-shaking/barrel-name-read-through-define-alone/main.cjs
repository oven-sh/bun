// "sideEffects": false. The define gives ALIAS the name b, and nothing else of the file reads b. `bun run` evaluates the three files behind the barrel. The executable holds three files: this one, the barrel and b.js.
// Flags: --define ALIAS=b
// STATISTIC: SourceFilesInferred = 3
const { b, c } = require("pkg");
console.log(ALIAS, globalThis.loaded.includes("b"));
