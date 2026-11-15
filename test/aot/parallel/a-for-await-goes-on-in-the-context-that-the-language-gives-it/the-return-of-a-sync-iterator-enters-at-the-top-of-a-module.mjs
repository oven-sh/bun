// At the top of a module: a value of a sync iterator rejects, the wrapper closes the iterator, and the catch runs in what return() entered.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), log = [], it = { [Symbol.iterator]() { return this; }, next() { als.enterWith("next"); return { done: false, value: Promise.reject("r") }; }, return() { log.push("r:" + als.getStore()); als.enterWith("ret"); return {}; } };
try { for await (const x of it) log.push("b"); } catch { log.push("c:" + als.getStore()); }
console.log(log.join(" "), "e:" + als.getStore());
