// The consumer is an async generator that awaits next() by hand. What the body returns has a getter of then that enters a context.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms));
async function* gen() { yield {}; return { get then() { als.enterWith("ret"); return undefined; } }; }
async function* consumer() { const it = gen(); for (;;) { const s = await it.next(); yield s.done + ":" + als.getStore(); if (s.done) break; } yield "end:" + als.getStore(); }
async function loop() { for await (const x of consumer()) seen.push(x + "/" + als.getStore()); }
await later(1); await loop(); console.log(seen.join(" "));
