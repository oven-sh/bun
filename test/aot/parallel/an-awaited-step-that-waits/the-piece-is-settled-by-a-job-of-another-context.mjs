// Whoever awaits a step goes on in the context in which it awaited, whatever context the body is in when the piece arrives.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms)), s = () => String(als.getStore());
let release; const gate = () => new Promise(r => { release = r; });
async function* gen() { for (let i = 0; i < 3; i++) { await gate(); seen.push("b" + i + ":" + s()); yield i; } }
async function loop() { const steps = gen(); for (;;) { const step = await steps.next(); if (step.done) break; seen.push(step.value + ":" + s()); } seen.push("end:" + s()); }
await later(1); const done = als.run("mine", loop); for (let i = 0; i < 4; i++) { await later(1); als.run("other" + i, () => release()); } await done; console.log(seen.join(" "));
