// At the top of a module: the body waits for a timer before it enters, and a timer set behind the loop sees that context.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* w() { const r = await Promise.all([1, new Promise(d => setTimeout(d, 2))]); als.enterWith("late"); yield r.length; }
for await (const x of w()) console.log(x, s()); setTimeout(() => console.log("timer", s()), 1);
