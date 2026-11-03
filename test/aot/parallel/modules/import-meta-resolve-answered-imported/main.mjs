// What import meta resolve answered is imported.
const written = await import(import.meta.resolve("./one.mjs"));
console.log("written out", written.which);

const chosen = import.meta.resolve(process.argv.length > 7 ? "./one.mjs" : "./two.mjs");
console.log("chosen", (await import(chosen)).which);
console.log("chosen is the module that is written out", (await import(chosen)) === (await import("./two.mjs")));

const path = require.resolve(import.meta.resolve("./one.mjs"));
console.log("by the path of the URL", (await import(path)).which);
console.log("by the URL of the path", (await import(import.meta.resolve(path))).which);
