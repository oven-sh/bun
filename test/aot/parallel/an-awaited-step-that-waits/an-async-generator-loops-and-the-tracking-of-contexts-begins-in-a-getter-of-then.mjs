// The loop stands in an async generator. What the body returns has a getter of then that enters a context: the loop goes on in it.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms));
const bag = { async *[Symbol.asyncIterator]() { yield {}; return { get then() { als.enterWith("ret"); return undefined; } }; } };
async function* consumer() { for await (const v of bag) yield typeof v + ":" + als.getStore(); yield "end:" + als.getStore(); }
async function loop() { for await (const x of consumer()) seen.push(x + "/" + als.getStore()); }
await later(1); await loop(); console.log(seen.join(" "));
