// At the top of a module: the body enters another context before each yield, and finds it again when it is resumed.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
const out = []; async function* h(n) { for (let i = 0; i < n; i++) { await 0; als.enterWith("e" + i); yield i; out.push("b" + s()); } }
for await (const x of h(2)) out.push(x, s()); out.push(s()); console.log(out.join(" "));
