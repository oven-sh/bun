// Making a graph of modules switches the tracking of contexts on without a word to the compiled code. The body enters a context, passes an await in it and steps another generator:
// whoever awaits the step did so in the context that the body had entered.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* other() { yield 1; }
function* n() { yield 1; }
const getter = name => ({ get then() { als.enterWith(name); } });
async function* body() { new Bun.ModuleGraph(); als.enterWith("in"); await 0; other().next(); yield 1; }
async function main() { await 0; const r = await body().next(); console.log(r.value, s()); }
setTimeout(main, 1);
