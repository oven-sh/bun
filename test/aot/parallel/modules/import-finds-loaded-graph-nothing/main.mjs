// An import finds loaded what a graph with nothing to run has brought in.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
let turns = 0, done = false;
(async () => { while (!done) { turns++; await null; } })();
const a = await import("./a.mjs"); console.log("a", turns);
const c = await import("./c.mjs"); console.log("c", turns);
const e = await import("./e.mjs"); console.log("e", turns);
done = true;
console.log(a.a() + c.c() + e.e());
