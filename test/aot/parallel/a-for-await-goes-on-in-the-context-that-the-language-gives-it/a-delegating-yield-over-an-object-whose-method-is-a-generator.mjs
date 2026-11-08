// A delegating yield over an object whose method is a generator calls next() and awaits: what that body enters does not reach the loop over the outer generator.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore()); als.run("w", () => {});
class Bag { async *[Symbol.asyncIterator]() { await null; als.enterWith("g"); yield 1; } } async function* outer() { yield* new Bag(); }
async function main() { for await (const x of outer()) console.log(x, s()); console.log("end", s()); } main();
