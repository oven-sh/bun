// What the body returns has a getter of then that enters a context: the tracking of contexts begins in the caller's own part of the step, and the loop goes on in that context.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms));
const bag = { async *[Symbol.asyncIterator]() { yield {}; return { get then() { als.enterWith("ret"); return undefined; } }; } };
async function loop() { for await (const v of bag) seen.push(typeof v + ":" + als.getStore()); seen.push("end:" + als.getStore()); }
await later(1); await loop(); console.log(seen.join(" "));
