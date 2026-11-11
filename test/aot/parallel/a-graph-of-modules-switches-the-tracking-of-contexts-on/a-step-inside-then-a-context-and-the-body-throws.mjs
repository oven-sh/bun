// Whoever awaits a step of an async generator awaited where the body first suspended: it goes on in the context that it had there.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* inner() { yield 0; }
async function* body() { await 0; new Bun.ModuleGraph(); await inner().next(); als.enterWith("in"); throw 1; }
async function main() { await 0; try { await body().next(); } catch (e) { console.log(e, s()); } }
setTimeout(main, 1);
