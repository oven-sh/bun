// The body has passed an await in this step, so the loop's await was made before the getter entered a context: the loop goes on in none.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms));
const bag = { async *[Symbol.asyncIterator]() { yield {}; await null; return { get then() { als.enterWith("ret"); return undefined; } }; } };
async function loop() { for await (const v of bag) seen.push(typeof v + ":" + als.getStore()); seen.push("end:" + als.getStore()); }
await later(1); await loop(); console.log(seen.join(" "));
