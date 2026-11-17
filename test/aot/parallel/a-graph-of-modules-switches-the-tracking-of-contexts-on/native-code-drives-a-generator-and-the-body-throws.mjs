// Whoever awaits a step of an async generator awaited where the body first suspended: it goes on in the context that it had there.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
function* two() { yield 1; yield 2; }
async function* body() { await 0; const n = new Set(two()).size; new Bun.ModuleGraph(); als.enterWith("in"); throw new Error("e"); }
async function main() { await 0; try { await body().next(); } catch (e) { console.log(e.message, s()); } } setTimeout(main, 1);
