// Two calls of import() wait for their texts at once, and a third, made by a module that one of them has loaded, imports the module right below the root of the deep graph.
// `bun run` reads a graph level by level, each level a turn of the event loop behind the one above it, and a text comes when the first module that asks for it has it, whichever call that
// module belongs to. The last text of the deep graph is the last of both, and both run in its turn: of two roots that are as near to it, first the one that asked first.
// The texts are read at once, on other threads: not every run of `bun run` prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = [];
all.push(import("./x1.mjs").then(() => console.log("x1 settled")));
all.push(import("./y0.mjs").then(() => console.log("y0 settled")));
await Promise.all(all);
console.log("main ends");
/* Output:
x1 runs
x1 settled
s runs
y4 runs
y3 runs
y2 runs
y1 runs
y0 runs
w runs
y0 settled
w settled
main ends
*/
