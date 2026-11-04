// A module imports a CommonJS file and, behind it, an ES module that the file requires. While import() loads the three beside waiting jobs, the importer runs when the file has ended, and reads all that the file exports.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
let turns = Promise.resolve();
for (let turn = 1; turn <= 40; turn++) turns = turns.then(() => console.log(turn));
await import("./root.mjs");
console.log("the first graph has settled");
await import("./second-root.mjs");
console.log("the second graph has settled");
