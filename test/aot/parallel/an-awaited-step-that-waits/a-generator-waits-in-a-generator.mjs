// Whoever awaits a step goes on in the context in which it awaited, whatever context the body is in when the piece arrives.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms));
const bag = { async *[Symbol.asyncIterator]() { await later(2); als.enterWith("body"); yield 1; await later(1); yield 2; } };
async function* over() { for await (const v of bag) { seen.push("o" + v + ":" + als.getStore()); yield v; } }
async function* star() { yield* bag; }
async function main() { await later(1); for await (const v of over()) seen.push(v + ":" + als.getStore()); als.exit(() => {}); for await (const v of star()) seen.push("s" + v + ":" + als.getStore()); }
await main(); console.log(seen.join(" "));
