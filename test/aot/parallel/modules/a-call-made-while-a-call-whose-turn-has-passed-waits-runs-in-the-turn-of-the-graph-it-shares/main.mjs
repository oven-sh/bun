// Two calls of import() wait for their texts at once, and a third, made by a module that one of them has loaded, imports the module right below the root of the deep graph, while a call waits whose turn has passed.
// `bun run` reads a graph level by level, each level a turn of the event loop behind the one above it, and a text comes when the first module that asks for it has it, whichever call that
// module belongs to. The last text of the deep graph is the last of both, and both run in its turn, the deep graph first.
// The texts are read at once, on other threads: not every run of `bun run` prints these lines, but more print them than any others. So they are stored.
// In which order the four small files run differs from run to run there: they print nothing.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = [];
all.push(import("./x1.mjs"));
all.push(import("./x2.mjs"));
all.push(import("./x3.mjs"));
all.push(import("./x4.mjs"));
all.push(import("./y0.mjs").then(() => console.log("y0 settled")));
await Promise.all(all);
console.log("main ends");
/* Output:
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
