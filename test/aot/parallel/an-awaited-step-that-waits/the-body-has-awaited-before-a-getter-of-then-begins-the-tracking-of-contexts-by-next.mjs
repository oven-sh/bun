// The same where next() is awaited by hand.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms));
async function* gen() { yield {}; await null; return { get then() { als.enterWith("ret"); return undefined; } }; }
async function loop() { const it = gen(); for (;;) { const s = await it.next(); seen.push(s.done + ":" + als.getStore()); if (s.done) break; } seen.push("end:" + als.getStore()); }
await later(1); await loop(); console.log(seen.join(" "));
