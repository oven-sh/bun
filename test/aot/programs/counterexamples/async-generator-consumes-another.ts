// An async generator consumes another one with `for await` and yields what it gets.
declare const console: { log(...values: unknown[]): void };
async function* chain(n: number): AsyncGenerator<number> { if (n === 0) { yield 1; yield 2; return; } for await (const v of chain(n - 1)) yield v + 1; }
async function main() { for await (const v of chain(1)) console.log("got " + v); console.log("done"); }
main();
