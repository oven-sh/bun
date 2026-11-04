// Two calls of import() for one file, two jobs apart, while its graph is loaded. No ring: the second call waits for the graph of the first all the same, which is its own.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
for (let turn = 0; turn < 2; turn++) await null;
const second = import("./a.mjs");
let secondHasSettled = false;
second.then(() => {
  secondHasSettled = true;
});
await first;
let jobs = 0;
while (!secondHasSettled) {
  await null;
  jobs++;
}
console.log("the second call settled " + jobs + " jobs behind the first");
/* Output:
b runs
a runs
the second call settled 1 jobs behind the first
*/
