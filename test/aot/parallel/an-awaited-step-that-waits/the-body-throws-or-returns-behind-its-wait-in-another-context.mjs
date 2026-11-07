// Whoever awaits a step goes on in the context in which it awaited, whatever context the body is in when the piece arrives.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms)), s = () => String(als.getStore());
async function* throws() { await later(2); als.enterWith("body"); throw new Error("e"); }
async function* returns() { await later(2); als.enterWith("body"); return 7; }
async function loop() { try { await throws().next(); } catch (e) { seen.push(e.message + ":" + s()); } const step = await returns().next(); seen.push(step.value + ":" + step.done + ":" + s()); }
await later(1); await als.run("mine", loop); seen.push("out:" + s()); console.log(seen.join(" "));
