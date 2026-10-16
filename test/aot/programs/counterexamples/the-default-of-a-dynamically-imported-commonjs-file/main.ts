// The `default` of a dynamically imported CommonJS file is kept in a variable.
declare const console: { log(...values: unknown[]): void };
const d = (await import("./fib.cjs")).default;
console.log(d.fib(20));
async function inside() { const ns = await import("./fib.cjs"); const e = ns.default; return e.fib(5) }
console.log(await inside());
