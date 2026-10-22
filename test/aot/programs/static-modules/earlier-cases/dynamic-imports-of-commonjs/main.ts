// import() of CommonJS files: one that exports `then`, a promise that is kept, the keys, live and copied names.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
console.log(await import("./then.cjs").then(m => m.a));
const kept = import("./kept.cjs"); console.log((await kept).a);
console.log(Object.keys(await import("./keys.cjs")).sort().join());
const both = await import("./both.cjs"); console.log(both.a, both.default.a, typeof both);
