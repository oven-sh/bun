// Two calls of import() wait for their texts at once, and a third, made by a module that one of them has loaded, imports a file that a fourth call still waits for, though the turn of its text has passed: each call comes in a turn of its own.
// `bun run` reads a graph level by level, each level a turn of the event loop behind the one above it, and a text comes when the first module that asks for it has it, whichever call that
// module belongs to. The third call waits for no text of the deep graph.
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
w runs
w settled
s runs
y4 runs
y3 runs
y2 runs
y1 runs
y0 runs
y0 settled
main ends
*/
