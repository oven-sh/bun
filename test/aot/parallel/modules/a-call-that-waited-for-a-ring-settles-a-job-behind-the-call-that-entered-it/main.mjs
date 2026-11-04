// The file that the second call names has run with the graph of the first, so the second call has nothing left to load.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
for (let turn = 0; turn < 1; turn++) await null;
const second = import("./b.mjs");
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
