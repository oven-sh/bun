// Whoever awaits a step goes on in the context in which it awaited, whatever context the body is in when the piece arrives.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms));
process.on("unhandledRejection", () => seen.push("UNHANDLED"));
const bag = how => ({ async *[Symbol.asyncIterator]() { try { await later(2); if (how) als.enterWith("body"); yield 1; await later(1); throw new RangeError("r"); } finally { seen.push("fin"); } } });
async function loop(how, stops) { try { for await (const v of bag(how)) { seen.push(v + ":" + als.getStore()); if (stops) break; } } catch (error) { seen.push(error.name + ":" + als.getStore()); } }
await later(1); await loop(false); await loop(false, true); await loop(true); await loop(true, true); console.log(seen.join(" "));
