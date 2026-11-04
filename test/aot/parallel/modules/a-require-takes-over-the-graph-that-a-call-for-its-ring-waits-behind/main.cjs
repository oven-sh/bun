// The second call waits for the graph of the first, and a require() in the same job loads that graph before it returns. Both calls settle, in their order.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const order = [];
const first = import("./a.mjs");
first.then(() => order.push("first"));
Promise.resolve().then(() => {
  const second = import("./b.mjs");
  second.then(() => order.push("second"));
  const a = require("./a.mjs");
  console.log("require returned " + a.a);
  Promise.all([first, second]).then(() => console.log(order.join()));
});
/* Output:
b runs
a sees B
require returned A
first,second
*/
