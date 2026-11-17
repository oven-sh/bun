// The iterable is an object whose method under Symbol.asyncIterator gives a generator: the loop calls next() and awaits in its own context.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(); als.run("w", () => {});
async function* g() { await 0; als.enterWith("x"); yield 1; }
async function main() { for await (const v of { [Symbol.asyncIterator]: () => g() }) console.log(v, String(als.getStore())); } main();
