// An element of the list has an accessor `then` that enters a context. The wrapper asks it in a job of its own: the loop goes on in the context in which it awaited.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), out = [], s = () => String(als.getStore()); als.run("w", () => {});
async function main() { for await (const x of [{ get then() { als.enterWith("t"); return undefined; } }]) out.push(typeof x, s()); out.push("end", s()); console.log(out.join(" ")); }
main();
