// Neither call finds the text of the file, so `bun run` reads it twice, and each call goes on in the turn in which its text comes: every job behind the first runs ahead of the second.
// Which text comes first goes by the threads there: the lines are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import("./imported.mjs").then(() => {
  console.log("first");
  let chain = Promise.resolve();
  for (let i = 1; i < 8; i++) chain = chain.then(() => console.log("first +" + i));
});
import("./imported.mjs").then(() => console.log("second"));
console.log("main");
/* Output:
main
imported
first
first +1
first +2
first +3
first +4
first +5
first +6
first +7
second
*/
