// Whoever awaits a step goes on in the context in which it awaited, whatever context the body is in when the piece arrives.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), seen = [], later = ms => new Promise(r => setTimeout(r, ms)), s = () => String(als.getStore());
async function* gen() { for (let i = 0; i < 6; i++) { await later(1); seen.push("b" + i + ":" + s()); yield i; } }
const steps = gen();
async function take(name) { for (let i = 0; i < 3; i++) { const step = await steps.next(); seen.push(name + step.value + ":" + s()); await later(1); } }
await later(1); await Promise.all([als.run("A", () => take("a")), als.run("B", () => take("b"))]); console.log(seen.join(" "));
