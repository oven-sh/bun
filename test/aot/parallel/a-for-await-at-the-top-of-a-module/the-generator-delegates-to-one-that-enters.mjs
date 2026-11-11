// At the top of a module: the generator delegates to another that enters a context, then enters one itself.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* g() { await 0; als.enterWith("inside"); yield 1; }
async function* y() { yield* g(); als.enterWith("y"); yield 2; } for await (const x of y()) console.log(x, s()); console.log(s());
