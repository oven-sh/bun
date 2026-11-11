import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* g() { await 0; als.enterWith("inside"); yield 1; }
for await (const x of g()) console.log(x, s()); console.log(s());
export const left = s();
