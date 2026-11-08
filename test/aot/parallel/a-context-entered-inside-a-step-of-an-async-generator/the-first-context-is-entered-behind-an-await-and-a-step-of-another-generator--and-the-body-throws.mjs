// The body has passed an await, stepped another generator, entered its first context and throws: whoever awaits the step did so in no context.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* other() { yield 1; }
function* n() { yield 1; }
const getter = name => ({ get then() { als.enterWith(name); } });
async function* body() { await 0; other().next(); als.enterWith("in"); throw 1; }
async function main() { await 0; try { await body().next(); } catch (e) { console.log(e, s()); } }
setTimeout(main, 1);
