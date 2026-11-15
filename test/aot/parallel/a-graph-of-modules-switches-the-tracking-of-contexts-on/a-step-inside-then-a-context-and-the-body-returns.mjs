// Whoever awaits a step of an async generator awaited where the body first suspended: it goes on in the context that it had there.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* inner() { yield 0; }
async function* body() { await 0; new Bun.ModuleGraph(); await inner().next(); als.enterWith("in"); return 1; }
async function main() { await 0; const r = await body().next(); console.log(r.value, s()); }
setTimeout(main, 1);
