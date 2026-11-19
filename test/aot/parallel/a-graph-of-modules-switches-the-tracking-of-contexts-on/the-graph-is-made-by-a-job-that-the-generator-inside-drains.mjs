// Whoever awaits a step of an async generator awaited where the body first suspended: it goes on in the context that it had there.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
import { drainMicrotasks } from "bun:jsc"; async function far() { await 0; new Bun.ModuleGraph(); } async function* inner() { far(); drainMicrotasks(); yield 0; } async function* body() { await inner().next(); als.enterWith("in"); yield 1; }
async function main() { await 0; const r = await body().next(); console.log(r.value, s()); }
setTimeout(main, 1);
