// The inner body has passed an await, so the outer body awaited its step in no context, and so did whoever awaits the outer step: the accessor enters too late for both.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* other() { yield 1; }
function* n() { yield 1; }
const getter = name => ({ get then() { als.enterWith(name); } });
async function* inner() { await 0; yield getter("g"); }
async function* body() { await inner().next(); yield 1; }
async function main() { await 0; const r = await body().next(); console.log(r.value, s()); }
setTimeout(main, 1);
