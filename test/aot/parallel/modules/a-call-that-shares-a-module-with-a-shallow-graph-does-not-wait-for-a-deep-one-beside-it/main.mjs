// Reference: bun build --compile
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// Todo: an import() of compiled code waits as many jobs as the loader of `bun run` takes, and more for a deeper graph
// Three calls of import() in one turn, and a fourth, made by a module that the first has loaded. An executable holds every text: the graphs run in the order of the calls, however deep, and then the calls settle in that order.
// The name says what `bun run` does.
const all = [];
all.push(import("./x1.mjs").then(() => console.log("x1 settled")));
all.push(import("./x2.mjs"));
all.push(import("./y0.mjs").then(() => console.log("y0 settled")));
await Promise.all(all);
console.log("main ends");
