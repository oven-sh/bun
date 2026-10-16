// The `then` of a thenable that an async function returns has `this: any` and hands on a function field: a new one for each instance.
declare const console: { log(...a: unknown[]): void };
class Th { f = () => 1; then(this: any, res: (v: () => number) => void) { res(this.f); } }
async function run(): Promise<() => number> { return new Th(); }
console.log(await run() === await run());
