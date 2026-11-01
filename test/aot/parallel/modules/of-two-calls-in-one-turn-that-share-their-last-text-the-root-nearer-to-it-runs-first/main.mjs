// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// Two calls of import() in one turn. Both graphs end at s.mjs, the first a level deeper than the second. An executable holds every text: the graphs run in the order of the calls.
// The name says what `bun run` does, which reads a level a turn.
await Promise.all([import("./b.mjs"), import("./a.mjs")]);
console.log("main ends");
