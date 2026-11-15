// A value of a sync generator rejects under a delegating yield, and the generator's `finally` enters a context. Who catches: a loop over the async generator itself goes on in that context;
// a loop over an object whose method makes the generator, and a consumer that steps by hand, go on in their own.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), out = [], s = () => String(als.getStore()); als.run("w", () => {});
function* values() { try { yield 1; yield Promise.reject("x"); } finally { als.enterWith("f"); } }
async function* delegates() { yield* values(); }
class Bag { async *[Symbol.asyncIterator]() { yield* values(); } }
async function overFunction() { try { for await (const x of delegates()) out.push(x); } catch (e) { out.push("function", e, s()); } }
async function overMethod() { try { for await (const x of new Bag()) out.push(x); } catch (e) { out.push("method", e, s()); } }
async function byHand() { const it = delegates(); try { for (;;) { const r = await it.next(); if (r.done) break; out.push(r.value); } } catch (e) { out.push("hand", e, s()); } }
async function main() { await als.run("a", overFunction); await als.run("b", overMethod); await als.run("c", byHand); console.log(out.join(" ")); }
main();
