// boot.mjs, imported on demand, calls import() on a graph of four levels and does not wait for it: this module goes on behind its await before that graph runs. Jobs of the program wait while first.mjs and boot.mjs are loaded, and the graph imports what stands lowest below both: a module with nothing to run, and a CommonJS file. later.mjs does as boot.mjs does while no job of the program waits.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
let turns = Promise.resolve();
for (let i = 0; i < 12; i++) turns = turns.then(() => {});
await import("./first.mjs");
console.log("main has first");
for (let i = 0; i < 12; i++) turns = turns.then(() => {});
const boot = await import("./boot.mjs");
console.log("main goes on");
await boot.loaded;
await turns;
const later = await import("./later.mjs");
console.log("main goes on behind later");
await later.loaded;
console.log("main ends");
