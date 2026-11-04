// A module that imports nothing is loaded ahead of the ring that was asked for in front of it, and its body asks for the other file of that ring. The ring is still entered at a.mjs.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
await Promise.all([import("./a.mjs"), import("./b.mjs")]);
console.log("loaded");
/* Output:
b starts
c runs
a runs
b ends
loaded
*/
