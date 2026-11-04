// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
// The cycle is entered at b, so a runs first and finds `fromB` uninitialized: so says the language, and so do node and `bun run`. A bundle hoists the binding, so `bun build --compile` is no reference here.
const settled = await Promise.allSettled([import("./b.mjs"), import("./a.mjs")]);
console.log(settled.map(it => it.status + " " + (it.reason?.constructor.name ?? "")).join("|"));
/* Output:
rejected ReferenceError|rejected ReferenceError
*/
