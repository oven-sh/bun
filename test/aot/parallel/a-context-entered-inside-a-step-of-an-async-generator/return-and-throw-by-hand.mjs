// return() and throw() are steps too: what the body awaits in its catch and its finally, and what is sent to return(), is asked for `then` inside the call.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), log = [], s = () => String(als.getStore()), say = (...w) => log.push(w.join(" "));
als.run("warm", () => {});
const entering = name => ({ get then() { als.enterWith(name); return undefined; }, name });
const promiseEntering = (name, value) => Object.defineProperty(Promise.resolve(value), "constructor", { get() { als.enterWith(name); return Promise; } });
setTimeout(async () => { await main(); console.log(log.join("\n")); }, 1);
async function* g() { try { yield 1; yield 2; } catch (error) { await entering("caught"); yield 9; } finally { await entering("finally"); } }
async function main() { await null; let it = g(); als.enterWith("c0"); await it.next(); say("first", s()); als.enterWith("c1"); let r = await it.return(entering("sent")); say("returned", r.done, r.value.name, s());
  it = g(); als.enterWith("d0"); await it.next(); als.enterWith("d1"); r = await it.throw(new Error("x")); say("thrown", r.value, s()); als.enterWith("d2"); r = await it.next(); say("ended", r.done, s()); }
