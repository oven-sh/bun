// The consumer of the step is an async generator itself: it goes on in the context that an accessor entered inside the call of next() that it awaits.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), log = [], s = () => String(als.getStore()), say = (...w) => log.push(w.join(" "));
als.run("warm", () => {});
const entering = name => ({ get then() { als.enterWith(name); return undefined; }, name });
const promiseEntering = (name, value) => Object.defineProperty(Promise.resolve(value), "constructor", { get() { als.enterWith(name); return Promise; } });
setTimeout(async () => { await main(); console.log(log.join("\n")); }, 1);
async function* inner() { await entering("i"); yield 1; yield entering("iy"); }
async function* outer() { const it = inner(); als.enterWith("o0"); let r = await it.next(); say("outer got", r.value, s()); yield r.value; als.enterWith("o1"); r = await it.next(); say("outer got", r.value.name, s()); yield 5; }
async function main() { await null; const it = outer(); for (let i = 0; i < 3; i++) { als.enterWith("c" + i); const r = await it.next(); say("got", r.value, r.done, s()); } }
