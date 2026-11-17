// A value of the sync iterator rejects; the wrapper closes the iterator, whose return() enters a context, and the loop's catch runs in it.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), out = [], s = () => String(als.getStore()); als.run("w", () => {});
const it = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: Promise.reject("x") }; }, return() { als.enterWith("r"); return {}; } };
async function main() { try { for await (const x of it) out.push(x); } catch (e) { out.push(e, s()); } console.log(out.join(" ")); }
main();
