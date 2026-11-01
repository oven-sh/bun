// Two calls of import() in one turn. Both graphs end at s.mjs, the first a level deeper than the second. `bun run` has the text of s.mjs when the second graph has asked for it, the news of it goes
// up a level a job, and the root that is nearer to it runs first.
// In which turn each call goes on is not asked here: the lines say in which order the files run.
// The texts are read at once, on other threads: not every run of `bun run` prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
await Promise.all([import("./b.mjs"), import("./a.mjs")]);
console.log("main ends");
/* Output:
s runs
a runs
b2 runs
b runs
main ends
*/
