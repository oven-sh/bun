// "sideEffects": false. The define gives process.env.ALIAS the name b. The file reads process.argv and never process.env.ALIAS, so nothing reads b: it reads c alone. `bun run` evaluates the three files behind the barrel. The executable holds three files: this one, the barrel and c.js.
// Flags: --define process.env.ALIAS=b
// STATISTIC: SourceFilesInferred = 3
const { b, c } = require("pkg");
console.log(process.argv.length > 0, c, globalThis.loaded.includes("c"));
