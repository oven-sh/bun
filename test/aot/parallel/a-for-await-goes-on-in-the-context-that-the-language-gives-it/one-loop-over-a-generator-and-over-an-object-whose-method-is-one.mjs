// One loop serves a generator and an object whose method is a generator: it goes on in what the body entered for the first and in its own context for the second.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore()); als.run("w", () => {});
async function* body() { await null; als.enterWith("g"); yield 1; } const bag = { async *[Symbol.asyncIterator]() { await null; als.enterWith("g"); yield 1; } };
async function eat(it) { for await (const x of it) console.log(x, s()); } async function main() { await als.run(undefined, () => eat(body())); await als.run(undefined, () => eat(bag)); } main();
