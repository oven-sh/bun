// Three calls of import(), each a job behind the one before it, enter a ring of three modules at its three files. It runs once, from where the first call entered it, and the calls settle in their order.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const order = [];
const first = import("./a.mjs").then(() => order.push("first"));
await null;
const second = import("./b.mjs").then(() => order.push("second"));
await null;
const third = import("./c.mjs").then(() => order.push("third"));
await Promise.all([first, second, third]);
console.log(order.join());
/* Output:
c runs
b sees C
a sees B
first,second,third
*/
