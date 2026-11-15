// Whoever awaits a step goes on in the context in which it awaited, whatever context the body is in when the piece arrives.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms)), s = () => String(als.getStore());
async function* gen() { await later(2); als.enterWith("body"); yield 1; await null; yield 2; await later(1); als.enterWith("body2"); yield 3; }
async function loop() { const steps = gen(); for (;;) { const step = await steps.next(); if (step.done) break; seen.push(step.value + ":" + s()); } seen.push("end:" + s()); }
await later(1); await als.run("mine", loop); seen.push("out:" + s()); console.log(seen.join(" "));
