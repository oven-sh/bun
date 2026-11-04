// The file that the second call names exports `then`. The call that waited resolves its promise with the namespace object as any other does, so the function is called.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
await null;
const second = import("./b.mjs");
console.log(await first === undefined ? "no namespace" : "a namespace", await second);
/* Output:
b runs
a runs
then is called
a namespace what then gave
*/
