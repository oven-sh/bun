// The file where the ring is entered also imports a file that awaits a timer. b.mjs runs at once, a.mjs when the timer has fired, and the call for b.mjs settles as the evaluation of a.mjs does.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const order = [];
const first = import("./a.mjs");
first.then(() => order.push("first"));
await null;
const second = import("./b.mjs");
second.then(() => order.push("second"));
await Promise.all([first, second]);
console.log(order.join());
/* Output:
slow starts
b runs
slow ends
a sees B
first,second
*/
