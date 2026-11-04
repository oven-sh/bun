// Two calls of import() for the file where a ring is entered, two jobs apart. They settle in their order, with one namespace object.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const order = [];
const first = import("./a.mjs");
first.then(() => order.push("first"));
for (let turn = 0; turn < 2; turn++) await null;
const second = import("./a.mjs");
second.then(() => order.push("second"));
const [one, other] = await Promise.all([first, second]);
console.log(order.join(), one === other);
/* Output:
b runs
a runs
first,second true
*/
