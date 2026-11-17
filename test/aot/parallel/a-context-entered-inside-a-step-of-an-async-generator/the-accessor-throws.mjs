// The accessor enters a context and throws: the body goes on at once inside the call of next(), and the consumer goes on in the context entered there.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), log = [], s = () => String(als.getStore()), say = (...w) => log.push(w.join(" "));
als.run("warm", () => {});
const entering = name => ({ get then() { als.enterWith(name); return undefined; }, name });
const promiseEntering = (name, value) => Object.defineProperty(Promise.resolve(value), "constructor", { get() { als.enterWith(name); return Promise; } });
setTimeout(async () => { await main(); console.log(log.join("\n")); }, 1);
const throwing = name => ({ get then() { als.enterWith(name); throw new Error(name); } });
async function* g() { try { await throwing("t1"); } catch (error) { say("caught", error.message, s()); } yield 1; try { yield throwing("t2"); } catch (error) { say("caught", error.message, s()); } yield 2; return throwing("t3"); }
async function main() { await null; const it = g(); for (let i = 0; i < 3; i++) { als.enterWith("c" + i); try { const r = await it.next(); say("got", r.value, r.done, s()); } catch (error) { say("rejected", error.message, s()); } } }
