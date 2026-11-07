// At the top of a module: one loop over a generator stands inside another.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore());
const out = []; async function* o(t) { await 0; als.enterWith(t); yield t; yield t + t; }
for await (const x of o("a")) { out.push(x + s()); for await (const y of o("b")) out.push(y + s()); out.push(s()); } console.log(out.join(" "));
