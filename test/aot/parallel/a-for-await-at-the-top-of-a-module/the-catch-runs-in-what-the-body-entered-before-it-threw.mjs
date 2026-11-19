// At the top of a module: the generator's body enters a context and throws: the catch runs in that context.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* t() { await 0; als.enterWith("t"); throw new Error("x"); }
try { for await (const x of t()); } catch (e) { console.log(e.message, s()); } console.log(s());
