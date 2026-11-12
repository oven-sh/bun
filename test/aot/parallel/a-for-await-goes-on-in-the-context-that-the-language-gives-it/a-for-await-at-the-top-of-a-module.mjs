// A for await at the top of a module over an async generator goes on in what the generator's body has entered, as it does in a function.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), out = [], s = () => String(als.getStore()); als.run("w", () => {});
async function* body() { await null; als.enterWith("g"); yield 1; }
for await (const x of body()) out.push(x, s());
out.push("end", s()); console.log(out.join(" "));
