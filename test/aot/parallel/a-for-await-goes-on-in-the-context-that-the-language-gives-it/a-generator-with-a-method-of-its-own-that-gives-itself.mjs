// The generator has a method of its own under Symbol.asyncIterator that gives the generator itself: the loop calls next() and awaits in its own context.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore()); als.run("w", () => {});
async function* body() { await null; als.enterWith("g"); yield 1; }
async function main() { const g = body(); g[Symbol.asyncIterator] = function () { return this; }; for await (const x of g) console.log(x, s()); console.log("end", s()); } main();
