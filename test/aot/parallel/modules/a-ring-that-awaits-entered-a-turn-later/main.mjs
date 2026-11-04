// Both files of the ring await. The second call enters at b.mjs, which belongs to a ring that was entered at a.mjs: it settles as the evaluation of a.mjs does, and behind the call for a.mjs.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
first.then(() => console.log("first settled"));
await null;
const second = import("./b.mjs");
second.then(() => console.log("second settled"));
await Promise.all([first, second]);
console.log("loaded");
/* Output:
b starts
b ends
a sees B
a ends
first settled
second settled
loaded
*/
